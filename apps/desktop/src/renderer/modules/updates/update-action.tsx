import { Button } from "@heroui/react";
import { buttonVariants } from "@heroui/styles";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { UpdateStatus } from "#shared/ipc/updates.ts";

import { updateStateQuery } from "./updates-query.ts";

/** What an update waiting for the user asks of them: a restart that installs it, or a download. */
export function UpdateAction() {
  const { t } = useTranslation();
  const { data } = useQuery(updateStateQuery());

  const install = useMutation({
    mutationFn: () => window.solyx.updates.install(),
  });

  if (data?.status === UpdateStatus.Ready) {
    return (
      <Button
        size="sm"
        variant="secondary"
        isPending={install.isPending}
        onPress={() => install.mutate()}>
        {t("updates.restart")}
      </Button>
    );
  }

  if (data?.status === UpdateStatus.Available) {
    return (
      <a
        href={data.url}
        target="_blank"
        rel="noreferrer"
        className={buttonVariants({ size: "sm", variant: "secondary" })}>
        {t("updates.download")}
      </a>
    );
  }

  return null;
}
