import { useState } from "react";

import { Button, Chip } from "@heroui/react";
import type { ChipProps } from "@heroui/react";
import { buttonVariants } from "@heroui/styles";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { BacktestRecord } from "@solyx/api/backtests";
import { SettingsSection } from "@solyx/api/settings-section";
import type { StrategyEntry } from "@solyx/api/strategies";
import { symbolLabel } from "@solyx/core/market";
import { strategyNameSchema } from "@solyx/core/strategy";
import type { StrategyReach } from "@solyx/core/strategy";

import { useClock } from "../../app/clock.ts";
import { inWindow } from "../../app/device.ts";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { Section } from "../../components/section.tsx";
import {
  useOpenRecord,
  useRecordWords,
} from "../backtests/backtest-history.tsx";
import { historyQuery } from "../backtests/history-query.ts";

import { strategiesQuery, strategyRuntimesQuery } from "./strategies-query.ts";
import {
  BacktestOn,
  ChangeWithAgent,
  RevealStrategy,
  TrashStrategy,
  WriteWithAgent,
} from "./strategy-actions.tsx";
import {
  StrategyStanding,
  strategyStanding,
  useStrategyWords,
} from "./strategy-words.ts";

const STANDING_COLOR: Record<StrategyStanding, ChipProps["color"]> = {
  [StrategyStanding.Allowed]: "success",
  [StrategyStanding.ElsewhereOnly]: "warning",
  [StrategyStanding.Changed]: "warning",
  [StrategyStanding.New]: "default",
};

/** Whether `strategy` may run where its code would now, as a chip. */
export function StandingChip({
  strategy,
  reach,
}: {
  strategy: StrategyEntry;
  reach: StrategyReach;
}) {
  const words = useStrategyWords();

  return (
    <Chip size="sm" color={STANDING_COLOR[strategyStanding(strategy)]}>
      {words.standing(strategy, reach)}
    </Chip>
  );
}

/** The runs windows kept of `name`, on any listing, newest first. */
export function useKeptRuns(name: string) {
  const history = useQuery(historyQuery());

  return {
    ...history,
    data: history.data?.filter(({ request: { setup } }) =>
      "name" in setup.strategy ? setup.strategy.name === name : false
    ),
  };
}

/** One run kept of a strategy: the listing, the span, how it did, and a way to open it again. */
export function KeptRun({ record }: { record: BacktestRecord }) {
  const { t } = useTranslation();
  const clock = useClock();
  const words = useRecordWords();
  const open = useOpenRecord();

  return (
    <div className="flex items-start gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs text-muted tabular-nums">
          {symbolLabel(record.request.setup.symbol)} · {words.reach(record)} ·{" "}
          {clock.time(record.ranAt)}
        </span>
        <span className="text-xs tabular-nums">{words.headline(record)}</span>
      </div>
      <Button size="sm" variant="tertiary" onPress={() => open(record)}>
        {t("backtests.history.open")}
      </Button>
    </div>
  );
}

