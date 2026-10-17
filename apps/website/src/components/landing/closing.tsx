import { cn } from "cn";
import { useTranslation } from "react-i18next";

import { GITHUB_URL, RELEASES_URL } from "../../lib/links.ts";
import { Logo } from "../logo.tsx";
import { buttonVariants } from "../ui/button.tsx";

import { SheetRow } from "./sheet.tsx";

const PILL = "h-12 rounded-full px-6 text-base";

export function Closing() {
  const { t } = useTranslation();

  return (
    <SheetRow className="px-6 pt-24 pb-28 text-center">
      <Logo className="mx-auto size-14" />
      <h2 className="mt-6 text-[clamp(2rem,4.4vw,3rem)] leading-[1.04] font-[470] tracking-[-0.025em] text-balance [font-stretch:108%]">
        {t("closing.title")}
      </h2>
      <p className="text-muted-foreground mx-auto mt-4 max-w-[32em] text-lg leading-relaxed text-pretty">
        {t("closing.lede")}
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <a
          href={RELEASES_URL}
          className={cn(
            buttonVariants({ variant: "foreground", size: "lg" }),
            PILL
          )}>
          {t("hero.download")}
        </a>
        <a
          href={GITHUB_URL}
          className={cn(
            buttonVariants({ variant: "outline", size: "lg" }),
            PILL
          )}>
          {t("closing.github")}
        </a>
      </div>
    </SheetRow>
  );
}
