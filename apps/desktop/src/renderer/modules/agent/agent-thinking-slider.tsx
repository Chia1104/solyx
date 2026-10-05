import { Slider, cn } from "@heroui/react";
import { clamp } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { AgentThinking } from "@solyx/agent/providers";

const LEVELS = Object.values(AgentThinking);

const LAST = LEVELS.length - 1;

const levelAt = (index: number | number[]): AgentThinking =>
  LEVELS[clamp(Array.isArray(index) ? (index[0] ?? 0) : index, 0, LAST)] ??
  AgentThinking.Off;

/**
 * How long the model thinks, as a stop on a short track. `onChange` follows the thumb and
 * `onCommit` fires once it settles, so a drag saves once.
 */
export function ThinkingSlider({
  value,
  isDisabled,
  onChange,
  onCommit,
}: {
  value: AgentThinking;
  isDisabled?: boolean;
  onChange: (level: AgentThinking) => void;
  onCommit: (level: AgentThinking) => void;
}) {
  const { t } = useTranslation();
  const index = Math.max(0, LEVELS.indexOf(value));
  const label = t("settings.agent.thinking");

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-medium">
          {t(`settings.agent.thinkings.${value}`)}
        </span>
      </div>
      <Slider
        aria-label={label}
        className="w-full"
        isDisabled={isDisabled}
        minValue={0}
        maxValue={LAST}
        step={1}
        value={index}
        onChange={(next) => onChange(levelAt(next))}
        onChangeEnd={(next) => onCommit(levelAt(next))}>
        <Slider.Track className="relative h-4 border-x-8">
          <Slider.Fill className="bg-accent" />
          {LEVELS.map((level, stop) => (
            <span
              key={level}
              aria-hidden
              className={cn(
                "pointer-events-none absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full",
                stop <= index ? "bg-accent-foreground/70" : "bg-muted/60"
              )}
              style={{ left: `${(stop / LAST) * 100}%` }}
            />
          ))}
          <Slider.Thumb className="w-5 border-accent after:h-2.5 after:w-4" />
        </Slider.Track>
      </Slider>
    </div>
  );
}
