import { useState } from "react";

import { useTranslation } from "react-i18next";

import {
  changeLanguagePreference,
  LanguagePreference,
  languagePreference,
} from "../../app/i18n.ts";
import { OptionSelect } from "../../components/option-select.tsx";

export function LanguageSelect() {
  const { t } = useTranslation();
  // Following the computer can resolve to the language already showing, which re-renders nothing.
  const [preference, setPreference] = useState(languagePreference);

  return (
    <OptionSelect
      className="max-w-xs"
      label={t("settings.language")}
      description={t("settings.language-description")}
      value={preference}
      options={Object.values(LanguagePreference).map((option) => ({
        id: option,
        label: t(`locale.${option}`),
      }))}
      onChange={(next) => {
        setPreference(next);
        void changeLanguagePreference(next);
      }}
    />
  );
}
