import { useTranslation } from "react-i18next";

import { Locale } from "#shared/ipc/settings.ts";

import { changeLocale, currentLocale } from "../../app/i18n.ts";
import { OptionSelect } from "../../components/option-select.tsx";

export function LanguageSelect() {
  const { t } = useTranslation();

  return (
    <OptionSelect
      className="max-w-xs"
      label={t("settings.language")}
      description={t("settings.language-description")}
      value={currentLocale()}
      options={Object.values(Locale).map((locale) => ({
        id: locale,
        label: t(`locale.${locale}`),
      }))}
      onChange={(locale) => void changeLocale(locale)}
    />
  );
}
