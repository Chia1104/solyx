import { Disclosure } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { ColumnHeader } from "../components/column-header.tsx";
import { ProposalForm } from "../modules/proposals/proposal-form.tsx";
import { ProposalQueue } from "../modules/proposals/proposal-queue.tsx";

/**
 * Where proposals wait for the user to confirm them. The agent's conversation joins this
 * thread once it exists; until then proposals are made by hand from the form below it.
 */
export function AgentPane() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col">
      <ColumnHeader>
        <h2 className="text-sm font-semibold">{t("agent.title")}</h2>
      </ColumnHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="px-4 py-3 text-xs text-muted">
          {t("agent.not-connected")}
        </p>
        <ProposalQueue />
      </div>
      <Disclosure className="max-h-[70%] shrink-0 overflow-y-auto border-t border-separator">
        <Disclosure.Heading>
          <Disclosure.Trigger className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium">
            {t("proposals.form-title")}
            <Disclosure.Indicator className="ml-auto" />
          </Disclosure.Trigger>
        </Disclosure.Heading>
        <Disclosure.Content>
          <div className="flex flex-col gap-3 px-4 pb-4">
            <p className="text-xs text-muted">
              {t("proposals.form-description")}
            </p>
            <ProposalForm />
          </div>
        </Disclosure.Content>
      </Disclosure>
    </div>
  );
}
