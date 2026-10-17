import appCss from "../styles/app.css?url";

import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import { i18nProvider } from "fumadocs-ui/i18n";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import { I18nextProvider } from "react-i18next";

import { StaticSearchDialog } from "../components/search.tsx";
import { translators, uiTranslationsByLocale, useLocale } from "../lib/i18n.ts";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/icon.png" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  const locale = useLocale();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="flex min-h-screen flex-col">
        <RootProvider
          search={{ SearchDialog: StaticSearchDialog }}
          i18n={i18nProvider(uiTranslationsByLocale, locale)}>
          <I18nextProvider i18n={translators[locale]}>
            <Outlet />
          </I18nextProvider>
        </RootProvider>
        <Scripts />
      </body>
    </html>
  );
}
