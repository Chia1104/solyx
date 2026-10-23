import type { Ref } from "react";

import { SearchField } from "@heroui/react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Market } from "@solyx/core/market";

/** Opens a Taiwan listing's chart; US data waits for a provider. */
export function SymbolSearch({
  inputRef,
}: {
  inputRef?: Ref<HTMLInputElement>;
}) {
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
            search: true,
          });
        }
      }}>
      <SearchField.Group>
        <SearchField.SearchIcon />
        <SearchField.Input
          ref={inputRef}
          className="w-56"
          placeholder={t("chart.search-placeholder")}
        />
        <SearchField.ClearButton />
      </SearchField.Group>
    </SearchField>
  );
}
