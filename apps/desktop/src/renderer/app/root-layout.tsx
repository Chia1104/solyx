import { buttonVariants } from "@heroui/styles";
import { Link, Outlet } from "@tanstack/react-router";
import { I18nProvider } from "react-aria-components";
import { useTranslation } from "react-i18next";

import { BrokerModeChip } from "../modules/account/broker-mode-chip.tsx";
import { SymbolSearch } from "../modules/market/symbol-search.tsx";

const navLinkClass = buttonVariants({ variant: "ghost", size: "sm" });

const activeNavLink = { className: "bg-default" };

export function RootLayout() {
  const { t, i18n } = useTranslation();

  return (
    // react-aria formats numbers and announces built-in strings in this locale.
    <I18nProvider locale={i18n.language}>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
        <header className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Solyx</h1>
          <BrokerModeChip />
          <div className="ml-auto">
            <SymbolSearch />
          </div>
          <nav className="flex gap-1">
            <Link
              to="/"
              className={navLinkClass}
              activeOptions={{ exact: true }}
              activeProps={activeNavLink}>
              {t("nav.overview")}
            </Link>
            <Link
              to="/proposals"
              className={navLinkClass}
              activeProps={activeNavLink}>
              {t("nav.proposals")}
            </Link>
            <Link
              to="/settings"
              className={navLinkClass}
              activeProps={activeNavLink}>
              {t("nav.settings")}
            </Link>
          </nav>
        </header>
        <Outlet />
      </div>
    </I18nProvider>
  );
}
