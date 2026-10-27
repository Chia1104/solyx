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
    <div className="flex flex-col items-start gap-1.5 text-xs text-muted">
      <p>{t("settings.sign-in.enter-code")}</p>
      <Button
        className="flex items-stretch rounded border border-dashed border-border bg-background ring-offset-2 ring-offset-surface outline-none data-focus-visible:ring-2 data-focus-visible:ring-focus data-hovered:border-muted"
        onPress={() =>
          void navigator.clipboard.writeText(code).then(() => setCopied(true))
        }>
        {/* Letter-spacing also follows the last character, which the narrower right padding makes up for. */}
        <span className="py-1 pr-2 pl-2.5 font-mono text-sm font-semibold tracking-[0.14em] text-foreground">
          {code}
        </span>
        <span
          aria-live="polite"
          className={cn(
            "flex items-center gap-1 border-l border-dashed border-border px-2 text-foreground",
            copied && "text-accent"
          )}>
          <Icon icon={copied ? Tick02Icon : Copy01Icon} className="size-3" />
        </span>
      </Button>
      <p className="break-all">{t("settings.sign-in.code-page", { url })}</p>
    </div>
  );
}
