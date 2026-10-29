import { expect, test } from "vite-plus/test";

import {
  deleteLongbridgeClient,
  exchangeLongbridgeCode,
  longbridgeAuthorizeUrl,
  refreshLongbridgeSignIn,
  registerLongbridgeClient,
} from "../src/sign-in.ts";

const NOW = Date.parse("2026-10-28T10:00:00Z");

const CLIENT = {
  clientId: "client-1",
  redirectUri: "http://127.0.0.1:50123/callback/path",
  registration: {
    uri: "https://openapi.longbridge.com/oauth2/register/client-1",
    token: "registration-token",
  },
};

function fakeFetch(answer: (request: Request) => Response) {
  const sent: Request[] = [];

  return {
    sent,
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);

      sent.push(request.clone());

      return answer(request);
    },
  };
}

test("registers a public client that returns to the sign-in's listener", async () => {
  const { sent, fetch } = fakeFetch(() =>
    Response.json(
      {
        client_id: "client-1",
        registration_client_uri: CLIENT.registration.uri,
        registration_access_token: CLIENT.registration.token,
      },
      { status: 201 }
    )
  );

  expect(
    await registerLongbridgeClient({
      name: "Solyx",
      redirectUri: CLIENT.redirectUri,
      fetch,
    })
  ).toEqual(CLIENT);
  expect(sent[0].url).toBe("https://openapi.longbridge.com/oauth2/register");
  expect(await sent[0].json()).toEqual({
    client_name: "Solyx",
    redirect_uris: [CLIENT.redirectUri],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  });
});

test("asks for the narrowest scope, with PKCE and the sign-in's state", () => {
  const url = new URL(
    longbridgeAuthorizeUrl({
      client: CLIENT,
      state: "state-1",
      challenge: "challenge-1",
    })
  );

  expect(url.origin + url.pathname).toBe(
    "https://openapi.longbridge.com/oauth2/authorize"
  );
  expect(Object.fromEntries(url.searchParams)).toEqual({
    response_type: "code",
    client_id: "client-1",
    redirect_uri: CLIENT.redirectUri,
    scope: "4",
    state: "state-1",
    code_challenge: "challenge-1",
    code_challenge_method: "S256",
  });
});

test("exchanges the code for tokens in the data center its prefix names", async () => {
  const { sent, fetch } = fakeFetch(() =>
    Response.json({
      access_token: "hk_access",
      refresh_token: "hk_refresh",
      expires_in: 1_209_600,
      token_type: "Bearer",
    })
  );

  expect(
    await exchangeLongbridgeCode(
      { client: CLIENT, code: "us_code", verifier: "verifier-1" },
      { fetch, now: () => NOW }
    )
  ).toEqual({
    ...CLIENT,
    accessToken: "hk_access",
    refreshToken: "hk_refresh",
    expiresAt: NOW + 1_209_600_000,
  });
  expect(sent[0].url).toBe("https://openapi.longbridge.com/oauth2/token");
  expect(sent[0].headers.get("x-dc-region")).toBe("us");
  expect(Object.fromEntries(new URLSearchParams(await sent[0].text()))).toEqual(
    {
      grant_type: "authorization_code",
      client_id: "client-1",
      redirect_uri: CLIENT.redirectUri,
      code: "us_code",
      code_verifier: "verifier-1",
    }
  );
});

test("a refresh takes the new refresh token, or keeps the old one when none comes", async () => {
  const signIn = {
    ...CLIENT,
    accessToken: "hk_old",
    refreshToken: "hk_refresh_1",
    expiresAt: NOW,
  };

  const rotating = fakeFetch(() =>
    Response.json({
      access_token: "hk_new",
      refresh_token: "hk_refresh_2",
      expires_in: 60,
    })
  );

  expect(
    await refreshLongbridgeSignIn(signIn, {
      fetch: rotating.fetch,
      now: () => NOW,
    })
  ).toMatchObject({
    accessToken: "hk_new",
    refreshToken: "hk_refresh_2",
    expiresAt: NOW + 60_000,
  });
  expect(rotating.sent[0].headers.get("x-dc-region")).toBe("ap");
  expect(
    Object.fromEntries(new URLSearchParams(await rotating.sent[0].text()))
  ).toEqual({
    grant_type: "refresh_token",
    refresh_token: "hk_refresh_1",
    client_id: "client-1",
  });

  const keeping = fakeFetch(() =>
    Response.json({ access_token: "hk_new", expires_in: 60 })
  );

  expect(
    await refreshLongbridgeSignIn(signIn, { fetch: keeping.fetch })
  ).toMatchObject({ refreshToken: "hk_refresh_1" });
});

test("a refused sign-in names Longbridge and the reason it gives", async () => {
  const { fetch } = fakeFetch(() =>
    Response.json(
      { error: "invalid_grant", error_description: "refresh token expired" },
      { status: 400 }
    )
  );

  await expect(
    refreshLongbridgeSignIn(
      { ...CLIENT, accessToken: "a", refreshToken: "r", expiresAt: NOW },
      { fetch }
    )
  ).rejects.toThrow("Longbridge refused the sign-in: refresh token expired");
});

test("deletes a client with its registration's token, and has nothing to delete without one", async () => {
  const { sent, fetch } = fakeFetch(() => new Response(null, { status: 204 }));

  await deleteLongbridgeClient(CLIENT, { fetch });
  await deleteLongbridgeClient({ ...CLIENT, registration: null }, { fetch });

  expect(sent).toHaveLength(1);
  expect(sent[0].method).toBe("DELETE");
  expect(sent[0].url).toBe(CLIENT.registration.uri);
  expect(sent[0].headers.get("authorization")).toBe(
    "Bearer registration-token"
  );
});
