import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { LanguagePreference } from "#shared/ipc/settings.ts";

import { OptionSelect } from "../../components/option-select.tsx";

import { appearanceQuery } from "./settings-query.ts";

export function LanguageSelect() {
  const { t } = useTranslation();
  const { data } = useSuspenseQuery(appearanceQuery());

  // The main process pushes the saved appearance, which the query takes.
  const save = useMutation({
    mutationFn: (language: LanguagePreference) =>
      window.solyx.settings.setLanguage(language),
  });

  return (
    <OptionSelect
      className="max-w-xs"
      label={t("settings.language")}
      description={t("settings.language-description")}
      errorMessage={save.error?.message}
      value={data.language}
      isDisabled={save.isPending}
      options={Object.values(LanguagePreference).map((option) => ({
        id: option,
        label: t(`locale.${option}`),
      }))}
      onChange={(next) => save.mutate(next)}
    />
  );
}
