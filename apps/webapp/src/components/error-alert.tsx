import { Alert, Button } from "@heroui/react";
import { useTranslation } from "react-i18next";

/** A failed load or action; offer `onRetry` only where repeating it is safe. */
export function ErrorAlert({
  title,
  description,
  onRetry,
}: {
  title: string;
  description?: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Alert status="danger" role="alert">
      <Alert.Indicator />
      {/* Lets the text wrap instead of pushing the retry button out, even through a long URL. */}
      <Alert.Content className="min-w-0">
        <Alert.Title>{title}</Alert.Title>
        {description ? (
          <Alert.Description className="wrap-anywhere whitespace-pre-line">
            {description}
          </Alert.Description>
        ) : null}
      </Alert.Content>
      {onRetry ? (
        <Button
          size="sm"
          variant="danger-soft"
          className="shrink-0"
          onPress={onRetry}>
          {t("common.retry")}
        </Button>
      ) : null}
    </Alert>
  );
}
