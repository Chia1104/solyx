import { EmptyState } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadingState } from "../../components/loading-state.tsx";

import { ProposalCard } from "./proposal-card.tsx";
import { proposalsQuery } from "./proposals-query.ts";

export function ProposalList() {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(proposalsQuery());

  if (error) {
    return (
      <ErrorAlert
        title={t("common.load-failed")}
        description={error.message}
        onRetry={() => void refetch()}
      />
    );
  }

  if (!data) return <LoadingState />;

  if (data.length === 0) return <EmptyState>{t("proposals.empty")}</EmptyState>;

  return (
    <div className="flex flex-col gap-6">
      {data.toReversed().map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} />
      ))}
    </div>
  );
}
