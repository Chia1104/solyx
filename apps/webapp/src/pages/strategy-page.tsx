import { getRouteApi } from "@tanstack/react-router";

import { Sheet } from "../components/sheet.tsx";
import { StrategyDetail } from "../modules/strategies/strategy-detail.tsx";

const route = getRouteApi("/strategies/$name");

/** One strategy the user wrote, under its name. */
export function StrategyPage() {
  const { name } = route.useParams();

  return (
    <Sheet title={name}>
      <StrategyDetail name={name} />
    </Sheet>
  );
}
