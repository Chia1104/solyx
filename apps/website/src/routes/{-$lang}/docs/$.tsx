import { Suspense, use } from "react";

import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { staticFunctionMiddleware } from "@tanstack/start-static-server-functions";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import { useTranslation } from "react-i18next";

import { useMDXComponents } from "../../../components/mdx.tsx";
import { PencilBanner } from "../../../components/pencil-banner.tsx";
import { Locale, localeOf, translators, useLocale } from "../../../lib/i18n.ts";
import { baseOptions } from "../../../lib/layout.tsx";
import { docs, source } from "../../../lib/source.ts";

// Static: the build writes each page's result to a file, which client-side navigation reads.
const loadPage = createServerFn({ method: "GET" })
  .validator((input: { slugs: string[]; locale: Locale }) => input)
  .middleware([staticFunctionMiddleware])
  .handler(async ({ data: { slugs, locale } }) => {
    const page = source.getPage(slugs, locale);

    if (!page) throw notFound();

    return {
      path: page.path,
      title: page.data.title,
      description: page.data.description,
      pageTree: await source.serializePageTree(source.getPageTree(locale)),
    };
  });

export const Route = createFileRoute("/{-$lang}/docs/$")({
  component: Page,
  loader: async ({ params }) => {
    const locale = localeOf(params.lang);

    if (!locale) throw notFound();

    const slugs = params._splat?.split("/").filter(Boolean) ?? [];
    const data = await loadPage({ data: { slugs, locale } });

    await docs.getPage(data.path)?.preload();

    return data;
  },
  head: ({ loaderData, params }) => {
    const { t } = translators[localeOf(params.lang) ?? Locale.EnUS];

    return {
      meta: loaderData
        ? [
            { title: t("meta.page-title", { title: loaderData.title }) },
            { name: "description", content: loaderData.description ?? "" },
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
  const { path, pageTree } = useFumadocsLoader(Route.useLoaderData());
  const locale = useLocale();
  const { t } = useTranslation();

  return (
    <>
      <PencilBanner id="docs-in-progress">{t("banner.docs")}</PencilBanner>
      <DocsLayout {...baseOptions(locale)} tree={pageTree}>
        <Suspense>
          <Content path={path} />
        </Suspense>
      </DocsLayout>
    </>
  );
}
