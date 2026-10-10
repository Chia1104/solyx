import { cn } from "@heroui/react";
import { range } from "es-toolkit";
import { ToggleButton, ToggleButtonGroup } from "react-aria-components";
import { useTranslation } from "react-i18next";

/** What falls on a day, by how surely: in ink where someone set the day, in pencil where it is only the latest or an expected one. */
export interface DayMarks {
  inked: number;
  pencilled: number;
}

/** A place in the grid, holding a day or squaring a month's first and last weeks. */
export interface DaySlot {
  /** `YYYY-MM-DD`. */
  day: string;
  /** False for a day of another month, which only holds its place. */
  shown: boolean;
}

// Marks past these are counted instead, so a deadline every listing shares keeps to its cell.
const MARK_LIMIT = 5;

const INK_MARK = "size-1.5 shrink-0 bg-foreground";

const PENCIL_MARK = "size-1.5 shrink-0 border border-muted";

/** Midnight UTC of a `YYYY-MM-DD` day, which a formatter set to UTC reads back as that day. */
export const utcDay = (day: string) => new Date(`${day}T00:00:00Z`);

function Marks({ inked, pencilled }: DayMarks) {
  const ink = Math.min(inked, MARK_LIMIT);
  const pencil = Math.min(pencilled, MARK_LIMIT - ink);
  const rest = inked + pencilled - ink - pencil;

  return (
    <span aria-hidden className="flex h-2.5 items-center gap-[3px]">
      {range(ink).map((index) => (
        <span key={`ink-${index}`} className={INK_MARK} />
      ))}
      {range(pencil).map((index) => (
        <span key={`pencil-${index}`} className={PENCIL_MARK} />
      ))}
      {rest > 0 ? (
        <span className="text-[0.625rem] leading-none text-muted tabular-nums">
          +{rest}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Days as a ruled grid, seven to a row under their weekdays, each marked with what falls on it.
 * One day at most is picked, and picking it again lets it go.
 */
export function AgendaDays({
  slots,
  from,
  to,
  today,
  marks,
  picked,
  onPick,
  labelledBy,
}: {
  slots: DaySlot[];
  /** The first and last days that can be picked, `YYYY-MM-DD`. */
  from: string;
  to: string;
  today: string;
  marks: ReadonlyMap<string, DayMarks>;
  picked: string | null;
  onPick: (day: string | null) => void;
  /** The id of the element that names the days in view. */
  labelledBy: string;
}) {
  const { t, i18n } = useTranslation();

  const weekday = new Intl.DateTimeFormat(i18n.language, {
    weekday: "short",
    timeZone: "UTC",
  });

  const fullDate = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "full",
    timeZone: "UTC",
  });

  const label = (day: string, count: number) =>
    [
      day === today ? t("calendar.today") : null,
      fullDate.format(utcDay(day)),
      count > 0 ? t("calendar.marked", { count }) : null,
    ]
      .filter((part) => part !== null)
      .join(", ");

  return (
    <div className="flex flex-col gap-2">
      <div>
        <div aria-hidden className="grid grid-cols-7 text-xs text-muted">
          {slots.slice(0, 7).map(({ day }) => (
            <span key={day} className="truncate px-2 pb-1">
              {weekday.format(utcDay(day))}
            </span>
          ))}
        </div>
        <ToggleButtonGroup
          aria-labelledby={labelledBy}
          selectionMode="single"
          selectedKeys={picked === null ? [] : [picked]}
          onSelectionChange={(keys) => {
            const [key] = keys;

            onPick(slots.find(({ day }) => day === key)?.day ?? null);
          }}
          className="grid grid-cols-7 border-t border-l border-separator">
          {slots.map(({ day, shown }) => {
            const dayMarks = marks.get(day);

            return shown ? (
              <ToggleButton
                key={day}
                id={day}
                isDisabled={day < from || day > to}
                aria-label={label(
                  day,
                  (dayMarks?.inked ?? 0) + (dayMarks?.pencilled ?? 0)
                )}
                className="flex h-14 min-w-0 cursor-pointer flex-col items-start gap-1.5 border-r border-b border-separator px-2 py-1.5 -outline-offset-2 outline-(--focus) data-[disabled]:cursor-default data-[disabled]:text-muted/50 data-[focus-visible]:outline-2 data-[hovered]:bg-default/60 data-[selected]:bg-default data-[selected]:shadow-[inset_0_2px_0_var(--accent)]">
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    day === today && "font-semibold text-accent"
                  )}>
                  {Number(day.slice(-2))}
                </span>
                {dayMarks ? <Marks {...dayMarks} /> : null}
              </ToggleButton>
            ) : (
              <span key={day} className="border-r border-b border-separator" />
            );
          })}
        </ToggleButtonGroup>
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className={INK_MARK} />
          {t("calendar.legend.set")}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className={PENCIL_MARK} />
          {t("calendar.legend.open")}
        </span>
      </p>
    </div>
  );
}
