import { Switch } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { SandboxStatus } from "@solyx/api/settings";

import { orpc } from "../../app/rpc.ts";
import { SectionLoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { Section } from "../../components/section.tsx";

import { SettingsList, SettingsRow } from "./settings-list.tsx";
import { codeExecutionQuery } from "./settings-query.ts";

/** The switch for the sandbox, saying why it cannot start or that the system has none. */
function SandboxRow({ sandbox }: { sandbox: SandboxStatus }) {
  const { t } = useTranslation();

  const save = useMutation(
    orpc.settings.setAgentShellSandbox.mutationOptions()
  );

  const description = !sandbox.supported
    ? t("settings.code-execution.sandbox-unsupported")
    : sandbox.problems.length > 0
      ? t("settings.code-execution.sandbox-problems", {
          problems: sandbox.problems.join("; "),
        })
      : t("settings.code-execution.sandbox-description");

  return (
    <SettingsRow
      label={t("settings.code-execution.sandbox")}
      description={description}
      actions={
        <Switch
          isSelected={sandbox.supported && sandbox.enabled}
          isDisabled={!sandbox.supported || save.isPending}
          onChange={(enabled) => save.mutate(enabled)}>
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
            <span className="sr-only">
              {t("settings.code-execution.sandbox-label")}
            </span>
          </Switch.Content>
        </Switch>
      }
    />
  );
}

/** What may run code on this computer: the agent's shell, and the sandbox it and the strategies' code run in. */
export function CodeExecutionSettings() {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(codeExecutionQuery());
  const shell = useMutation(orpc.settings.setAgentShell.mutationOptions());

  if (error) {
    return <SectionLoadError error={error} onRetry={() => void refetch()} />;
  }

  if (!data) return <LoadingState />;

  return (
    <Section title={t("settings.sections.code-execution")}>
      <SettingsList>
        <SettingsRow
          label={t("settings.code-execution.shell")}
          description={t("settings.code-execution.shell-description")}
          actions={
            <Switch
              isSelected={data.shell}
              isDisabled={shell.isPending}
              onChange={(enabled) => shell.mutate(enabled)}>
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <span className="sr-only">
                  {t("settings.code-execution.shell-label")}
                </span>
              </Switch.Content>
            </Switch>
          }
        />
        <SandboxRow sandbox={data.sandbox} />
      </SettingsList>
    </Section>
  );
}
