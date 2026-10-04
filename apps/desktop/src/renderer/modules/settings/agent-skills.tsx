import { useState } from "react";

import {
  Alert,
  Button,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
} from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { partition } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { isEnumValue } from "@solyx/utils/is";

import { AppLocation } from "#shared/ipc/settings.ts";
import type { AgentSkillInfo } from "#shared/ipc/settings.ts";

import { FilterField, matchesFilter } from "../../components/filter-field.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { Section } from "../../components/section.tsx";
import { RailedColumn } from "../../components/sheet.tsx";

import { SettingsList, SettingsRow } from "./settings-list.tsx";
import { agentSkillsQuery } from "./settings-query.ts";

/** Which skills the list shows: those always offered, or the shared ones switched on one by one. */
const SkillScope = {
  Always: "always",
  Shared: "shared",
} as const;

type SkillScope = (typeof SkillScope)[keyof typeof SkillScope];

function SkillRow({
  skill,
  onOffer,
  isDisabled,
}: {
  skill: AgentSkillInfo;
  onOffer: (offered: boolean) => void;
  isDisabled: boolean;
}) {
  const { t } = useTranslation();

  return (
    <SettingsRow
      label={<span className="font-mono text-xs">{skill.name}</span>}
      description={
        <span className="line-clamp-1" title={skill.description}>
          {skill.description}
        </span>
      }
      value={
        skill.switchable
          ? undefined
          : t(`settings.skills.sources.${skill.source}`)
      }
      actions={
        skill.switchable ? (
          <Switch
            isSelected={skill.offered}
            isDisabled={isDisabled}
            onChange={onOffer}>
            {/* The field only frames the switch; Content is the label around the real input. */}
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <span className="sr-only">
                {t("settings.skills.offer", { name: skill.name })}
              </span>
            </Switch.Content>
          </Switch>
        ) : undefined
      }
    />
  );
}

/**
 * The playbooks the agent can read and the standing instructions it keeps: the user's own and the
 * built-ins are always offered, while skills shared with other agents wait to be switched on.
 */
export function AgentSkills() {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(agentSkillsQuery());
  const [scope, setScope] = useState<SkillScope>(SkillScope.Always);
  const [filter, setFilter] = useState("");

  const offer = useMutation({
    mutationFn: ({ name, offered }: { name: string; offered: boolean }) =>
      window.solyx.settings.setSharedSkill(name, offered),
  });

  const reveal = useMutation({
    mutationFn: () => window.solyx.settings.reveal(AppLocation.Skills),
  });

  if (error) {
    return (
      <RailedColumn className="px-6 py-5">
        <LoadError error={error} onRetry={() => void refetch()} />
      </RailedColumn>
    );
  }

  if (!data) return <LoadingState />;

  const [shared, always] = partition(data.skills, (skill) => skill.switchable);

  // A filter searches every skill, so a match never hides behind the other scope.
  const filtering = filter.trim() !== "";

  const shown = filtering
    ? data.skills.filter((skill) =>
        matchesFilter(filter, skill.name, skill.description)
      )
    : scope === SkillScope.Shared && shared.length > 0
      ? shared
      : always;

  const row = (skill: AgentSkillInfo) => (
    <SkillRow
      key={skill.name}
      skill={skill}
      isDisabled={offer.isPending}
      onOffer={(offered) => offer.mutate({ name: skill.name, offered })}
    />
  );

  return (
    <Section
      title={t("settings.skills.title")}
      description={t("settings.skills.description", {
        skills: data.paths.skills,
        shared: data.paths.shared,
      })}>
      <div className="flex flex-col gap-3">
        {data.warnings.length > 0 ? (
          <Alert status="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{t("settings.skills.warnings-title")}</Alert.Title>
              <ul className="list-disc pl-4 text-xs text-muted">
                {data.warnings.map((warning) => (
                  <li key={warning} className="break-all">
                    {warning}
                  </li>
                ))}
              </ul>
            </Alert.Content>
          </Alert>
        ) : null}
        <SettingsList>
          <SettingsRow
            label={t("settings.skills.instructions")}
            description={t("settings.skills.instructions-description", {
              path: data.paths.instructions,
            })}
            value={
              data.instructions
                ? t("settings.skills.instructions-found", {
                    count: data.instructions.characters,
                  })
                : t("settings.skills.instructions-missing")
            }
          />
        </SettingsList>
        <div className="flex flex-wrap items-center gap-3">
          {shared.length > 0 && !filtering ? (
            <ToggleButtonGroup
              aria-label={t("settings.skills.scope-label")}
              selectionMode="single"
              disallowEmptySelection
              size="sm"
              selectedKeys={[scope]}
              onSelectionChange={(keys) => {
                const next = [...keys].find((key) =>
                  isEnumValue(SkillScope, key)
                );

                if (next) setScope(next);
              }}>
              <ToggleButton id={SkillScope.Always}>
                {t("settings.skills.scopes.always")}
                <span className="text-xs tabular-nums opacity-70">
                  {always.length}
                </span>
              </ToggleButton>
              <ToggleButton id={SkillScope.Shared}>
                {t("settings.skills.scopes.shared")}
                <span className="text-xs tabular-nums opacity-70">
                  {shared.filter((skill) => skill.offered).length}/
                  {shared.length}
                </span>
              </ToggleButton>
            </ToggleButtonGroup>
          ) : null}
          <FilterField
            label={t("settings.skills.filter")}
            value={filter}
            onChange={setFilter}
            className="ml-auto w-56"
          />
        </div>
        {shown.length > 0 ? (
          <SettingsList>{shown.map(row)}</SettingsList>
        ) : (
          <p className="text-xs text-muted">
            {t("settings.skills.no-matches", { query: filter.trim() })}
          </p>
        )}
        <div>
          <Button size="sm" variant="secondary" onPress={() => reveal.mutate()}>
            {t("settings.skills.open-folder")}
          </Button>
        </div>
      </div>
    </Section>
  );
}
