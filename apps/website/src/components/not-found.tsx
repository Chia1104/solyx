import { HomeLayout } from "fumadocs-ui/layouts/home";
import { DefaultNotFound } from "fumadocs-ui/layouts/home/not-found";

import { useLocale } from "../lib/i18n.ts";
import { baseOptions } from "../lib/layout.tsx";

export function NotFound() {
  return (
    <HomeLayout {...baseOptions(useLocale())}>
      <DefaultNotFound />
    </HomeLayout>
  );
}
