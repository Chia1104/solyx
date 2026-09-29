import { Card } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { ApiKeys } from "../modules/settings/api-keys.tsx";
import { LanguageSelect } from "../modules/settings/language-select.tsx";

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
          <Card.Title>{t("settings.api-keys.title")}</Card.Title>
          <Card.Description>
            {t("settings.api-keys.description")}
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <ApiKeys />
        </Card.Content>
      </Card>
    </div>
  );
}
