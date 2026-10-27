import { getRouteApi } from "@tanstack/react-router";

import { Page } from "../components/page.tsx";
import { StrategyDetail } from "../modules/strategies/strategy-detail.tsx";

const route = getRouteApi("/strategies/$name");

/** One strategy the user wrote, under its name. */
export function StrategyPage() {
  const { name } = route.useParams();

  return (
    <Page title={name}>
      <StrategyDetail name={name} />
    </Page>
  );
}
