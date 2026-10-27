import { Disclosure } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { useClock } from "../../app/clock.ts";
import { inWindow } from "../../app/device.ts";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { Section } from "../../components/section.tsx";

import { strategiesQuery, strategyReviewQuery } from "./strategies-query.ts";
import {
  BacktestOn,
  ChangeWithAgent,
  RevealStrategy,
  RevokeStrategy,
  TrashStrategy,
  UseLive,
} from "./strategy-actions.tsx";
import { StrategyAllow } from "./strategy-allow.tsx";
import { shortVersion } from "./strategy-changes.tsx";
import { KeptRun, StandingChip, useKeptRuns } from "./strategy-list.tsx";
import { useStrategyWords } from "./strategy-words.ts";

/** One strategy as the catalog lists it, with where code would run; `null` once there is no such strategy. */
function useStrategy(name: string) {
  const catalog = useQuery(strategiesQuery());

  return {
    ...catalog,
    strategy:
      catalog.data?.strategies.find((each) => each.name === name) ?? null,
  };
}

/**
 * Everything of one strategy the user wrote, as sections: what it is and whether it may run, its
 * files, the versions allowed, how it did on each listing and how to trade on it. A name that
 * reads as no strategy says so, with why where its folder does not read.
 */
export function StrategyDetail({ name }: { name: string }) {
  const { t } = useTranslation();
  const { strategy, data, error, refetch } = useStrategy(name);

  if (error) return <LoadError error={error} onRetry={() => void refetch()} />;

  if (!data) return <LoadingState />;

  if (!strategy) {
    const problem = data.problems.find(
      (each) =>
        each.includes(`${name}/STRATEGY.md:`) ||
        each.includes(`${name}\\STRATEGY.md:`)
    );

    return (
      <Section title={t("strategies.page.missing", { name })}>
        <p className="text-sm whitespace-pre-wrap text-muted">
          {problem ?? t("strategies.page.missing-description")}
        </p>
        <Link
          to="/strategies"
          className="text-sm text-accent underline underline-offset-2">
          {t("strategies.page.back")}
        </Link>
      </Section>
    );
  }

  return (
    <>
      <StrategySummary name={name} />
      <StrategyFiles name={name} />
      <StrategyVersions name={name} />
      <StrategyRuns name={name} />
      <Section
        title={t("strategies.page.live-title")}
        description={t("strategies.page.live-description")}>
        <div>
          <UseLive name={name} />
        </div>
      </Section>
    </>
  );
}

