import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { Logo } from "../components/logo.tsx";

import { localePath, translators } from "./i18n.ts";
import type { Locale } from "./i18n.ts";
import { GITHUB_URL } from "./links.ts";

/** The header the home page and the docs share; Fumadocs adds the language switcher. */
export function baseOptions(locale: Locale): BaseLayoutProps {
  const { t } = translators[locale];

  return {
    nav: {
      url: localePath(locale, "/"),
      title: (
        <>
          <Logo className="size-6" />
          <span className="font-semibold [font-stretch:112%]">Solyx</span>
        </>
      ),
    },
    githubUrl: GITHUB_URL,
    links: [
      {
        text: t("nav.docs"),
        url: localePath(locale, "/docs"),
        active: "nested-url",
      },
      {
        text: t("nav.download"),
        url: localePath(locale, "/download"),
        active: "url",
      },
      {
        text: t("nav.changelog"),
        url: localePath(locale, "/changelog"),
        active: "url",
      },
    ],
  };
}
