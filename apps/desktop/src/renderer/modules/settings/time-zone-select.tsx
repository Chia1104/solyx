import { useMemo } from "react";

import {
  ComboBox,
  Description,
  Input,
  Label,
  ListBox,
  ListLayout,
  Virtualizer,
} from "@heroui/react";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import {
  TimeZonePreference,
  timeZonePreferenceSchema,
} from "#shared/ipc/settings.ts";

import { systemTimeZone } from "../../app/clock.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";

import { appearanceQuery } from "./settings-query.ts";

interface TimeZoneOption {
  id: TimeZonePreference;
  label: string;
}

/** `Asia/Taipei (GMT+08:00)`, with the offset the zone keeps today. */
function zoneLabel(timeZone: string, now: Date): string {
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  })
    .formatToParts(now)
    .find((part) => part.type === "timeZoneName")?.value;

  return offset ? `${timeZone} (${offset})` : timeZone;
}

export function TimeZoneSelect() {
  const { t } = useTranslation();
  const { timeZone: preference } = useSuspenseQuery(appearanceQuery()).data;

  // The main process pushes the saved appearance, which the query takes.
  const save = useMutation({
    mutationFn: (timeZone: TimeZonePreference) =>
      window.solyx.settings.setTimeZone(timeZone),
  });

  const options = useMemo<TimeZoneOption[]>(() => {
    const now = new Date();
    const zones = Intl.supportedValuesOf("timeZone");

    // A saved zone the list spells differently, such as an alias, still shows as picked.
    if (preference !== TimeZonePreference.System && !zones.includes(preference))
      zones.unshift(preference);

    return [
      {
        id: TimeZonePreference.System,
        label: t("time-zone.system", { zone: systemTimeZone() }),
      },
      ...zones.map((zone) => ({ id: zone, label: zoneLabel(zone, now) })),
    ];
  }, [preference, t]);

  return (
    <ComboBox
      className="max-w-xs"
      // `defaultItems` keeps react-aria's own filtering as the user types; `items` would hand it over.
      defaultItems={options}
      value={preference}
      onChange={(key) => {
        const next = timeZonePreferenceSchema.safeParse(key);

        if (next.success && next.data !== preference) save.mutate(next.data);
      }}>
      <Label>{t("settings.time-zone")}</Label>
      <ComboBox.InputGroup>
        <Input placeholder={t("time-zone.search")} />
        <ComboBox.Trigger />
      </ComboBox.InputGroup>
      <Description>{t("settings.time-zone-description")}</Description>
      {save.error ? (
        <ErrorAlert
          title={t("settings.save-failed")}
          description={save.error.message}
        />
      ) : null}
      {/* The popover takes the input's width: the virtualizer sizes its rows to the list box, so a list box sized to its rows would grow without end. */}
      <ComboBox.Popover className="w-(--trigger-width)">
        {/* Some four hundred zones: only the rows in view are rendered, and the list box scrolls rather than the popover. */}
        <Virtualizer
          layout={ListLayout}
          layoutOptions={{ estimatedRowSize: 36, padding: 4 }}>
          <ListBox className="max-h-72 overflow-y-auto">
            {(option: TimeZoneOption) => (
              <ListBox.Item id={option.id} textValue={option.label}>
                {option.label}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            )}
          </ListBox>
        </Virtualizer>
      </ComboBox.Popover>
    </ComboBox>
  );
}
