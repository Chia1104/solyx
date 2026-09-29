import { Card } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { LanguageSelect } from "../modules/settings/language-select.tsx";

export function SettingsPage() {
  const { t } = useTranslation();

  return (
    <Card>
      <Card.Header>
        <Card.Title>{t("settings.title")}</Card.Title>
      </Card.Header>
      <Card.Content>
        <LanguageSelect />
      </Card.Content>
    </Card>
  );
}
