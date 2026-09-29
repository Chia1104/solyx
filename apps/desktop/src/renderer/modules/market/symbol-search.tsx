import { SearchField } from "@heroui/react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Market } from "@solyx/core/market";

/** Opens a Taiwan listing's chart; US data waits for a provider. */
export function SymbolSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <SearchField
      aria-label={t("chart.search-label")}
      onSubmit={(value) => {
        const symbol = value.trim().toUpperCase();

        if (symbol) {
          void navigate({
            to: "/symbol/$market/$symbol",
            params: { market: Market.TW, symbol },
          });
        }
      }}>
      <SearchField.Group>
        <SearchField.SearchIcon />
        <SearchField.Input
          className="w-44"
          placeholder={t("chart.search-placeholder")}
        />
        <SearchField.ClearButton />
      </SearchField.Group>
    </SearchField>
  );
}
