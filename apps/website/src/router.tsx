import { createRouter } from "@tanstack/react-router";

import { ErrorPage } from "./components/status/error-page.tsx";
import { NotFound } from "./components/status/not-found.tsx";
import { routeTree } from "./routeTree.gen.ts";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: ErrorPage,
  });
}
