import { useEffect, useState } from "react";

import { cn } from "@heroui/react";
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Button } from "react-aria-components";
import { useTranslation } from "react-i18next";

import { Icon } from "../../components/icon.tsx";

// How long the slip says its code was copied.
const COPIED_MS = 1500;

/**
 * The code a sign-in waits for the user to enter on the provider's page. It is a slip drawn in
 * pencil, since the provider has yet to take the code, and pressing it copies the code, which the
 * slip says in ink.
 */
export function SignInCode({ code, url }: { code: string; url: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;

    const timer = setTimeout(() => setCopied(false), COPIED_MS);

    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="flex flex-col items-start gap-2 text-xs text-muted">
      <p>{t("settings.sign-in.enter-code")}</p>
      <Button
        className="group flex items-stretch rounded border border-dashed border-border bg-background ring-offset-2 ring-offset-background outline-none data-focus-visible:ring-2 data-focus-visible:ring-focus data-hovered:border-muted"
        onPress={() =>
          void navigator.clipboard.writeText(code).then(() => setCopied(true))
        }>
        {/* Letter-spacing also follows the last character, which the narrower right padding makes up for. */}
        <span className="py-2 pr-3 pl-4 font-mono text-xl font-semibold tracking-[0.2em] text-foreground">
          {code}
        </span>
        <span
          aria-live="polite"
          className={cn(
            "flex items-center gap-1.5 border-l border-dashed border-border px-3 text-foreground",
            copied
              ? "text-accent"
              : "hatch group-data-hovered:[--hatch-color:var(--muted)]"
          )}>
          <Icon icon={copied ? Tick02Icon : Copy01Icon} className="size-3.5" />
          {/* Both labels hold the stub's width, so the slip does not move as one replaces the other. */}
          <span className="grid text-left">
            <span
              className={cn("col-start-1 row-start-1", copied && "invisible")}>
              {t("settings.sign-in.copy-code")}
            </span>
            <span
              className={cn("col-start-1 row-start-1", !copied && "invisible")}>
              {t("settings.sign-in.code-copied")}
            </span>
          </span>
        </span>
      </Button>
      <p className="break-all">{t("settings.sign-in.code-page", { url })}</p>
    </div>
  );
}
