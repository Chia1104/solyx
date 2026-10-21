import { createFileRoute, notFound } from "@tanstack/react-router";

import { LegalArticle } from "../../components/legal/legal-article.tsx";
import { Locale, localeOf } from "../../lib/i18n.ts";
import { LegalPage, legalHead, preloadLegal } from "../../lib/legal.ts";

export const Route = createFileRoute("/{-$lang}/terms")({
  beforeLoad: ({ params }) => {
    if (!localeOf(params.lang)) throw notFound();
  },
  loader: ({ params }) =>
    preloadLegal(LegalPage.Terms, localeOf(params.lang) ?? Locale.EnUS),
  head: ({ params }) =>
    legalHead(LegalPage.Terms, localeOf(params.lang) ?? Locale.EnUS),
  component: Terms,
});

function Terms() {
  return <LegalArticle page={LegalPage.Terms} />;
}
