import { HomeLayout } from "fumadocs-ui/layouts/home";
import { useTranslation } from "react-i18next";

import { useLocale } from "../../lib/i18n.ts";
import { baseOptions } from "../../lib/layout.tsx";
import { legalFile } from "../../lib/legal.ts";
import type { LegalPage } from "../../lib/legal.ts";
import { legal } from "../../lib/source.ts";
import { Sheet, SheetRow } from "../landing/sheet.tsx";
import { SiteFooter } from "../landing/site-footer.tsx";
import { useMDXComponents } from "../mdx.tsx";

/** A legal page on the drafting sheet: its title, lede and last change, then its text. */
export function LegalArticle({ page }: { page: LegalPage }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const entry = legal.get(legalFile(page, locale));

  if (!entry) throw new Error(`No ${page} page in ${locale}`);

  const MDX = entry.body;

  return (
    <HomeLayout {...baseOptions(locale)}>
      <main className="flex-1">
        <Sheet>
          <SheetRow
            ruled={false}
            className="px-6 pt-20 pb-12 text-center md:pt-24">
            <h1 className="text-[clamp(2.4rem,5.6vw,4rem)] leading-[1.02] font-[540] tracking-[-0.028em] text-balance [font-stretch:112%]">
              {entry.title}
            </h1>
            <p className="text-muted-foreground mx-auto mt-5 max-w-[34em] text-lg leading-relaxed text-pretty">
              {entry.description}
            </p>
            <p className="text-muted-foreground mt-4 text-sm">
              {t("legal.updated", { date: entry.updated })}
            </p>
          </SheetRow>
          <SheetRow className="px-6 py-12 md:px-10">
            <article className="prose mx-auto max-w-3xl">
              <MDX components={useMDXComponents()} />
            </article>
          </SheetRow>
        </Sheet>
      </main>
      <SiteFooter />
    </HomeLayout>
  );
}
