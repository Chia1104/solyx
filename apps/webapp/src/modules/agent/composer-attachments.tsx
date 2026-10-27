import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import { Button, CloseButton, ScrollShadow, cn } from "@heroui/react";
import { ChartCandlestickIcon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { Icon } from "../../components/icon.tsx";
import { useListingName } from "../market/listing-name.tsx";
import { QuoteLine } from "../market/quote-figures.tsx";
import { quoteQuery } from "../market/quote-query.ts";

import { useAgentStore } from "./agent-store.ts";

/**
 * What the next message carries, as cards along the top of the composer. The row scrolls sideways
 * once they outgrow it, and a mouse's wheel scrolls it too, since a wheel only turns up and down.
 */
export function ComposerAttachments({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const row = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = row.current;

    if (!element) return;

    const sideways = (event: WheelEvent) => {
      if (
        Math.abs(event.deltaX) >= Math.abs(event.deltaY) ||
        element.scrollWidth <= element.clientWidth
      ) {
        return;
      }

      event.preventDefault();
      element.scrollLeft += event.deltaY;
    };

    // Passive listeners cannot keep the wheel from scrolling what lies behind the row.
    element.addEventListener("wheel", sideways, { passive: false });

    return () => element.removeEventListener("wheel", sideways);
  }, []);

  return (
    <ScrollShadow
      ref={row}
      orientation="horizontal"
      hideScrollBar
      size={24}
      className="overscroll-x-contain">
      <ul
        aria-label={t("agent.context.attachments")}
        className="flex w-max gap-2 p-2 pb-0">
        {children}
      </ul>
    </ScrollShadow>
  );
}

/**
 * One thing a message carries: its picture, its name and what it is, and the one thing the user
 * may do with it, which waits for the pointer unless it is all the card offers.
 */
function AttachmentCard({
  media,
  title,
  description,
  action,
  detached = false,
}: {
  /** A thumbnail or an icon, which fills the square the card opens with. */
  media: ReactNode;
  title: string;
  description: string;
  action: ReactNode;
  /** The message will be sent without it. */
  detached?: boolean;
}) {
  return (
    <li
      className={cn(
        "group flex w-56 shrink-0 items-center gap-2.5 sheet p-1 pr-2",
        detached && "text-muted"
      )}>
      <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-surface-secondary text-muted">
        {media}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm leading-5 font-medium">{title}</span>
        <span className="truncate text-xs leading-4 text-muted">
          {description}
        </span>
      </span>
      {action}
    </li>
  );
}

/** The listing on screen, sent with each message unless the user detaches it. */
export function FocusAttachment({ focus }: { focus: SymbolRef }) {
  const { t } = useTranslation();
  const name = useListingName(focus);
  const quote = useQuery(quoteQuery(focus));
  const detachedFocus = useAgentStore((state) => state.detachedFocus);
  const setDetachedFocus = useAgentStore((state) => state.setDetachedFocus);

  const key = symbolKey(focus);
  const attached = key !== detachedFocus;
  const label = [focus.symbol, name].filter(Boolean).join(" ");
  const market = t(`market.${focus.market}`);

  return (
    <AttachmentCard
      detached={!attached}
      media={
        // Its newest session, as its row in the watchlist draws it; a detached one only says what it is.
        attached && quote.data ? (
          <QuoteLine symbol={focus} className="size-full px-1 py-1.5" />
        ) : (
          <Icon icon={ChartCandlestickIcon} className="size-4" />
        )
      }
      title={name ?? focus.symbol}
      description={
        attached
          ? [name && focus.symbol, market].filter(Boolean).join(" · ")
          : t("agent.context.detached")
      }
      action={
        attached ? (
          <CloseButton
            aria-label={t("agent.context.detach", { label })}
            className="size-5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100"
            onPress={() => setDetachedFocus(key)}
          />
        ) : (
          <Button
            size="sm"
            variant="ghost"
            aria-label={t("agent.context.attach-label", { label })}
            className="h-6 px-2 text-xs"
            onPress={() => setDetachedFocus(null)}>
            {t("agent.context.attach")}
          </Button>
        )
      }
    />
  );
}
