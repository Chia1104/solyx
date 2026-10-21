import { Locale, localePath, translators } from "./i18n.ts";
import { socialCardMeta } from "./social-card.ts";
import { legal } from "./source.ts";

/** The site's legal pages, by the path each takes. */
export const LegalPage = {
  Terms: "terms",
  Privacy: "privacy",
} as const;

export type LegalPage = (typeof LegalPage)[keyof typeof LegalPage];

/** A legal page's file in `content/legal`: English as `name.mdx`, every other locale beside it. */
export const legalFile = (page: LegalPage, locale: Locale) =>
  locale === Locale.EnUS ? `${page}.mdx` : `${page}.${locale}.mdx`;

/** What a legal page tells search engines and social cards, from its own frontmatter. */
export function legalHead(page: LegalPage, locale: Locale) {
  const { t } = translators[locale];
  const entry = legal.get(legalFile(page, locale));

  if (!entry) return { meta: [] };

  return {
    meta: [
      { title: t("meta.page-title", { title: entry.title }) },
      { name: "description", content: entry.description },
      { property: "og:title", content: entry.title },
      { property: "og:description", content: entry.description },
      socialCardMeta(localePath(locale, `/${page}`)),
    ],
  };
}

/** Loads a legal page's text before it draws, so the prerender writes it out whole. */
export async function preloadLegal(page: LegalPage, locale: Locale) {
  await legal.get(legalFile(page, locale))?.preload();
}
