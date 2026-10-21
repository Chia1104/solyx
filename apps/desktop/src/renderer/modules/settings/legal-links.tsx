import { buttonVariants } from "@heroui/styles";
import { useTranslation } from "react-i18next";

import { Locale } from "#shared/settings.ts";

import { Section } from "../../components/section.tsx";

import { SettingsRow } from "./settings-list.tsx";

/** The website, where the terms of use and the privacy policy live in each of the app's languages. */
const SITE_URL = "https://usesolyx.trade";

/** Links that open the terms of use and the privacy policy in the browser, in the app's language. */
function LegalLinks() {
  const { t, i18n } = useTranslation();

  // English takes the site's own paths; every other language is the first segment of the path.
  const base =
    i18n.language === Locale.EnUS ? SITE_URL : `${SITE_URL}/${i18n.language}`;

  return (
    <div className="flex flex-wrap gap-2">
      <a
        href={`${base}/terms`}
        target="_blank"
        rel="noreferrer"
        className={buttonVariants({ size: "sm", variant: "secondary" })}>
        {t("legal.terms")}
      </a>
      <a
        href={`${base}/privacy`}
        target="_blank"
        rel="noreferrer"
        className={buttonVariants({ size: "sm", variant: "secondary" })}>
        {t("legal.privacy")}
      </a>
    </div>
  );
}

/** About's row for the terms of use and the privacy policy. */
export function LegalRow() {
  const { t } = useTranslation();

  return (
    <SettingsRow
      label={t("legal.title")}
      description={t("legal.description")}
      actions={<LegalLinks />}
    />
  );
}

/** First-run setup's note that using Solyx accepts its terms, with both documents a click away. */
export function LegalSection() {
  const { t } = useTranslation();

  return (
    <Section title={t("legal.title")} description={t("legal.notice")}>
      <LegalLinks />
    </Section>
  );
}
