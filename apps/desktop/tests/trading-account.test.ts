import { expect, test } from "vite-plus/test";

import { fubonChoices } from "../src/renderer/modules/settings/trading-account.ts";
import { FubonSessionState } from "../src/shared/settings.ts";

const signedIn = {
  state: FubonSessionState.SignedIn,
  accounts: 2,
  stockAccounts: [{ id: "6460-28", name: "王**" }],
};

test("the Fubon account picked stays offered until a sign-in lists Fubon's accounts", () => {
  expect(
    fubonChoices({ state: FubonSessionState.SignedOut }, "6460-29")
  ).toEqual({ accounts: [{ id: "6460-29", name: "" }], gone: false });

  expect(fubonChoices(undefined, null)).toEqual({ accounts: [], gone: false });
});

test("a sign-in that lists Fubon's accounts without the one picked says it is gone", () => {
  expect(fubonChoices(signedIn, "6460-29")).toEqual({
    accounts: signedIn.stockAccounts,
    gone: true,
  });

  expect(fubonChoices(signedIn, "6460-28").gone).toBe(false);
});
