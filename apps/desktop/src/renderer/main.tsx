import "./app/zod-config.ts";
import "./app/i18n.ts";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

import { queryClient } from "./app/query-client.ts";
import { router } from "./app/router.tsx";
import { followAppearance } from "./app/theme.ts";

await followAppearance();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
);
