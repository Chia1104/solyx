import { useId, useState } from "react";
import type { ReactNode } from "react";

import { Button, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import type { Selection } from "@heroui/react";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { getDayOfWeek, parseDate } from "@internationalized/date";
import { range } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { shiftDate } from "@solyx/core/market";
import { isEnumValue } from "@solyx/utils/is";

import { AgendaView, useLayoutStore } from "../../app/layout-store.ts";
import { Icon } from "../../components/icon.tsx";

import { AgendaDays, utcDay } from "./agenda-days.tsx";
import type { DayMarks, DaySlot } from "./agenda-days.tsx";

/** The days the agenda shows at once, first to last, and where each sits in its grid. */
interface Page {
  start: string;
  end: string;
  slots: DaySlot[];
}

const plain = (day: string) => Temporal.PlainDate.from(day);

/** The seven days `day` falls in, counted off from `from` rather than from the start of a week. */
function weekOf(day: string, from: string): Page {
  const weeks = Math.floor(plain(from).until(plain(day)).days / 7);
  const start = shiftDate(from, weeks * 7);

  return {
    start,
    end: shiftDate(start, 6),
    slots: range(7).map((index) => ({
      day: shiftDate(start, index),
      shown: true,
    })),
  };
}

/** The month `day` falls in, its weeks squared with the days around it as the locale starts a week. */
function monthOf(day: string, locale: string): Page {
  const first = plain(day).with({ day: 1 });
  const lead = getDayOfWeek(parseDate(first.toString()), locale);
  const corner = first.subtract({ days: lead });
  const weeks = Math.ceil((lead + first.daysInMonth) / 7);

  return {
    start: first.toString(),
    end: first.with({ day: first.daysInMonth }).toString(),
    slots: range(weeks * 7).map((index) => {
      const each = corner.add({ days: index });

      return { day: each.toString(), shown: each.month === first.month };
    }),
  };
}

/**
 * A week or a month of days, each marked with what falls on it, over what `children` shows of the
 * days in view or of the one picked. The week runs from `from`, so it opens on what comes next
 * rather than on days gone by.
 */
export function Agenda({
  from,
  to,
  today,
  marks,
  children,
}: {
  /** The first and last days it reaches, `YYYY-MM-DD`. */
  from: string;
  to: string;
  today: string;
  marks: ReadonlyMap<string, DayMarks>;
  /** Shows what falls from `from` through `to`, which are one day once a day is picked; `show` turns to the days a day falls in and lets the picked one go. */
  children: (shown: {
    from: string;
    to: string;
    show: (day: string) => void;
  }) => ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const view = useLayoutStore((state) => state.agendaView);
  const setView = useLayoutStore((state) => state.setAgendaView);
  const [cursor, setCursor] = useState(from);
  const [picked, setPicked] = useState<string | null>(null);

  // The days it reaches move on with the clock, so a cursor left behind gives way to the first.
  const within = cursor < from ? from : cursor > to ? to : cursor;

  const page =
    view === AgendaView.Week
      ? weekOf(within, from)
      : monthOf(within, i18n.language);

  const day =
    picked !== null && picked >= page.start && picked <= page.end
      ? picked
      : null;

  const heading =
    view === AgendaView.Week
      ? new Intl.DateTimeFormat(i18n.language, {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }).formatRange(utcDay(page.start), utcDay(page.end))
      : new Intl.DateTimeFormat(i18n.language, {
          year: "numeric",
          month: "long",
          timeZone: "UTC",
        }).format(utcDay(page.start));

  const selectView = (keys: Selection) => {
    if (keys === "all") return;

    const [next] = keys;

    if (next !== view && isEnumValue(AgendaView, next)) setView(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3
          id={headingId}
          aria-live="polite"
          className="text-sm font-medium tabular-nums">
          {heading}
        </h3>
        <ToggleButtonGroup
          aria-label={t("calendar.view")}
          selectionMode="single"
          disallowEmptySelection
          size="sm"
          className="ml-auto shrink-0"
          selectedKeys={[view]}
          onSelectionChange={selectView}>
          {Object.values(AgendaView).map((each) => (
            <ToggleButton key={each} id={each}>
              {t(`calendar.views.${each}`)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label={t("calendar.earlier")}
            isDisabled={page.start <= from}
            onPress={() => setCursor(shiftDate(page.start, -1))}>
            <Icon icon={ArrowLeft01Icon} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onPress={() => {
              setCursor(today);
              setPicked(null);
            }}>
            {t("calendar.today")}
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label={t("calendar.later")}
            isDisabled={page.end >= to}
            onPress={() => setCursor(shiftDate(page.end, 1))}>
            <Icon icon={ArrowRight01Icon} />
          </Button>
        </div>
      </div>
      <AgendaDays
        slots={page.slots}
        from={from}
        to={to}
        today={today}
        marks={marks}
        picked={day}
        onPick={(next) => {
          setPicked(next);

          if (next !== null) setCursor(next);
        }}
        labelledBy={headingId}
      />
      {children({
        ...(day === null
          ? {
              from: page.start < from ? from : page.start,
              to: page.end > to ? to : page.end,
            }
          : { from: day, to: day }),
        show: (next) => {
          setCursor(next);
          setPicked(null);
        },
      })}
    </div>
  );
}
