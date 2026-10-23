import { AlertDialog, Button } from "@heroui/react";
import { useTranslation } from "react-i18next";

/**
 * Opens a link the model wrote in the browser only after the user reads the address, since
 * nothing checked where it points.
 */
export function AgentLinkDialog({
  href,
  isOpen,
  onOpenChange,
}: {
  href: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}) {
  const { t } = useTranslation();

  return (
    <AlertDialog isOpen={isOpen} onOpenChange={onOpenChange}>
      <AlertDialog.Backdrop>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-md">
            <AlertDialog.Header>
              <AlertDialog.Heading>{t("agent.link.title")}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="flex flex-col gap-3">
              <p className="text-sm text-muted">
                {t("agent.link.description")}
              </p>
              <p className="rounded-sm bg-surface-secondary px-3 py-2 font-mono text-xs break-all">
                {href}
              </p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="tertiary" onPress={() => onOpenChange(false)}>
                {t("agent.link.cancel")}
              </Button>
              <Button
                onPress={() => {
                  // The main process opens https links in the system browser.
                  window.open(href, "_blank", "noreferrer");
                  onOpenChange(false);
                }}>
                {t("agent.link.open")}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}
