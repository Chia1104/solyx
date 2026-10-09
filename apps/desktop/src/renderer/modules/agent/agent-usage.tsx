import { Fragment } from "react";

import { ProgressCircle, Tooltip, cn } from "@heroui/react";
import { DashboardSpeed02Icon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";

import type { ReplyUsage } from "@solyx/agent/wire";

import { Icon } from "../../components/icon.tsx";
import { numberFormats } from "../market/number-formats.ts";

const TOOLTIP_DELAY = 600;

/** How much of its model's context window the conversation fills, as its latest reply left it. */
export function ContextMeter({
  used,
  window,
}: {
  used: number;
  window: number;
}) {
  const { t, i18n } = useTranslation();
  const { compactAmount, percent } = numberFormats(i18n.language);
  const label = t("agent.context-meter.label");

  return (
    <Tooltip delay={TOOLTIP_DELAY}>
      <Tooltip.Trigger
        aria-label={label}
        className="flex size-8 items-center justify-center">
        <ProgressCircle
          aria-label={label}
          size="sm"
          color="default"
          value={used}
          maxValue={window}
          className="size-4">
          <ProgressCircle.Track>
            <ProgressCircle.TrackCircle />
            <ProgressCircle.FillCircle />
          </ProgressCircle.Track>
        </ProgressCircle>
      </Tooltip.Trigger>
      <Tooltip.Content className="flex flex-col gap-0.5">
        <p className="tabular-nums">
          {t("agent.context-meter.used", {
            used: compactAmount.format(used),
            window: compactAmount.format(window),
            percent: percent.format(Math.min(used / window, 1)),
          })}
        </p>
        <p className="text-muted">{t("agent.context-meter.summarized")}</p>
      </Tooltip.Content>
    </Tooltip>
  );
}

/** A reply's tokens, with how much of its prompt the provider's cache served or kept. */
export function ReplyUsageMark({ usage }: { usage: ReplyUsage }) {
  const { t, i18n } = useTranslation();
  const { compactAmount, percent } = numberFormats(i18n.language);
  const prompt = usage.input + usage.cacheRead + usage.cacheWrite;

  const share = (tokens: number) =>
    t("agent.usage.share", {
      tokens: compactAmount.format(tokens),
      percent: percent.format(prompt === 0 ? 0 : tokens / prompt),
    });

  const rows = [
    { label: t("agent.usage.prompt"), value: compactAmount.format(prompt) },
    {
      label: t("agent.usage.cache-read"),
      value: share(usage.cacheRead),
      part: true,
    },
    {
      label: t("agent.usage.cache-write"),
      value: share(usage.cacheWrite),
      part: true,
    },
    { label: t("agent.usage.uncached"), value: share(usage.input), part: true },
    {
      label: t("agent.usage.output"),
      value: compactAmount.format(usage.output),
    },
  ];

  return (
    <Tooltip delay={TOOLTIP_DELAY}>
      <Tooltip.Trigger
        aria-label={t("agent.usage.label")}
        className="flex size-6 items-center justify-center text-muted">
        <Icon icon={DashboardSpeed02Icon} className="size-3.5" />
      </Tooltip.Trigger>
      <Tooltip.Content>
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 tabular-nums">
          {rows.map((row) => (
            <Fragment key={row.label}>
              <dt className={cn("text-muted", row.part && "pl-3")}>
                {row.label}
              </dt>
              <dd className="text-right">{row.value}</dd>
            </Fragment>
          ))}
        </dl>
      </Tooltip.Content>
    </Tooltip>
  );
}
