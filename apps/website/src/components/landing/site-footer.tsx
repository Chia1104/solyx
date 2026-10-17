import { Link } from "@tanstack/react-router";

import { GITHUB_URL, RELEASES_URL } from "../../lib/links.ts";
import { Logo } from "../logo.tsx";

export function SiteFooter() {
  return (
    <footer className="border-graphite/45 border-t border-dashed">
      <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 md:grid-cols-[1fr_auto]">
        <div className="max-w-xl">
          <p className="flex items-center gap-2 font-semibold">
            <Logo className="size-6" />
            Solyx
          </p>
          <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
            Solyx is not investment advice. You alone are responsible for any
            gains or losses from trades made with it. It is provided as is,
            without warranty of any kind.
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            Copyright 2026 Chia1104. Free software under the GNU AGPL, version 3
            or later.
          </p>
        </div>
        <nav
          aria-label="Footer"
          className="flex gap-6 text-sm md:flex-col md:gap-2">
          <Link
            to="/docs/$"
            params={{ _splat: "" }}
            className="hover:text-primary">
            Docs
          </Link>
          <a href={RELEASES_URL} className="hover:text-primary">
            Releases
          </a>
          <a href={GITHUB_URL} className="hover:text-primary">
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}
