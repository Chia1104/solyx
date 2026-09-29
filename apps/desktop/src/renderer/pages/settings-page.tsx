import { Card } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { MarketDataSource } from "#shared/ipc/settings.ts";

import { FubonSettings } from "../modules/settings/fubon-settings.tsx";
import { FugleSettings } from "../modules/settings/fugle-settings.tsx";
import { LanguageSelect } from "../modules/settings/language-select.tsx";
import { MarketDataSourceSelect } from "../modules/settings/market-data-source.tsx";

export function SettingsPage() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <Card.Header>
          <Card.Title>{t("settings.title")}</Card.Title>
        </Card.Header>
        <Card.Content>
          <LanguageSelect />
        </Card.Content>
      </Card>
      <Card>
        <Card.Header>
          <Card.Title>{t("settings.market-data.title")}</Card.Title>
          <Card.Description>
            {t("settings.market-data.description")}
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <MarketDataSourceSelect />
        </Card.Content>
      </Card>
      <Card>
        <Card.Header>
          <Card.Title>
            {t(`settings.market-data.sources.${MarketDataSource.Fugle}`)}
          </Card.Title>
          <Card.Description>{t("settings.fugle.description")}</Card.Description>
        </Card.Header>
        <Card.Content>
          <FugleSettings />
        </Card.Content>
      </Card>
      <Card>
        <Card.Header>
          <Card.Title>
            {t(`settings.market-data.sources.${MarketDataSource.Fubon}`)}
          </Card.Title>
          <Card.Description>{t("settings.fubon.description")}</Card.Description>
        </Card.Header>
        <Card.Content>
          <FubonSettings />
        </Card.Content>
      </Card>
    </div>
  );
}
