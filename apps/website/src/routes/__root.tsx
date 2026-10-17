import appCss from "../styles/app.css?url";

import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import { RootProvider } from "fumadocs-ui/provider/tanstack";

import { StaticSearchDialog } from "../components/search.tsx";

const DESCRIPTION =
  "A desktop app for trading Taiwan and US stocks. An agent analyzes the market and proposes trades; nothing reaches your broker until you confirm it.";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Solyx" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Solyx" },
      { property: "og:description", content: DESCRIPTION },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/icon.png" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="flex min-h-screen flex-col">
        <RootProvider search={{ SearchDialog: StaticSearchDialog }}>
          <Outlet />
        </RootProvider>
        <Scripts />
      </body>
    </html>
  );
}
