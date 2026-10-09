import { Fragment } from "react";

import {
  Button,
  Label,
  Popover,
  ProgressBar,
  ProgressCircle,
  Tooltip,
  cn,
} from "@heroui/react";
import { DashboardSpeed02Icon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";

import type { ReplyUsage } from "@solyx/agent/wire";

import { Icon } from "../../components/icon.tsx";
import { numberFormats } from "../market/number-formats.ts";

const TOOLTIP_DELAY = 600;

/**
 * How much of its model's context window the conversation's next request fills, opening onto the
 * way to summarize its older messages and make room.
 */
export function ContextMeter({
  used,
  window,
  compacting,
  canCompact,
  onCompact,
}: {
  used: number;
  window: number;
  /** A summary the user asked for is being written. */
  compacting: boolean;
  canCompact: boolean;
  onCompact: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { compactAmount, percent } = numberFormats(i18n.language);
  const label = t("agent.context-meter.label");
  const title = t("agent.context-meter.title");

  return (
    <Popover>
      <Button isIconOnly size="sm" variant="ghost" aria-label={label}>
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
      </Button>
      <Popover.Content
        placement="top end"
        className="w-80 max-w-[calc(100vw-1.5rem)]">
        <Popover.Dialog
          aria-label={title}
          className="flex flex-col gap-2 p-3 text-xs">
          <ProgressBar
            size="sm"
            color="default"
            value={used}
            maxValue={window}
            valueLabel={t("agent.context-meter.used", {
              used: compactAmount.format(used),
              window: compactAmount.format(window),
              percent: percent.format(Math.min(used / window, 1)),
            })}>
            <Label className="text-xs">{title}</Label>
            <ProgressBar.Output className="text-xs tabular-nums" />
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
          <p className="text-muted">{t("agent.context-meter.summarized")}</p>
          <p className="text-muted">{t("agent.context-meter.hint")}</p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-1 text-xs"
            isPending={compacting}
            isDisabled={!canCompact}
            onPress={onCompact}>
            {t("agent.context-meter.compact")}
          </Button>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
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
