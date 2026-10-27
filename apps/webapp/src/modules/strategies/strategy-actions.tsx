import { useState } from "react";

import { Button, Input, TextField } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { uniqBy } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { BacktestMode } from "@solyx/api/backtests";
import type { StrategyEntry } from "@solyx/api/strategies";
import { Interval } from "@solyx/core/candles";
import { Market, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { inWindow } from "../../app/device.ts";
import { orpc } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { useAgentDraft } from "../agent/agent-draft.ts";
import { ownRun } from "../backtests/backtest-form-values.ts";
import { useBacktestStore } from "../backtests/backtest-store.ts";
import { LowerView } from "../market/lower-view.ts";
import { watchlistQuery } from "../watchlist/watchlist-query.ts";

// The listings offered as one press each, the rest typed.
const OFFERED_LISTINGS = 6;

/** What the user holds and watches, held first and each once. */
function useFollowed(): SymbolRef[] {
  const account = useQuery(orpc.account.summary.queryOptions());
  const watchlist = useQuery(watchlistQuery());

  return uniqBy(
    [
      ...(account.data?.positions ?? []).map(
        ({ instrument: { market, symbol } }) => ({ market, symbol })
      ),
      ...(watchlist.data ?? []),
    ],
    symbolKey
  );
}

/**
 * Runs an allowed strategy once at its initial numbers, on a listing the user holds or watches or
 * types, in that listing's backtest panel, where its numbers and span can be changed.
 */
export function BacktestOn({ strategy }: { strategy: StrategyEntry }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ask = useBacktestStore((state) => state.ask);
  const followed = useFollowed().slice(0, OFFERED_LISTINGS);
  const [typed, setTyped] = useState("");

  function run(symbol: SymbolRef) {
    const params = Object.fromEntries(
      Object.entries(strategy.params).map(([name, { initial }]) => [
        name,
        initial,
      ])
    );

    ask({
      mode: BacktestMode.Run,
      setup: ownRun(symbol, { name: strategy.name, params }),
    });

    void navigate({
      to: "/symbol/$market/$symbol",
      params: symbol,
      search: { interval: Interval.OneDay, view: LowerView.Backtest },
    });
  }

  if (!strategy.allowed) {
    return (
      <p className="text-xs text-muted">
        {t("strategies.page.backtest-blocked")}
      </p>
    );
  }

  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();

        const code = typed.trim().toUpperCase();

        // Typed codes are Taiwan's, as the title bar's search reads them.
        if (code) run({ market: Market.TW, symbol: code });
      }}>
      <span className="text-xs text-muted">
        {t("strategies.page.backtest-on")}
      </span>
      {followed.map((symbol) => (
        <Button
          key={symbolKey(symbol)}
          size="sm"
          variant="tertiary"
          onPress={() => run(symbol)}>
          {symbol.symbol}
        </Button>
      ))}
      <TextField
        aria-label={t("strategies.page.backtest-code")}
        value={typed}
        onChange={setTyped}
        className="w-28">
        <Input placeholder={t("strategies.page.backtest-code")} />
      </TextField>
      <Button size="sm" variant="secondary" type="submit" isDisabled={!typed}>
        {t("strategies.page.backtest")}
      </Button>
    </form>
  );
}

/** Hands the agent's composer a request to change `name`, in a new conversation the user sends. */
export function ChangeWithAgent({ name }: { name: string }) {
  const { t } = useTranslation();
  const draft = useAgentDraft();

  return (
    <Button
      size="sm"
      variant="secondary"
      onPress={() => draft(t("strategies.page.change-prompt", { name }))}>
      {t("strategies.page.change")}
    </Button>
  );
}

/** Hands the agent's composer the start of a request to write a strategy. */
export function WriteWithAgent() {
  const { t } = useTranslation();
  const draft = useAgentDraft();

  return (
    <Button
      size="sm"
      variant="secondary"
      onPress={() => draft(t("strategies.page.write-prompt"))}>
      {t("strategies.page.write")}
    </Button>
  );
}

/**
 * Hands the agent's composer a request to trade on `name`'s signals through a scheduled task,
 * which proposes each order for the user to confirm.
 */
export function UseLive({ name }: { name: string }) {
  const { t } = useTranslation();
  const draft = useAgentDraft();

  return (
    <Button
      size="sm"
      variant="secondary"
      onPress={() => draft(t("strategies.page.live-prompt", { name }))}>
      {t("strategies.page.live")}
    </Button>
  );
}

/** Shows `name`'s folder, or the strategies folder for `null`, in the file manager; this computer's windows only. */
export function RevealStrategy({ name }: { name: string | null }) {
  const { t } = useTranslation();
  const reveal = useMutation(orpc.strategies.reveal.mutationOptions());

  if (!inWindow) return null;

  return (
    <Button
      size="sm"
      variant="tertiary"
      isPending={reveal.isPending}
      onPress={() => reveal.mutate(name)}>
      {t("strategies.page.reveal")}
    </Button>
  );
}

/** A button that does what it names only when pressed a second time, since it cannot be undone. */
function ArmedButton({
  label,
  confirm,
  isPending,
  onConfirm,
}: {
  label: string;
  confirm: string;
  isPending: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);

  return (
    <Button
      size="sm"
      variant={armed ? "danger-soft" : "tertiary"}
      isPending={isPending}
      onPress={() => {
        if (armed) onConfirm();
        else setArmed(true);
      }}
      onBlur={() => setArmed(false)}>
      {armed ? confirm : label}
    </Button>
  );
}

/** Takes back every version of `name` allowed so far; this computer's windows only. */
export function RevokeStrategy({ strategy }: { strategy: StrategyEntry }) {
  const { t } = useTranslation();
  const revoke = useMutation(orpc.strategies.revoke.mutationOptions());

  if (!inWindow || strategy.approvals.length === 0) return null;

  return (
    <>
      <ArmedButton
        label={t("strategies.page.revoke")}
        confirm={t("strategies.page.revoke-confirm")}
        isPending={revoke.isPending}
        onConfirm={() => revoke.mutate(strategy.name)}
      />
      {revoke.error ? (
        <ErrorAlert
          title={t("strategies.page.revoke-failed")}
          description={revoke.error.message}
        />
      ) : null}
    </>
  );
}

/**
 * Moves `name`'s folder to the computer's trash and takes back every version allowed, then leaves
 * for the strategies page; this computer's windows only, and never the agent's.
 */
export function TrashStrategy({ name }: { name: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const trash = useMutation({
    ...orpc.strategies.trash.mutationOptions(),
    onSuccess: () => void navigate({ to: "/strategies" }),
  });

  if (!inWindow) return null;

  return (
    <>
      <ArmedButton
        label={t("strategies.page.trash")}
        confirm={t("strategies.page.trash-confirm")}
        isPending={trash.isPending}
        onConfirm={() => trash.mutate(name)}
      />
      {trash.error ? (
        <ErrorAlert
          title={t("strategies.page.trash-failed")}
          description={trash.error.message}
        />
      ) : null}
    </>
  );
}
