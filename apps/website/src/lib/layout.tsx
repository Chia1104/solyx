import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { Logo } from "../components/logo.tsx";

import { GITHUB_URL, RELEASES_URL } from "./links.ts";

/** The header the home page and the docs share. */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <Logo className="size-6" />
          <span className="font-semibold [font-stretch:112%]">Solyx</span>
        </>
      ),
    },
    githubUrl: GITHUB_URL,
    links: [
      { text: "Docs", url: "/docs", active: "nested-url" },
      { text: "Download", url: RELEASES_URL, external: true },
    ],
  };
}
