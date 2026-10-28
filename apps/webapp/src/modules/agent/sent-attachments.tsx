import { useState } from "react";

import { Tooltip } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "react-aria-components";
import { useTranslation } from "react-i18next";

import { AttachmentKind, PDF_TYPE } from "@solyx/agent/attachment";
import type { AttachmentView } from "@solyx/agent/attachment";

import { orpc } from "../../app/rpc.ts";

import {
  AttachmentPreview,
  FileMedia,
  ImagePreview,
  PreviewQuery,
  TextPreview,
  useFileDescription,
} from "./attachment-preview.tsx";

const TOOLTIP_DELAY = 300;

/** A file a sent message carried, by where it stands among the message's files. */
interface CarriedInput {
  id: string;
  messageId: string;
  index: number;
}

/** What a sent file is, from the type its message names. */
const sentKind = (mimeType: string): AttachmentKind => {
  if (mimeType === PDF_TYPE) return AttachmentKind.Pdf;

  return mimeType.startsWith("image/")
    ? AttachmentKind.Image
    : AttachmentKind.Text;
};

// A sent image as its message keeps it, scaled for the model, which is the one copy kept of it.
const sentImage = (input: CarriedInput) =>
  orpc.agent.attachmentImage.queryOptions({
    input,
    // What a message carried never changes.
    staleTime: Number.POSITIVE_INFINITY,
  });

function SentImage({ input }: { input: CarriedInput }) {
  const { data } = useQuery(sentImage(input));

  return <FileMedia kind={AttachmentKind.Image} blob={data} />;
}

function SentImagePreview({
  input,
  name,
}: {
  input: CarriedInput;
  name: string;
}) {
  return (
    <PreviewQuery query={useQuery(sentImage(input))}>
      {(blob) => <ImagePreview blob={blob} name={name} />}
    </PreviewQuery>
  );
}

// Read only once the preview opens, since a long file's text is kept apart from its message.
function SentTextPreview({
  input,
  pdf,
}: {
  input: CarriedInput;
  pdf: boolean;
}) {
  const { t } = useTranslation();

  const query = useQuery(
    orpc.agent.attachmentText.queryOptions({
      input,
      staleTime: Number.POSITIVE_INFINITY,
    })
  );

  return (
    <PreviewQuery query={query}>
      {(text) =>
        text ? (
          <TextPreview {...text} pdf={pdf} />
        ) : (
          <p className="text-sm text-muted">{t("agent.attachments.gone")}</p>
        )
      }
    </PreviewQuery>
  );
}

/**
 * One file a sent message carried, as its picture alone: resting the pointer on it names it, and
 * pressing it opens it.
 */
function SentFile({
  input,
  attachment,
}: {
  input: CarriedInput;
  attachment: AttachmentView;
}) {
  const { t } = useTranslation();
  const describe = useFileDescription();
  const [previewing, setPreviewing] = useState(false);

  const kind = sentKind(attachment.mimeType);
  const description = describe(attachment.mimeType, attachment.size);

  return (
    <li>
      <Tooltip delay={TOOLTIP_DELAY}>
        <Button
          aria-label={t("agent.attachments.preview", {
            name: attachment.name,
          })}
          className="flex size-12 cursor-pointer items-center justify-center overflow-hidden sheet text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent"
          onPress={() => setPreviewing(true)}>
          {kind === AttachmentKind.Image ? (
            <SentImage input={input} />
          ) : (
            <FileMedia kind={kind} />
          )}
        </Button>
        <Tooltip.Content className="flex max-w-64 flex-col">
          <span className="truncate font-medium">{attachment.name}</span>
          <span className="text-muted">{description}</span>
        </Tooltip.Content>
      </Tooltip>
      <AttachmentPreview
        name={attachment.name}
        description={description}
        isOpen={previewing}
        onClose={() => setPreviewing(false)}>
        {kind === AttachmentKind.Image ? (
          <SentImagePreview input={input} name={attachment.name} />
        ) : (
          <SentTextPreview input={input} pdf={kind === AttachmentKind.Pdf} />
        )}
      </AttachmentPreview>
    </li>
  );
}

/** The files a sent message carried, as their pictures above its text. */
export function SentAttachments({
  sessionId,
  messageId,
  attachments,
}: {
  sessionId: string;
  messageId: string;
  attachments: readonly AttachmentView[];
}) {
  const { t } = useTranslation();

  return (
    <ul
      aria-label={t("agent.context.attachments")}
      className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
      {attachments.map((attachment, index) => (
        <SentFile
          // A message's files never change, so where each stands among them names it.
          key={index}
          input={{ id: sessionId, messageId, index }}
          attachment={attachment}
        />
      ))}
    </ul>
  );
}
