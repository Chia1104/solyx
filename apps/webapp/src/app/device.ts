import { pairingSchema } from "@solyx/api/devices";

/**
 * A window of the desktop app, which reaches the backend through its preload. Any other browser
 * reaches it as a paired device, through the edge that served it.
 */
export const inWindow = navigator.userAgent.includes("Electron/");

const TOKEN_KEY = "solyx.device-token";

/** The token this browser was paired with; `null` before it pairs and once it is unpaired. */
export const deviceToken = () => localStorage.getItem(TOKEN_KEY);

export const forgetDevice = () => localStorage.removeItem(TOKEN_KEY);

/** Pairs this browser, as `name`, with the code the desktop shows, and keeps its token. */
export async function pairDevice(code: string, name: string) {
  const response = await fetch("/pair", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name }),
  });

  if (!response.ok) throw new Error(await response.text());

  const { token } = pairingSchema.parse(await response.json());

  localStorage.setItem(TOKEN_KEY, token);
}
