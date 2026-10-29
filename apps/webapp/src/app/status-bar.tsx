import { BrokerModeChip } from "../modules/account/broker-mode-chip.tsx";
import { MarketSessions } from "../modules/market/market-sessions.tsx";
import { OrderLockToggle } from "../modules/proposals/order-lock.tsx";
import { UpdateAction } from "../modules/updates/update-action.tsx";

import { inWindow } from "./device.ts";

/**
 * The window's bottom row, under every column, for what holds wherever the user is: each
 * market's session, and at its end an update waiting and whether orders are paper or real and
 * locked.
 */
export function StatusBar() {
  return (
    <footer className="flex h-8 shrink-0 items-center gap-4 border-t border-separator px-3">
      <MarketSessions />
      <div className="ml-auto flex items-center gap-2">
        {inWindow ? <UpdateAction /> : null}
        <BrokerModeChip />
        {inWindow ? <OrderLockToggle /> : null}
      </div>
    </footer>
  );
}
