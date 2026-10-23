import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { Button, Tooltip } from "@heroui/react";
import {
  Copy01Icon,
  PencilEdit02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";

import { Icon } from "../../components/icon.tsx";

import { useAgentStore } from "./agent-store.ts";

const TOOLTIP_DELAY = 600;

// How long a copied message shows a check.
const COPIED_MS = 1500;

function MessageAction({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip delay={TOOLTIP_DELAY}>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={label}
        className="size-6 text-muted"
        onPress={onPress}>
        {children}
      </Button>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}

export function CopyAction({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;

    const timer = setTimeout(() => setCopied(false), COPIED_MS);

    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <MessageAction
      label={copied ? t("agent.copied") : t("agent.copy")}
      onPress={() =>
        void navigator.clipboard.writeText(text).then(() => setCopied(true))
      }>
      {copied ? (
        <Icon icon={Tick02Icon} className="size-3.5" />
      ) : (
        <Icon icon={Copy01Icon} className="size-3.5" />
      )}
    </MessageAction>
  );
}

/** Puts a message back in the composer to change and send as a new one; the original stays. */
export function EditAction({ text }: { text: string }) {
  const { t } = useTranslation();
  const setDraft = useAgentStore((state) => state.setDraft);

  return (
    <MessageAction
      label={t("agent.edit-message")}
      onPress={() => setDraft(text)}>
      <Icon icon={PencilEdit02Icon} className="size-3.5" />
    </MessageAction>
  );
}
