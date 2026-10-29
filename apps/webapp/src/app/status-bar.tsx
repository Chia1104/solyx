import { BrokerModeChip } from "../modules/account/broker-mode-chip.tsx";
import { MarketSessions } from "../modules/market/market-sessions.tsx";
import { OrderLockToggle } from "../modules/proposals/order-lock.tsx";
import { UpdateAction } from "../modules/updates/update-action.tsx";

import { inWindow } from "./device.ts";

/**
 * The window's bottom row, under every column, for what holds wherever the user is: whether
 * orders are paper or real and locked, each market's session, and an update waiting.
 */
export function StatusBar() {
  return (
    <footer className="flex h-8 shrink-0 items-center gap-4 border-t border-separator px-2">
      <div className="flex items-center gap-1">
        <BrokerModeChip />
        {inWindow ? <OrderLockToggle /> : null}
      </div>
      <MarketSessions />
      {inWindow ? (
        <div className="ml-auto">
          <UpdateAction />
        </div>
      ) : null}
    </footer>
  );
}
