import { useTranslation } from "react-i18next";

import { CollectionJob } from "@solyx/core/schedule";

import { Section } from "../../components/section.tsx";
import { CollectionList } from "../schedules/collection-settings.tsx";

// First-run setup asks only about the news of listings; themes come later, with the first theme.
const JOBS = [CollectionJob.News];

/** Where news comes from and when it is collected without the agent asking, as first-run setup shows it. */
export function NewsSettings() {
  const { t } = useTranslation();

  return (
    <Section
      title={t("settings.news.title")}
      description={t("settings.news.description")}>
      <CollectionList jobs={JOBS} />
    </Section>
  );
}