/** A strategy as the list shows it: what it is, whether it may run, how it did last, and what to do with it. */
function StrategyCard({
  strategy,
  reach,
}: {
  strategy: StrategyEntry;
  reach: StrategyReach;
}) {
  const { t } = useTranslation();
  const words = useStrategyWords();
  const kept = useKeptRuns(strategy.name);
  const [backtesting, setBacktesting] = useState(false);
  const last = kept.data?.at(0);

  return (
    <li className="flex flex-col gap-2 border-b border-separator py-4 last:border-b-0">
      <header className="flex flex-wrap items-center gap-2">
        <Link
          to="/strategies/$name"
          params={{ name: strategy.name }}
          className="font-mono text-sm font-semibold hover:underline">
          {strategy.name}
        </Link>
        <StandingChip strategy={strategy} reach={reach} />
      </header>
      <p className="text-sm">{strategy.description}</p>
      <ul className="flex flex-col gap-0.5 text-xs text-muted">
        {words.rules(strategy).map((line) => (
          <li key={line}>{line}</li>
        ))}
        {words.params(strategy).length > 0 ? (
          <li>
            {words.params(strategy).join(t("strategies.page.list-joiner"))}
          </li>
        ) : null}
      </ul>
      {last ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium">
            {t("strategies.page.last-run")}
          </span>
          <KeptRun record={last} />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant={backtesting ? "secondary" : "tertiary"}
          isDisabled={!strategy.allowed}
          onPress={() => setBacktesting((open) => !open)}>
          {t("strategies.page.backtest")}
        </Button>
        <ChangeWithAgent name={strategy.name} />
        <Link
          to="/strategies/$name"
          params={{ name: strategy.name }}
          className={buttonVariants({ size: "sm", variant: "tertiary" })}>
          {strategy.allowed
            ? t("strategies.page.details")
            : t("strategies.page.details-allow")}
        </Link>
      </div>
      {backtesting ? <BacktestOn strategy={strategy} /> : null}
    </li>
  );
}

/**
 * The strategies the user wrote, each with whether it may run, how it did last and what to do with
 * it; with none written, what a strategy is and how to start one.
 */
export function StrategyList() {
  const { t } = useTranslation();
  const catalog = useQuery(strategiesQuery());

  if (catalog.error) {
    return (
      <LoadError error={catalog.error} onRetry={() => void catalog.refetch()} />
    );
  }

  if (!catalog.data) return <LoadingState />;

  const { strategies, reach } = catalog.data;

  if (strategies.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <ul className="flex max-w-prose list-disc flex-col gap-1 pl-5 text-sm">
          <li>{t("strategies.page.empty-lines")}</li>
          <li>{t("strategies.page.empty-engine")}</li>
          <li>{t("strategies.page.empty-allowed")}</li>
        </ul>
        <div className="flex flex-wrap gap-1.5">
          <WriteWithAgent />
          <RevealStrategy name={null} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        <WriteWithAgent />
        <RevealStrategy name={null} />
      </div>
      <ul className="flex flex-col">
        {strategies.map((strategy) => (
          <StrategyCard key={strategy.name} strategy={strategy} reach={reach} />
        ))}
      </ul>
    </div>
  );
}

// `<folder>/<name>/STRATEGY.md: why`, as the backend names a folder it could not read.
const PROBLEM = /([^/\\]+)[/\\]STRATEGY\.md: ([\s\S]*)$/;

/** The folders that hold no strategy that reads, each with why, as a section; nothing while there are none. */
export function StrategyProblems() {
  const { t } = useTranslation();
  const catalog = useQuery(strategiesQuery());
  const problems = catalog.data?.problems ?? [];

  if (problems.length === 0) return null;

  return (
    <Section
      title={t("strategies.page.problems")}
      description={t("strategies.page.problems-description")}>
      <ul className="flex flex-col gap-3">
        {problems.map((problem) => {
          const match = PROBLEM.exec(problem);
          const folder = match?.[1];

          return (
            <li key={problem} className="flex flex-col gap-1">
              {folder ? (
                <span className="font-mono text-sm">{folder}/</span>
              ) : null}
              <span className="text-xs whitespace-pre-wrap text-muted">
                {match?.[2] ?? problem}
              </span>
              <div className="flex gap-1.5">
                <RevealStrategy name={null} />
                {folder && strategyNameSchema.safeParse(folder).success ? (
                  <TrashStrategy name={folder} />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** Where a strategy's code would run now, and a link to the switch that decides it. */
function RunsWhere() {
  const { t } = useTranslation();
  const reach = useQuery(strategiesQuery()).data?.reach;

  if (!reach) return null;

  const where = reach.sandboxed
    ? "strategies.page.sandboxed"
    : reach.live
      ? "strategies.page.outside-live"
      : "strategies.page.outside";

  return (
    <p className="text-sm">
      {t(where)}{" "}
      {inWindow ? (
        <Link
          to="/settings"
          search={{ section: SettingsSection.CodeExecution }}
          className="text-accent underline underline-offset-2">
          {t("strategies.page.sandbox-setting")}
        </Link>
      ) : null}
    </p>
  );
}

/** The interpreters a strategy's code finds where it would run, read only in this computer's windows. */
function RuntimeList() {
  const { t } = useTranslation();
  const runtimes = useQuery({ ...strategyRuntimesQuery(), enabled: inWindow });

  if (!inWindow) {
    return (
      <p className="text-xs text-muted">
        {t("strategies.page.runtimes-on-computer")}
      </p>
    );
  }

  if (runtimes.error) {
    return (
      <LoadError
        error={runtimes.error}
        onRetry={() => void runtimes.refetch()}
      />
    );
  }

  if (!runtimes.data) return <LoadingState />;

  if (runtimes.data.length === 0) {
    return (
      <p className="text-sm text-muted">{t("strategies.page.no-runtimes")}</p>
    );
  }

  return (
    <ul className="flex flex-col gap-1 text-sm">
      {runtimes.data.map((runtime) => (
        <li key={runtime.command} className="flex flex-wrap gap-x-2">
          <span className="font-mono">{runtime.command}</span>
          <span className="text-muted">{runtime.version}</span>
          {Object.keys(runtime.packages).length > 0 ? (
            <span className="text-xs text-muted">
              {Object.entries(runtime.packages)
                .map(([name, version]) => `${name} ${version}`)
                .join(", ")}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Where a strategy's code would run now, and what it finds there to run on. */
export function StrategyRuntimes() {
  return (
    <div className="flex flex-col gap-3">
      <RunsWhere />
      <RuntimeList />
    </div>
  );
}
