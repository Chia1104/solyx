import { useMemo, useState } from "react";

import { Button, Form, Switch } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { uniq } from "es-toolkit";
import { FormProvider, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { ScheduleKind, collectionScheduleSchema } from "@solyx/core/schedule";
import type { CollectionJob, CollectionPlan } from "@solyx/core/schedule";

import type { CollectionView } from "#shared/ipc/schedules.ts";

import { currentTimeZone, useClock } from "../../app/clock.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { SettingsList, SettingsRow } from "../settings/settings-list.tsx";

import { collectionsQuery } from "./schedules-query.ts";
import {
  NEW_TIMING,
  TimingFields,
  scheduleOf,
  scheduleText,
  timingFieldSchemas,
  timingOf,
} from "./timing-fields.tsx";
import type { TimingForm } from "./timing-fields.tsx";

// A collection runs every so often or at a time of day, never on a change, which is what it finds.
const KINDS = [ScheduleKind.Interval, ScheduleKind.FixedTime];

// The spans a collection may recur at, in minutes: six hours to a week.
const INTERVALS = [360, 720, 1440, 4320, 10080];

/**
 * When one collection runs, edited as a task's time is. A plan saved again follows the clock the
 * app shows now, so its time of day reads as the user sees it.
 */
function CollectionEditor({
  view,
  onDone,
}: {
  view: CollectionView;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { job, plan } = view;
  const schema = useMemo(() => z.object(timingFieldSchemas(t)), [t]);

  const form = useForm({
    resolver: zodResolver(schema),
    reValidateMode: "onSubmit",
    defaultValues: { ...NEW_TIMING, ...timingOf(plan.schedule) },
  });

  const save = useMutation({
    mutationFn: (values: TimingForm) =>
      window.solyx.schedules.setCollection(job, {
        enabled: plan.enabled,
        schedule: collectionScheduleSchema.parse(scheduleOf(values)),
        timeZone: currentTimeZone(),
      }),
    onSuccess: onDone,
  });

  const submit = form.handleSubmit((values) => save.mutate(values));

  // A span written by hand in the config file joins the ones offered.
  const intervals = uniq([
    ...INTERVALS,
    ...(plan.schedule.kind === ScheduleKind.Interval
      ? [plan.schedule.everyMinutes]
      : []),
  ]).toSorted((a, b) => a - b);

  return (
    <FormProvider {...form}>
      <Form
        validationBehavior="aria"
        className="flex flex-col gap-3"
        onSubmit={(event) => void submit(event)}>
        <TimingFields kinds={KINDS} intervals={intervals} />
        <div className="flex gap-2">
          <Button type="submit" variant="secondary" isPending={save.isPending}>
            {t("settings.save")}
          </Button>
          <Button
            variant="tertiary"
            isDisabled={save.isPending}
            onPress={onDone}>
            {t("common.cancel")}
          </Button>
        </div>
        {save.error ? (
          <ErrorAlert
            title={t("settings.schedules.collections.change-failed")}
            description={save.error.message}
          />
        ) : null}
      </Form>
    </FormProvider>
  );
}

/** One of the app's collections: when it runs, when it last did and next will, edited below the row. */
function CollectionRow({ view }: { view: CollectionView }) {
  const { t } = useTranslation();
  const clock = useClock();
  const [editing, setEditing] = useState(false);
  const { job, plan, lastAt, nextAt } = view;
  const name = t(`settings.schedules.collections.${job}.title`);

  const enable = useMutation({
    mutationFn: (enabled: boolean) =>
      window.solyx.schedules.setCollection(job, {
        ...plan,
        enabled,
      } satisfies CollectionPlan),
  });

  const collect = useMutation({
    mutationFn: () => window.solyx.schedules.collectNow(job),
  });

  const error = enable.error ?? collect.error;

  return (
    <SettingsRow
      label={name}
      description={
        <span className="flex flex-wrap gap-x-2 tabular-nums">
          <span>{scheduleText(t, plan.schedule, plan.timeZone)}</span>
          {nextAt === null ? null : (
            <span>
              · {t("settings.schedules.next-run", { time: clock.time(nextAt) })}
            </span>
          )}
          <span>
            {lastAt === null
              ? t("settings.schedules.collections.never")
              : t("settings.schedules.collections.last", {
                  time: clock.time(lastAt),
                })}
          </span>
        </span>
      }
      actions={
        editing ? null : (
          <>
            <Button
              size="sm"
              variant="tertiary"
              isPending={collect.isPending}
              onPress={() => collect.mutate()}>
              {t("settings.schedules.collections.collect-now")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onPress={() => {
                enable.reset();
                collect.reset();
                setEditing(true);
              }}>
              {t("settings.edit")}
            </Button>
            <Switch
              isSelected={plan.enabled}
              isDisabled={enable.isPending}
              onChange={(enabled) => enable.mutate(enabled)}>
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <span className="sr-only">
                  {t("settings.schedules.collections.enabled", { name })}
                </span>
              </Switch.Content>
            </Switch>
          </>
        )
      }>
      {editing ? (
        <CollectionEditor view={view} onDone={() => setEditing(false)} />
      ) : (
        <p className="text-xs text-muted">
          {t(`settings.schedules.collections.${job}.description`)}
        </p>
      )}
      {error ? (
        <ErrorAlert
          title={t("settings.schedules.collections.collect-failed")}
          description={error.message}
        />
      ) : null}
    </SettingsRow>
  );
}

/** What the app collects on its own, each switched on or off, timed and collected now; `jobs` keeps to some of them. */
export function CollectionList({ jobs }: { jobs?: readonly CollectionJob[] }) {
  const { data, error, refetch } = useQuery(collectionsQuery());

  if (error) return <LoadError error={error} onRetry={() => void refetch()} />;

  if (!data) return <LoadingState />;

  return (
    <SettingsList>
      {data
        .filter(({ job }) => jobs === undefined || jobs.includes(job))
        .map((view) => (
          <CollectionRow key={view.job} view={view} />
        ))}
    </SettingsList>
  );
}
