import { createFileRoute } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import { Hero } from "../components/hero/hero.tsx";
import { Legend } from "../components/landing/legend.tsx";
import { OrderRoad } from "../components/landing/order-road.tsx";
import { SiteFooter } from "../components/landing/site-footer.tsx";
import { Sources } from "../components/landing/sources.tsx";
import { WorkspaceDemo } from "../components/workspace/workspace-demo.tsx";
import { baseOptions } from "../lib/layout.tsx";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="flex-1">
        <Hero />
        <section className="mx-auto max-w-7xl px-6 py-24">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-[640] tracking-[-0.015em] [font-stretch:112%]">
              Take a proposal from pencil to ink
            </h2>
            <p className="mt-3 text-lg leading-relaxed text-muted">
              This workspace runs in your browser on made-up prices. Pick a
              listing, ask the agent, and confirm its order yourself.
            </p>
          </div>
          <div className="mt-10">
            <WorkspaceDemo />
          </div>
        </section>
        <Legend />
        <OrderRoad />
        <Sources />
      </main>
      <SiteFooter />
    </HomeLayout>
  );
}
