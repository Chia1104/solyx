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
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
        {description ? (
          <Alert.Description>{description}</Alert.Description>
        ) : null}
      </Alert.Content>
      {onRetry ? (
        <Button size="sm" variant="danger-soft" onPress={onRetry}>
          {t("common.retry")}
        </Button>
      ) : null}
    </Alert>
  );
}
