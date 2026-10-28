import { useEffect, useRef, useState } from "react";
import type { ReactNode, Ref } from "react";

import { Button, CloseButton, ScrollShadow, cn } from "@heroui/react";
import { ChartCandlestickIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { FileTrigger, Pressable } from "react-aria-components";
import { useTranslation } from "react-i18next";

import { AttachmentKind } from "@solyx/agent/attachment";
import { previewText } from "@solyx/api/agent";
import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { orpc } from "../../app/rpc.ts";
import { Icon } from "../../components/icon.tsx";
import { useListingName } from "../market/listing-name.tsx";
import { QuoteLine } from "../market/quote-figures.tsx";
import { quoteQuery } from "../market/quote-query.ts";

import { useAgentStore } from "./agent-store.ts";
import {
  AttachmentPreview,
  FileMedia,
  ImagePreview,
  PreviewQuery,
  TextPreview,
  useFileDescription,
} from "./attachment-preview.tsx";
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
 * One thing a message carries: its picture, its name and what it is, which open it where it can
 * be opened, and the one thing the user may do with it, which waits for the pointer unless it is
 * all the card offers.
 */
function AttachmentCard({
  ref,
  media,
  title,
  description,
  warning,
  action,
  detached = false,
  onOpen,
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
  /** Opens what it is, as a preview. */
  onOpen?: () => void;
}) {
  const { t } = useTranslation();

  const face = (
    <>
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
    </>
  );

  return (
    <li
      ref={ref}
      className={cn(
        "group flex w-56 shrink-0 items-center gap-2.5 sheet p-1 pr-2",
        detached && "text-muted"
      )}>
      {onOpen ? (
        <Pressable onPress={onOpen}>
          <span
            role="button"
            tabIndex={0}
            aria-label={t("agent.attachments.preview", { name: title })}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent">
            {face}
          </span>
        </Pressable>
      ) : (
        face
      )}
      {action}
    </li>
  );
}

// A card added to the end of a row that has scrolled comes into view.
const reveal = (card: HTMLLIElement | null) =>
  card?.scrollIntoView({ block: "nearest", inline: "nearest" });

/** A file the next message carries, which the user may take off it. */
function FileAttachment({
  pending,
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
  const [previewing, setPreviewing] = useState(false);

  const { file, attachment } = pending;
  const description = describe(attachment.mimeType, attachment.size);

  return (
    <>
      <AttachmentCard
        ref={reveal}
        media={<FileMedia kind={attachment.kind} blob={file} />}
        title={attachment.name}
        description={description}
        warning={unreadable ? t("agent.attachments.unreadable") : undefined}
        onOpen={() => setPreviewing(true)}
        action={
          <CloseButton
            aria-label={t("agent.attachments.remove", {
              name: attachment.name,
            })}
            className="size-5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100"
            onPress={onRemove}
          />
        }
      />
      <AttachmentPreview
        name={attachment.name}
        description={description}
        isOpen={previewing}
        onClose={() => setPreviewing(false)}>
        <PendingPreview pending={pending} />
      </AttachmentPreview>
    </>
  );
}

// A PDF's text is read by the backend as sending it reads it, so the preview is what the agent gets.
function PendingPdfPreview({ id, file }: { id: string; file: File }) {
  const query = useQuery(
    orpc.agent.fileText.queryOptions({
      input: file,
      // A file is no key of its own, since every file hashes alike.
      queryKey: [...orpc.agent.fileText.key(), id],
      staleTime: Number.POSITIVE_INFINITY,
    })
  );

  return (
    <PreviewQuery query={query}>
      {(text) => <TextPreview {...text} pdf />}
    </PreviewQuery>
  );
}

/** A file the next message carries, as the preview shows it: the image, or the text the agent reads. */
function PendingPreview({
  pending: { id, file, attachment },
}: {
  pending: PendingFile;
}) {
  switch (attachment.kind) {
    case AttachmentKind.Image:
      return <ImagePreview blob={file} name={attachment.name} />;
    case AttachmentKind.Text:
      return <TextPreview {...previewText(attachment.text)} />;
    case AttachmentKind.Pdf:
      return <PendingPdfPreview id={id} file={file} />;
  }
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
