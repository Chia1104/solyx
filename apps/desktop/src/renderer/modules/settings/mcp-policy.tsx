import { ToggleButton, ToggleButtonGroup, cn } from "@heroui/react";
import { countBy, sortBy } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { McpToolPolicy } from "@solyx/agent/mcp-config";
import { isEnumValue } from "@solyx/utils/is";

import type { McpToolSetting } from "#shared/ipc/settings.ts";

/*
 * A tool's policy is drawn as a bar: a stub while it is off, full height once the agent is offered
 * it, in pencil grey while each call waits for the user and in ink once it runs on its own.
 */
const POLICIES = Object.values(McpToolPolicy);

const MARK: Record<McpToolPolicy, string> = {
  [McpToolPolicy.Off]: "h-1/3 bg-muted/60",
  [McpToolPolicy.Ask]: "h-full bg-muted",
  [McpToolPolicy.Auto]: "h-full bg-accent",
};

const FILL: Record<McpToolPolicy, string> = {
  [McpToolPolicy.Off]: "fill-muted/60",
  [McpToolPolicy.Ask]: "fill-muted",
  [McpToolPolicy.Auto]: "fill-accent",
};

const BAR_HEIGHT = 12;

/** Each tool's slot in a tally, of which the last pixel is the gap. */
const SLOT = 4;

/** Past this width a tally squeezes its bars instead of growing. */
const TALLY_WIDTH = 128;

export function PolicyMark({ policy }: { policy: McpToolPolicy }) {
  return (
    <span aria-hidden className="flex h-3 w-[3px] shrink-0 items-end">
      <span className={cn("w-full rounded-[1px]", MARK[policy])} />
    </span>
  );
}

/** A server's tools as one bar each, ordered from off to running on their own. */
export function PolicyTally({ tools }: { tools: McpToolSetting[] }) {
  const { t } = useTranslation();
  const counts = countBy(tools, (tool) => tool.policy);
  const sorted = sortBy(tools, [(tool) => POLICIES.indexOf(tool.policy)]);
  const width = sorted.length * SLOT;

  return (
    <svg
      role="img"
      aria-label={t("settings.mcp.tally", {
        off: counts[McpToolPolicy.Off] ?? 0,
        ask: counts[McpToolPolicy.Ask] ?? 0,
        auto: counts[McpToolPolicy.Auto] ?? 0,
      })}
      viewBox={`0 0 ${width} ${BAR_HEIGHT}`}
      width={Math.min(width, TALLY_WIDTH)}
      height={BAR_HEIGHT}
      preserveAspectRatio="none"
      className="shrink-0">
      {sorted.map((tool, index) => {
        const height =
          tool.policy === McpToolPolicy.Off ? BAR_HEIGHT / 3 : BAR_HEIGHT;

        return (
          <rect
            key={tool.name}
            x={index * SLOT}
            y={BAR_HEIGHT - height}
            width={SLOT - 1}
            height={height}
            className={FILL[tool.policy]}
          />
        );
      })}
    </svg>
  );
}

export function PolicyLegend() {
  const { t } = useTranslation();

  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {POLICIES.map((policy) => (
        <li key={policy} className="flex items-center gap-1.5">
          <PolicyMark policy={policy} />
          {t(`settings.mcp.legend.${policy}`)}
        </li>
      ))}
    </ul>
  );
}

/** What the agent may do with one tool; only a tool its server marks read-only may run on its own. */
export function PolicyToggle({
  tool,
  value,
  onChange,
}: {
  tool: McpToolSetting;
  value: McpToolPolicy;
  onChange: (policy: McpToolPolicy) => void;
}) {
  const { t } = useTranslation();

  return (
    <ToggleButtonGroup
      aria-label={t("settings.mcp.policy-label", { tool: tool.name })}
      selectionMode="single"
      disallowEmptySelection
      size="sm"
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const next = [...keys].find((key) => isEnumValue(McpToolPolicy, key));

        if (next && next !== value) onChange(next);
      }}>
      {POLICIES.map((policy) => (
        <ToggleButton
          key={policy}
          id={policy}
          variant="ghost"
          isDisabled={policy === McpToolPolicy.Auto && !tool.readOnly}>
          <PolicyMark policy={policy} />
          {t(`settings.mcp.policies.${policy}`)}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
