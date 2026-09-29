import { Card } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { ProposalForm } from "../modules/proposals/proposal-form.tsx";
import { ProposalList } from "../modules/proposals/proposal-list.tsx";

export function ProposalsPage() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <Card.Header>
          <Card.Title>{t("proposals.form-title")}</Card.Title>
          <Card.Description>{t("proposals.form-description")}</Card.Description>
        </Card.Header>
        <Card.Content>
          <ProposalForm />
        </Card.Content>
      </Card>
      <ProposalList />
    </div>
  );
}
