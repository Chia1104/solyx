import { useTranslation } from "react-i18next";

import { Sheet } from "../components/sheet.tsx";
import { AccountSummary } from "../modules/account/account-summary.tsx";

export function OverviewPage() {
  const { t } = useTranslation();

  return (
    <Sheet title={t("nav.overview")}>
      <AccountSummary />
    </Sheet>
  );
}
