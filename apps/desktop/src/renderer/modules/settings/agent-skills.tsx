import { Alert, Button, Disclosure, Switch } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { AppLocation } from "#shared/ipc/settings.ts";
import type { AgentSkillInfo } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { Section } from "../../components/section.tsx";
import { RailedColumn } from "../../components/sheet.tsx";

import { SettingsList, SettingsRow } from "./settings-list.tsx";
import { agentSkillsQuery, settingsQueryKeys } from "./settings-query.ts";

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
      description={<span className="line-clamp-2">{skill.description}</span>}
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
  const queryClient = useQueryClient();
  const { data, error, refetch } = useQuery(agentSkillsQuery());

  const offer = useMutation({
    mutationFn: ({ name, offered }: { name: string; offered: boolean }) =>
      window.solyx.settings.setSharedSkill(name, offered),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: settingsQueryKeys.agentSkills,
      }),
  });

  const reveal = useMutation({
    mutationFn: () => window.solyx.settings.reveal(AppLocation.Skills),
  });

  if (error) {
    return (
      <RailedColumn className="px-6 py-5">
        <ErrorAlert
          title={t("common.load-failed")}
          description={error.message}
          onRetry={() => void refetch()}
        />
      </RailedColumn>
    );
  }

  if (!data) return <LoadingState />;

  const always = data.skills.filter((skill) => !skill.switchable);
  const shared = data.skills.filter((skill) => skill.switchable);

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
          {always.map(row)}
        </SettingsList>
        {shared.length > 0 ? (
          <Disclosure className="border-b border-separator">
            <Disclosure.Heading>
              <Disclosure.Trigger className="flex w-full items-center gap-2 py-2 text-sm font-medium">
                {t("settings.skills.shared")}
                <span className="text-xs text-muted tabular-nums">
                  {shared.filter((skill) => skill.offered).length}/
                  {shared.length}
                </span>
                <Disclosure.Indicator className="ml-auto" />
              </Disclosure.Trigger>
            </Disclosure.Heading>
            <Disclosure.Content>
              <SettingsList>{shared.map(row)}</SettingsList>
            </Disclosure.Content>
          </Disclosure>
        ) : null}
        <div>
          <Button size="sm" variant="secondary" onPress={() => reveal.mutate()}>
            {t("settings.skills.open-folder")}
          </Button>
        </div>
      </div>
    </Section>
  );
}
