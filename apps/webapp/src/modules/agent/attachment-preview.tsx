import { useCallback } from "react";
import type { ReactNode } from "react";

import { Modal } from "@heroui/react";
import { File02Icon, Pdf02Icon } from "@hugeicons/core-free-icons";
import type { UseQueryResult } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import {
  AttachmentImageType,
  AttachmentKind,
  PDF_TYPE,
} from "@solyx/agent/attachment";
import type { FileText } from "@solyx/api/agent";
import { formatBytes } from "@solyx/utils/format";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { Icon } from "../../components/icon.tsx";
import { LoadingState } from "../../components/loading-state.tsx";

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
  [PDF_TYPE, "PDF"],
]);

/** What a file is and how large, as its card says it: "CSV · 12 kB". */
export function useFileDescription() {
  const { t, i18n } = useTranslation();

  return (mimeType: string, size: number) =>
    `${TYPE_LABELS.get(mimeType) ?? t("agent.attachments.text")} · ${formatBytes(size, i18n.language)}`;
}

// Shown the image itself, or a page for a PDF or a text file.
export function FileMedia({
  kind,
  blob,
}: {
  kind: AttachmentKind;
  blob?: Blob;
}) {
  const source = useBlobSource(blob);

  if (kind === AttachmentKind.Image) {
    return <img ref={source} alt="" className="size-full object-cover" />;
  }

  return (
    <Icon
      icon={kind === AttachmentKind.Pdf ? Pdf02Icon : File02Icon}
      className="size-4"
    />
  );
}

/**
 * A file a message carries, opened over the page: the image, or the text the agent reads of it.
 * A click beside it closes it, since nothing in it is edited.
 */
export function AttachmentPreview({
  name,
  description,
  isOpen,
  onClose,
  children,
}: {
  name: string;
  description: string;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal.Backdrop
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}>
      <Modal.Container scroll="inside" size="lg">
        <Modal.Dialog className="gap-4">
          <Modal.CloseTrigger />
          <Modal.Header className="gap-1 pr-8">
            <Modal.Heading className="truncate">{name}</Modal.Heading>
            <p className="text-sm text-muted">{description}</p>
          </Modal.Header>
          <Modal.Body>{children}</Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

/** An image as large as the preview allows, and never past its own size. */
export function ImagePreview({
  blob,
  name,
}: {
  blob: Blob | undefined;
  name: string;
}) {
  const source = useBlobSource(blob);

  return (
    <img
      ref={source}
      alt={name}
      className="mx-auto max-h-[70vh] max-w-full rounded-sm object-contain"
    />
  );
}

/**
 * A file's text as the agent reads it, from its start, saying where it stops short of the end. A
 * PDF's is the text read of it, which is all the agent sees of the file.
 */
export function TextPreview({
  text,
  characters,
  pdf = false,
}: FileText & { pdf?: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2">
      {pdf ? (
        <p className="text-xs text-muted">{t("agent.attachments.pdf-text")}</p>
      ) : null}
      <pre className="well p-3 font-mono text-xs leading-5 wrap-anywhere whitespace-pre-wrap">
        {text}
      </pre>
      {text.length < characters ? (
        <p className="text-xs text-muted">
          {t("agent.attachments.preview-cut", {
            shown: text.length,
            total: characters,
          })}
        </p>
      ) : null}
    </div>
  );
}

/** What a preview read from the backend shows, once it has come, or why it could not. */
export function PreviewQuery<T>({
  query,
  children,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
}) {
  const { t } = useTranslation();

  if (query.isPending) return <LoadingState />;

  if (query.isError) {
    return (
      <ErrorAlert
        title={t("agent.attachments.preview-failed")}
        description={query.error.message}
      />
    );
  }

  return children(query.data);
}
