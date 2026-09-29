import { useId } from "react";

import { Description, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { isEnumValue } from "@solyx/utils/is";

import { Theme } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";

import { settingsQueryKeys, themeQuery } from "./settings-query.ts";

export function ThemeSelect() {
  const { t } = useTranslation();
  const labelId = useId();
  const descriptionId = useId();
  const queryClient = useQueryClient();
  const { data } = useQuery(themeQuery());

  const save = useMutation({
    mutationFn: (theme: Theme) => window.solyx.settings.setTheme(theme),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueryKeys.theme }),
  });

  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-sm font-medium">
        {t("settings.theme")}
      </span>
      <ToggleButtonGroup
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        selectionMode="single"
        disallowEmptySelection
        size="sm"
        isDisabled={!data || save.isPending}
        selectedKeys={data ? [data] : []}
        onSelectionChange={(keys) => {
          const [next] = keys;

          if (next !== undefined && isEnumValue(Theme, next)) save.mutate(next);
        }}>
        {Object.values(Theme).map((theme) => (
          <ToggleButton key={theme} id={theme}>
            {t(`settings.themes.${theme}`)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Description id={descriptionId}>
        {t("settings.theme-description")}
      </Description>
      {save.error ? (
        <ErrorAlert
          title={t("settings.save-failed")}
          description={save.error.message}
        />
      ) : null}
    </div>
  );
}
