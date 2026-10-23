import { QueryObserver } from "@tanstack/react-query";
import i18next from "i18next";

import { resolveLocale } from "@solyx/api/settings";
import type { Appearance, LanguagePreference } from "@solyx/api/settings";

import { appearanceQuery } from "../modules/settings/settings-query.ts";

import { queryClient } from "./query-client.ts";

const showLanguage = (preference: LanguagePreference) =>
  i18next.changeLanguage(resolveLocale(preference, navigator.language));

const selectLanguage = (appearance: Appearance) => appearance.language;

/**
 * Shows the language the appearance names, saved in settings or by hand in the config file.
 * Resolves once the saved one shows, so the first render is already in it.
 */
export async function followLanguage() {
  new QueryObserver(queryClient, {
    ...appearanceQuery(),
    select: selectLanguage,
  }).subscribe(({ data }) => {
    if (data) void showLanguage(data);
  });

  await showLanguage(
    selectLanguage(await queryClient.query(appearanceQuery()))
  );
}