function StrategySummary({ name }: { name: string }) {
  const { t } = useTranslation();
  const words = useStrategyWords();
  const { strategy, data } = useStrategy(name);

  if (!strategy || !data) return null;

  return (
    <Section title={strategy.description}>
      <div className="flex flex-wrap items-center gap-2">
        <StandingChip strategy={strategy} reach={data.reach} />
        <span className="font-mono text-xs text-muted">
          {t("strategies.page.version", {
            version: shortVersion(strategy.version),
          })}
        </span>
      </div>
      {strategy.allowed ? null : (
        <StrategyAllow strategy={strategy} reach={data.reach} />
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">{t("strategies.page.run")}</dt>
        <dd className="font-mono">{strategy.run}</dd>
        <dt className="text-muted">{t("strategies.page.rules")}</dt>
        <dd className="flex flex-col">
          {words.rules(strategy).map((line) => (
            <span key={line}>{line}</span>
          ))}
        </dd>
        <dt className="text-muted">{t("strategies.page.params")}</dt>
        <dd className="flex flex-col">
          {words.params(strategy).length === 0
            ? t("strategies.page.no-params")
            : words
                .params(strategy)
                .map((line) => <span key={line}>{line}</span>)}
        </dd>
      </dl>
      {strategy.notes ? (
        <p className="max-w-prose text-sm whitespace-pre-wrap">
          {strategy.notes}
        </p>
      ) : null}
      <BacktestOn strategy={strategy} />
      <div className="flex flex-wrap gap-1.5">
        <ChangeWithAgent name={name} />
        <RevealStrategy name={name} />
        <RevokeStrategy strategy={strategy} />
        <TrashStrategy name={name} />
      </div>
    </Section>
  );
}

/**
 * Each of a strategy's files as it is now, read on this computer, where a window reads the text;
 * a paired browser lists them alone.
 */
function StrategyFiles({ name }: { name: string }) {
  const { t, i18n } = useTranslation();
  const { strategy } = useStrategy(name);
  const review = useQuery({ ...strategyReviewQuery(name), enabled: inWindow });
  const bytes = new Intl.NumberFormat(i18n.language);

  if (!strategy) return null;

  let body = (
    <ul className="flex flex-col gap-1">
      {strategy.files.map((file) => (
        <li key={file.path} className="font-mono text-xs">
          {file.path}{" "}
          <span className="text-muted">
            {t("strategies.page.bytes", {
              count: file.bytes,
              bytes: bytes.format(file.bytes),
            })}
          </span>
        </li>
      ))}
    </ul>
  );

  if (inWindow && review.error) {
    body = (
      <LoadError error={review.error} onRetry={() => void review.refetch()} />
    );
  } else if (inWindow && review.data) {
    body = (
      <div className="flex flex-col gap-2">
        {review.data.current.files.map((file) => (
          <Disclosure key={file.path}>
            <Disclosure.Heading>
              <Disclosure.Trigger className="flex w-full items-center gap-2 text-left">
                <span className="font-mono text-xs">{file.path}</span>
                <span className="text-xs text-muted">
                  {t("strategies.page.bytes", {
                    count: file.bytes,
                    bytes: bytes.format(file.bytes),
                  })}
                </span>
                <Disclosure.Indicator className="ml-auto" />
              </Disclosure.Trigger>
            </Disclosure.Heading>
            <Disclosure.Content>
              <div className="pt-1">
                {file.text === null ? (
                  <p className="text-xs text-muted">
                    {t("strategies.changes.not-text", { path: file.path })}
                  </p>
                ) : (
                  <pre className="max-h-96 overflow-auto rounded-sm bg-surface-secondary p-2 font-mono text-xs">
                    {file.text}
                  </pre>
                )}
              </div>
            </Disclosure.Content>
          </Disclosure>
        ))}
      </div>
    );
  }

  return (
    <Section
      title={t("strategies.page.files")}
      description={
        inWindow
          ? t("strategies.page.files-description")
          : t("strategies.page.files-on-computer")
      }>
      {body}
    </Section>
  );
}

/** The versions of a strategy allowed so far, newest first: who allowed each, when and for where. */
function StrategyVersions({ name }: { name: string }) {
  const { t } = useTranslation();
  const clock = useClock();
  const words = useStrategyWords();
  const { strategy } = useStrategy(name);

  if (!strategy) return null;

  return (
    <Section
      title={t("strategies.page.versions")}
      description={t("strategies.page.versions-description")}>
      {strategy.approvals.length === 0 ? (
        <p className="text-sm text-muted">{t("strategies.page.no-versions")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {strategy.approvals.map((approval) => (
            <li
              key={`${approval.version}-${approval.by}-${approval.outside}`}
              className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-mono text-xs">
                {shortVersion(approval.version)}
              </span>
              {approval.version === strategy.version ? (
                <span className="text-xs">{t("strategies.page.current")}</span>
              ) : null}
              <span className="text-xs text-muted">
                {t(
                  approval.outside
                    ? "strategies.page.version-outside"
                    : "strategies.page.version-sandboxed",
                  {
                    by: words.approver(approval.by),
                    at: clock.time(approval.at),
                  }
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** The runs windows kept of a strategy, on every listing, newest first. */
function StrategyRuns({ name }: { name: string }) {
  const { t } = useTranslation();
  const kept = useKeptRuns(name);

  let body = <LoadingState />;

  if (kept.error) {
    body = <LoadError error={kept.error} onRetry={() => void kept.refetch()} />;
  } else if (kept.data) {
    body =
      kept.data.length === 0 ? (
        <p className="text-sm text-muted">{t("strategies.page.no-runs")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {kept.data.map((record) => (
            <KeptRun key={record.id} record={record} />
          ))}
        </div>
      );
  }

  return (
    <Section
      title={t("strategies.page.runs")}
      description={t("strategies.page.runs-description")}>
      {body}
    </Section>
  );
}
