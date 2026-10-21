import { createFileRoute, notFound } from "@tanstack/react-router";

import { LegalArticle } from "../../components/legal/legal-article.tsx";
import { Locale, localeOf } from "../../lib/i18n.ts";
import { LegalPage, legalHead, preloadLegal } from "../../lib/legal.ts";

export const Route = createFileRoute("/{-$lang}/privacy")({
  beforeLoad: ({ params }) => {
    if (!localeOf(params.lang)) throw notFound();
  },
  loader: ({ params }) =>
    preloadLegal(LegalPage.Privacy, localeOf(params.lang) ?? Locale.EnUS),
  head: ({ params }) =>
    legalHead(LegalPage.Privacy, localeOf(params.lang) ?? Locale.EnUS),
  component: Privacy,
});

function Privacy() {
  return <LegalArticle page={LegalPage.Privacy} />;
}
