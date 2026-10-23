import "./app/zod-config.ts";
import "./app/i18n.ts";
import "./styles.css";
import { deviceToken, inWindow } from "./app/device.ts";

// A window reports through the preload's bridge, and a browser has none to report through.
if (inWindow) await import("./app/crash-reports.ts");

// A browser not paired yet shows only how to pair, and connects to nothing until it has.
if (inWindow || deviceToken()) {
  await import("./app/start.tsx");
} else {
  const { showPairing } = await import("./pages/pairing-page.tsx");

  showPairing();
}
