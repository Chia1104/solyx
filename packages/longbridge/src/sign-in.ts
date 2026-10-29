import ky from "ky";
import * as z from "zod";

const API_URL = "https://openapi.longbridge.com";

// Watchlist groups: the narrowest scope Longbridge grants, since quotes need none.
const SCOPE = "4";

/** The data center a credential's prefix names; any but a US one is Asia-Pacific. */
export const longbridgeDataCenter = (credential: string) =>
  credential.startsWith("us_") ? "us" : "ap";

/** What deletes a client's registration with Longbridge, which takes its sign-in off the account. */
const registrationSchema = z.object({ uri: z.string(), token: z.string() });

/** A client registered with Longbridge for one sign-in, and where its browser returns. */
export const longbridgeClientSchema = z.object({
  clientId: z.string(),
  redirectUri: z.string(),
  registration: registrationSchema.nullable(),
});

export type LongbridgeClient = z.infer<typeof longbridgeClientSchema>;

/** A signed-in client with its tokens. */
export const longbridgeSignInSchema = longbridgeClientSchema.extend({
  accessToken: z.string(),
  refreshToken: z.string(),
  /** UTC milliseconds the access token expires at. */
  expiresAt: z.number(),
});

export type LongbridgeSignIn = z.infer<typeof longbridgeSignInSchema>;

const registeredSchema = z.object({
  client_id: z.string(),
  registration_client_uri: z.string().optional(),
  registration_access_token: z.string().optional(),
});

const tokensSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
});

const refusalSchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
});

export interface LongbridgeHttpOptions {
  /** @default globalThis.fetch */
  fetch?: typeof fetch;
  /** @default Date.now */
  now?: () => number;
}

const api = (fetch: LongbridgeHttpOptions["fetch"]) =>
  ky.create({ baseUrl: API_URL, fetch, throwHttpErrors: false });

async function refusal(response: Response): Promise<Error> {
  const body = refusalSchema.safeParse(await response.json().catch(() => null));

  const reason = body.success
    ? (body.data.error_description ?? body.data.error)
    : `HTTP ${response.status}`;

  return new Error(`Longbridge refused the sign-in: ${reason}`);
}

/** Registers a client whose browser returns to `redirectUri`, as each sign-in does. */
export async function registerLongbridgeClient({
  name,
  redirectUri,
  fetch,
}: { name: string; redirectUri: string } & Pick<
  LongbridgeHttpOptions,
  "fetch"
>): Promise<LongbridgeClient> {
  const response = await api(fetch).post("oauth2/register", {
    json: {
      client_name: name,
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
  });

  if (!response.ok) throw await refusal(response);

  const registered = registeredSchema.parse(await response.json());

  return {
    clientId: registered.client_id,
    redirectUri,
    registration:
      registered.registration_client_uri && registered.registration_access_token
        ? {
            uri: registered.registration_client_uri,
            token: registered.registration_access_token,
          }
        : null,
  };
}

/** The page where the user signs in and lets the client read quotes, with PKCE. */
export function longbridgeAuthorizeUrl({
  client,
  state,
  challenge,
}: {
  client: LongbridgeClient;
  state: string;
  challenge: string;
}): string {
  const url = new URL("oauth2/authorize", `${API_URL}/`);

  url.search = new URLSearchParams({
    response_type: "code",
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  return url.toString();
}

async function requestTokens(
  client: LongbridgeClient,
  grant: Record<string, string>,
  credential: string,
  { fetch, now = Date.now }: LongbridgeHttpOptions,
  previousRefresh?: string
): Promise<LongbridgeSignIn> {
  const response = await api(fetch).post("oauth2/token", {
    body: new URLSearchParams({ ...grant, client_id: client.clientId }),
    headers: { "x-dc-region": longbridgeDataCenter(credential) },
  });

  if (!response.ok) throw await refusal(response);

  const tokens = tokensSchema.parse(await response.json());
  const refreshToken = tokens.refresh_token ?? previousRefresh;

  if (refreshToken === undefined) {
    throw new Error("Longbridge's sign-in gave no refresh token");
  }

  return {
    ...client,
    accessToken: tokens.access_token,
    refreshToken,
    expiresAt: now() + tokens.expires_in * 1000,
  };
}

/** Exchanges the code the browser returned with for the client's first tokens. */
export function exchangeLongbridgeCode(
  {
    client,
    code,
    verifier,
  }: { client: LongbridgeClient; code: string; verifier: string },
  options: LongbridgeHttpOptions = {}
): Promise<LongbridgeSignIn> {
  return requestTokens(
    client,
    {
      grant_type: "authorization_code",
      redirect_uri: client.redirectUri,
      code,
      code_verifier: verifier,
    },
    code,
    options
  );
}

/**
 * Trades the refresh token for new tokens. Longbridge rotates the refresh token, so the old one is
 * spent and the new sign-in must be kept before another refresh.
 */
export function refreshLongbridgeSignIn(
  signIn: LongbridgeSignIn,
  options: LongbridgeHttpOptions = {}
): Promise<LongbridgeSignIn> {
  return requestTokens(
    signIn,
    { grant_type: "refresh_token", refresh_token: signIn.refreshToken },
    signIn.refreshToken,
    options,
    signIn.refreshToken
  );
}

/** Deletes a client's registration, which takes its sign-in off the user's account. */
export async function deleteLongbridgeClient(
  client: LongbridgeClient,
  { fetch }: Pick<LongbridgeHttpOptions, "fetch"> = {}
): Promise<void> {
  if (!client.registration) return;

  const response = await api(fetch).delete(client.registration.uri, {
    headers: { authorization: `Bearer ${client.registration.token}` },
  });

  if (!response.ok && response.status !== 404) throw await refusal(response);
}
