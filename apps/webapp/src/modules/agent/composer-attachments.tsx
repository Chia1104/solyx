import { useCallback, useEffect, useRef } from "react";
import type { ReactNode, Ref } from "react";

import { Button, CloseButton, ScrollShadow, cn } from "@heroui/react";
import {
  ChartCandlestickIcon,
  File02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { FileTrigger } from "react-aria-components";
import { useTranslation } from "react-i18next";

import { AttachmentImageType, AttachmentKind } from "@solyx/agent/attachment";
import type { AttachmentView } from "@solyx/agent/attachment";
import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { formatBytes } from "@solyx/utils/format";

import { orpc } from "../../app/rpc.ts";
import { Icon } from "../../components/icon.tsx";
import { useListingName } from "../market/listing-name.tsx";
import { QuoteLine } from "../market/quote-figures.tsx";
import { quoteQuery } from "../market/quote-query.ts";

import { useAgentStore } from "./agent-store.ts";
import type { PendingFile } from "./composer-files.ts";

/**
 * What the next message carries, as cards along the top of the composer. The row scrolls sideways
 * once they outgrow it, and a mouse's wheel scrolls it too, since a wheel only turns up and down.
 */
function ComposerAttachments({ children }: { children: ReactNode }) {
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
  ref,
  media,
  title,
  description,
  warning,
  action,
  detached = false,
}: {
  ref?: Ref<HTMLLIElement>;
  /** A thumbnail or an icon, which fills the square the card opens with. */
  media: ReactNode;
  title: string;
  description: string;
  /** Why the message cannot carry it as it stands, said in place of the description. */
  warning?: string;
  action?: ReactNode;
  /** The message will be sent without it. */
  detached?: boolean;
}) {
  return (
    <li
      ref={ref}
      className={cn(
        "group flex w-56 shrink-0 items-center gap-2.5 sheet p-1 pr-2",
        detached && "text-muted"
      )}>
      <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-surface-secondary text-muted">
        {media}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm leading-5 font-medium">{title}</span>
        <span
          className={cn(
            "truncate text-xs leading-4",
            warning ? "text-warning" : "text-muted"
          )}>
          {warning ?? description}
        </span>
      </span>
      {action}
    </li>
  );
}

/** Shows `blob` in the image it is the ref of, for as long as that image shows it. */
function useBlobSource(blob: Blob | undefined) {
  return useCallback(
    (image: HTMLImageElement | null) => {
      if (!image || !blob) return;

      const url = URL.createObjectURL(blob);

      image.src = url;

      return () => URL.revokeObjectURL(url);
    },
    [blob]
  );
}

const TYPE_LABELS = new Map([
  [AttachmentImageType.Png, "PNG"],
  [AttachmentImageType.Jpeg, "JPEG"],
  [AttachmentImageType.Gif, "GIF"],
  [AttachmentImageType.Webp, "WebP"],
  ["text/csv", "CSV"],
  ["text/tab-separated-values", "TSV"],
  ["text/markdown", "Markdown"],
  ["application/json", "JSON"],
]);

/** What a file is and how large, as its card says it: "CSV · 12 kB". */
function useFileDescription() {
  const { t, i18n } = useTranslation();

  return (mimeType: string, size: number) =>
    `${TYPE_LABELS.get(mimeType) ?? t("agent.attachments.text")} · ${formatBytes(size, i18n.language)}`;
}

// Shown the image itself, or the page of text a text file is.
function FileMedia({ kind, blob }: { kind: AttachmentKind; blob?: Blob }) {
  const source = useBlobSource(blob);

  return kind === AttachmentKind.Image ? (
    <img ref={source} alt="" className="size-full object-cover" />
  ) : (
    <Icon icon={File02Icon} className="size-4" />
  );
}

// A card added to the end of a row that has scrolled comes into view.
const reveal = (card: HTMLLIElement | null) =>
  card?.scrollIntoView({ block: "nearest", inline: "nearest" });

/** A file the next message carries, which the user may take off it. */
function FileAttachment({
  pending: { file, attachment },
  unreadable,
  onRemove,
}: {
  pending: PendingFile;
  /** The conversation's model sees no images, so this one keeps the message from going. */
  unreadable: boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const describe = useFileDescription();

  return (
    <AttachmentCard
      ref={reveal}
      media={<FileMedia kind={attachment.kind} blob={file} />}
      title={attachment.name}
      description={describe(attachment.mimeType, attachment.size)}
      warning={unreadable ? t("agent.attachments.unreadable") : undefined}
      action={
        <CloseButton
          aria-label={t("agent.attachments.remove", { name: attachment.name })}
          className="size-5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100"
          onPress={onRemove}
        />
      }
    />
  );
}

/** Picks files from the computer for the next message. */
export function AttachButton({
  accepts,
  isDisabled,
  onPick,
}: {
  /** What the picker offers, which the files are read against again once picked. */
  accepts: readonly string[];
  isDisabled?: boolean;
  onPick: (files: File[]) => void;
}) {
  const { t } = useTranslation();

  return (
    <FileTrigger
      allowsMultiple
      acceptedFileTypes={accepts}
      onSelect={(list) => onPick([...(list ?? [])])}>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={t("agent.attachments.add")}
        isDisabled={isDisabled}>
        <Icon icon={PlusSignIcon} />
      </Button>
    </FileTrigger>
  );
}

// A sent image, read from the conversation's folder as it was attached.
function SentImage({ sessionId, path }: { sessionId: string; path: string }) {
  const { data } = useQuery(
    orpc.agent.attachment.queryOptions({
      input: { id: sessionId, path },
      // What a message carried never changes.
      staleTime: Number.POSITIVE_INFINITY,
    })
  );

  return <FileMedia kind={AttachmentKind.Image} blob={data} />;
}

/** The files a sent message carried, as the composer showed them. */
export function SentAttachments({
  sessionId,
  attachments,
}: {
  sessionId: string;
  attachments: readonly AttachmentView[];
}) {
  const { t } = useTranslation();
  const describe = useFileDescription();

  return (
    <ul
      aria-label={t("agent.context.attachments")}
      className="flex max-w-[85%] flex-wrap justify-end gap-2">
      {attachments.map((attachment) => (
        <AttachmentCard
          key={attachment.path}
          media={
            attachment.mimeType.startsWith("image/") ? (
              <SentImage sessionId={sessionId} path={attachment.path} />
            ) : (
              <FileMedia kind={AttachmentKind.Text} />
            )
          }
          title={attachment.name}
          description={describe(attachment.mimeType, attachment.size)}
        />
      ))}
    </ul>
  );
}

/** The listing on screen, sent with each message unless the user detaches it. */
function FocusAttachment({ focus }: { focus: SymbolRef }) {
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

/** What the next message carries along the top of the composer: the listing on screen, then the files. */
export function MessageAttachments({
  focus,
  files,
  blind,
  onRemove,
}: {
  focus: SymbolRef | null;
  files: readonly PendingFile[];
  /** The conversation's model sees no images. */
  blind: boolean;
  onRemove: (id: string) => void;
}) {
  if (!focus && files.length === 0) return null;

  return (
    <ComposerAttachments>
      {focus ? <FocusAttachment focus={focus} /> : null}
      {files.map((pending) => (
        <FileAttachment
          key={pending.id}
          pending={pending}
          unreadable={blind && pending.attachment.kind === AttachmentKind.Image}
          onRemove={() => onRemove(pending.id)}
        />
      ))}
    </ComposerAttachments>
  );
}
