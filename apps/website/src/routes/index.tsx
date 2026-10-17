import { createFileRoute } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import { Hero } from "../components/hero/hero.tsx";
import { Closing } from "../components/landing/closing.tsx";
import { Legend } from "../components/landing/legend.tsx";
import { OrderRoad } from "../components/landing/order-road.tsx";
import { Sheet, SheetHead, SheetRow } from "../components/landing/sheet.tsx";
import { SiteFooter } from "../components/landing/site-footer.tsx";
import { Sources } from "../components/landing/sources.tsx";
import { PencilBanner } from "../components/pencil-banner.tsx";
import { WorkspaceDemo } from "../components/workspace/workspace-demo.tsx";
import { baseOptions } from "../lib/layout.tsx";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <>
      <PencilBanner id="in-development">
        Solyx is still in development. Builds are nightly and trade on a paper
        account.
      </PencilBanner>
      <HomeLayout {...baseOptions()}>
        {/* The sun's radius, which the hero draws with and the sheet below leaves room for. */}
        <main className="flex-1 [--sun:clamp(4.25rem,11vw,8.75rem)]">
          <Hero />
          <Sheet>
            <SheetRow
              ruled={false}
              className="pt-[calc(var(--sun)-2rem)] pb-16 md:pb-20">
              <SheetHead id="demo" title="Take a proposal from pencil to ink">
                This workspace runs in your browser on made-up prices. Pick a
                listing, ask the agent, and confirm its order yourself.
              </SheetHead>
              <div className="px-3 sm:px-6 lg:px-10">
                <WorkspaceDemo />
              </div>
            </SheetRow>
            <Legend />
            <OrderRoad />
            <Sources />
            <Closing />
          </Sheet>
        </main>
        <SiteFooter />
      </HomeLayout>
    </>
  );
}
