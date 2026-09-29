import { Card } from "@heroui/react";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { IndicatorToggles } from "../modules/market/indicator-toggles.tsx";
import { IntervalSelect } from "../modules/market/interval-select.tsx";
import { SymbolChart } from "../modules/market/symbol-chart.tsx";

const route = getRouteApi("/symbol/$market/$symbol");

export function SymbolPage() {
  const { t } = useTranslation();
  const symbol = route.useParams();
  const { interval } = route.useSearch();
  const navigate = route.useNavigate();

  return (
    <Card>
      <Card.Header className="flex flex-row flex-wrap items-center gap-3">
        <Card.Title>
          {t(`market.${symbol.market}`)} {symbol.symbol}
        </Card.Title>
        <IntervalSelect
          value={interval}
          onChange={(next) => void navigate({ search: { interval: next } })}
        />
      </Card.Header>
      <Card.Content className="flex flex-col gap-3">
        <IndicatorToggles />
        <SymbolChart symbol={symbol} interval={interval} />
      </Card.Content>
    </Card>
  );
}
