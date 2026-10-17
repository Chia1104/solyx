import { Suspense, use } from "react";

import { createFileRoute, notFound } from "@tanstack/react-router";
import { DocsLayout } from "fumadocs-ui/layouts/spacious";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/spacious/page";
import { useTranslation } from "react-i18next";

import { useMDXComponents } from "../../../components/mdx.tsx";
import { PencilBanner } from "../../../components/pencil-banner.tsx";
import { Locale, localeOf, translators, useLocale } from "../../../lib/i18n.ts";
import { baseOptions } from "../../../lib/layout.tsx";
import { socialCardMeta } from "../../../lib/social-card.ts";
import { docs, source } from "../../../lib/source.ts";

// The loader runs in the browser on client-side navigation, so it reads the source there rather
// than through a server function: the Worker answers no navigation, and the prerender runs on
// workerd, where a static server function cannot write its results to files.
export const Route = createFileRoute("/{-$lang}/docs/$")({
  component: Page,
  loader: async ({ params }) => {
    const locale = localeOf(params.lang);

    if (!locale) throw notFound();

    const page = source.getPage(
      params._splat?.split("/").filter(Boolean) ?? [],
      locale
    );

    if (!page) throw notFound();

    await docs.getPage(page.path)?.preload();

    return {
      path: page.path,
      url: page.url,
      title: page.data.title,
      description: page.data.description,
    };
  },
  head: ({ loaderData, params }) => {
    const { t } = translators[localeOf(params.lang) ?? Locale.EnUS];

    return {
      meta: loaderData
        ? [
            { title: t("meta.page-title", { title: loaderData.title }) },
            { name: "description", content: loaderData.description ?? "" },
            socialCardMeta(loaderData.url),
          ]
        : [],
    };
  },
});

function Content({ path }: { path: string }) {
  const page = docs.getPage(path);

  if (!page) throw new Error(`No docs page at ${path}`);

  const { toc } = use(page.load());
  const MDX = page.body;

  return (
    <DocsPage toc={toc}>
      <DocsTitle>{page.title}</DocsTitle>
      <DocsDescription>{page.description}</DocsDescription>
      <DocsBody>
        <MDX components={useMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

function Page() {
  const { path } = Route.useLoaderData();
  const locale = useLocale();
  const { t } = useTranslation();

  return (
    <>
      <PencilBanner id="docs-in-progress">{t("banner.docs")}</PencilBanner>
      <DocsLayout {...baseOptions(locale)} tree={source.getPageTree(locale)}>
        <Suspense>
          <Content path={path} />
        </Suspense>
      </DocsLayout>
    </>
  );
}
