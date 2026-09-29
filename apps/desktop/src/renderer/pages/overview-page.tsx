import { AccountCard } from "../modules/account/account-card.tsx";
import { MarketSessionsCard } from "../modules/market/market-sessions-card.tsx";

export function OverviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <MarketSessionsCard />
      <AccountCard />
    </div>
  );
}
