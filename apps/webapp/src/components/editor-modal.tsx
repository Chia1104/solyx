import type { ReactNode } from "react";

import { Button, Modal } from "@heroui/react";
import { useTranslation } from "react-i18next";

/**
 * A setting's editor or details over the page rather than in it, so opening one neither moves
 * the page nor leaves it. `children` are the dialog's `Modal.Body` and, for a form, its
 * `Modal.Footer`, which stays in view however long the body runs. A click beside it keeps it
 * open, since what was typed would go with it.
 */
export function EditorModal({
  title,
  description,
  isOpen,
  onClose,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal.Backdrop
      isOpen={isOpen}
      isDismissable={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}>
      <Modal.Container scroll="inside" size="lg">
        <Modal.Dialog className="gap-5">
          <Modal.CloseTrigger />
          <Modal.Header className="gap-1 pr-8">
            <Modal.Heading className="truncate">{title}</Modal.Heading>
            {description ? (
              <p className="text-sm text-muted">{description}</p>
            ) : null}
          </Modal.Header>
          {children}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

/**
 * A form's actions at the foot of its modal: removing what it edits, where it can, apart from
 * the rest, then cancelling and saving.
 */
export function EditorFooter({
  saving,
  onCancel,
  saveLabel,
  remove,
}: {
  saving: boolean;
  onCancel: () => void;
  saveLabel?: string;
  remove?: { label: string; pending: boolean; onPress: () => void };
}) {
  const { t } = useTranslation();

  return (
    <Modal.Footer>
      {remove ? (
        <Button
          variant="tertiary"
          className="mr-auto"
          isPending={remove.pending}
          isDisabled={saving}
          onPress={remove.onPress}>
          {remove.label}
        </Button>
      ) : null}
      <Button
        variant="tertiary"
        isDisabled={saving || remove?.pending}
        onPress={onCancel}>
        {t("common.cancel")}
      </Button>
      <Button type="submit" variant="secondary" isPending={saving}>
        {saveLabel ?? t("settings.save")}
      </Button>
    </Modal.Footer>
  );
}
