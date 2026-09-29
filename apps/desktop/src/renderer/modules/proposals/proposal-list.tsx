import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { ProposalCard } from "./proposal-card.tsx";
import { proposalsQuery } from "./proposals-query.ts";

export function ProposalList() {
  const { t } = useTranslation();
  const { data, error } = useQuery(proposalsQuery());

  if (error) return <p className="text-danger">{error.message}</p>;

  if (!data) return <p className="text-muted">{t("common.loading")}</p>;

  if (data.length === 0)
    return <p className="text-muted">{t("proposals.empty")}</p>;

  return (
    <div className="flex flex-col gap-6">
      {data.toReversed().map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} />
      ))}
    </div>
  );
}
