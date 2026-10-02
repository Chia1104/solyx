import { useState } from "react";

import { Alert, Button, Chip } from "@heroui/react";
import type { ChipProps } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { uniq } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { McpServerState } from "@solyx/agent/mcp-config";
import type { McpToolPolicy } from "@solyx/agent/mcp-config";

import { SecretState } from "#shared/ipc/settings.ts";
import type { McpServerSetting, McpToolSetting } from "#shared/ipc/settings.ts";

import { currentLocale } from "../../app/i18n.ts";
import { FilterField, matchesFilter } from "../../components/filter-field.tsx";
import { Section } from "../../components/section.tsx";

import { PolicyTally, PolicyToggle } from "./mcp-policy.tsx";
import { SecretRow } from "./secret-row.tsx";
import { SettingsList, SettingsRow } from "./settings-list.tsx";
import { settingsQueryKeys } from "./settings-query.ts";
import { SettingsSection } from "./settings-section.ts";
import { SignInRow } from "./sign-in-row.tsx";

const STATE_COLOR: Record<McpServerState, ChipProps["color"]> = {
  [McpServerState.Connecting]: "default",
  [McpServerState.Connected]: "success",
  [McpServerState.NeedsSignIn]: "warning",
  [McpServerState.Failed]: "danger",
};

/** From this many tools a server's list gains a filter and a row that sets every tool it shows. */
const LONG_LIST = 8;

export function McpStateChip({ state }: { state: McpServerState }) {
  const { t } = useTranslation();

  return (
    <Chip size="sm" variant="soft" color={STATE_COLOR[state]}>
      {t(`settings.mcp.states.${state}`)}
    </Chip>
  );
}

function useRefresh() {
  const queryClient = useQueryClient();

  return () =>
    queryClient.invalidateQueries({ queryKey: settingsQueryKeys.mcp });
}

/** A secret the server's entry names as `secret:NAME`. */
function McpSecretRow({
  server,
  name,
  saved,
}: {
  server: string;
  name: string;
  saved: boolean;
}) {
  const refresh = useRefresh();
  const label = `secret:${name}`;

  return (
    <SecretRow
      label={<span className="font-mono text-xs">{label}</span>}
      fieldLabel={label}
      state={saved ? SecretState.Saved : SecretState.Missing}
      onSave={(value) =>
        window.solyx.settings.saveMcpSecret(server, name, value)
      }
      onRemove={() => window.solyx.settings.deleteMcpSecret(server, name)}
      onSettled={refresh}
    />
  );
}

/** The account a remote server runs on. */
function McpSignInRow({ server }: { server: McpServerSetting }) {
  const { t } = useTranslation();
  const refresh = useRefresh();

  return (
    <SignInRow
      label={t("settings.mcp.sign-in.label")}
      description={t("settings.mcp.sign-in.hint")}
      signInLabel={t("settings.mcp.sign-in.sign-in")}
      signInFailed={t("settings.mcp.sign-in.sign-in-failed")}
      signedIn={server.signedIn}
      needsSignIn={server.state === McpServerState.NeedsSignIn}
      onSignIn={() =>
        window.solyx.settings.signInMcp(server.name, currentLocale())
      }
      onCancel={() => window.solyx.settings.cancelMcpSignIn()}
      onSignOut={() => window.solyx.settings.signOutMcp(server.name)}
      onSettled={refresh}
    />
  );
}

function ConnectionRow({ server }: { server: McpServerSetting }) {
  const { t } = useTranslation();
  const refresh = useRefresh();

  const reconnect = useMutation({
    mutationFn: () => window.solyx.settings.reconnectMcp(server.name),
    onSettled: refresh,
  });

  return (
    <SettingsRow
      label={t("settings.mcp.connection")}
      description={
        <span className="block truncate font-mono" title={server.target}>
          {server.target}
        </span>
      }
      value={<McpStateChip state={server.state} />}
      actions={
        <Button
          size="sm"
          variant="tertiary"
          isPending={reconnect.isPending}
          isDisabled={server.state === McpServerState.Connecting}
          onPress={() => reconnect.mutate()}>
          {t("settings.mcp.reconnect")}
        </Button>
      }>
      {server.error ? (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description className="break-all">
              {server.error}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
    </SettingsRow>
  );
}

function ToolRow({ server, tool }: { server: string; tool: McpToolSetting }) {
  const { t } = useTranslation();
  const refresh = useRefresh();

  const save = useMutation({
    mutationFn: (policy: McpToolPolicy) =>
      window.solyx.settings.setMcpToolPolicy(server, [tool.name], policy),
    onSettled: refresh,
  });

  return (
    <SettingsRow
      label={
        <span className="flex items-center gap-2">
          <span className="font-mono text-xs">{tool.name}</span>
          {tool.readOnly ? (
            <Chip size="sm" variant="soft">
              {t("settings.mcp.read-only")}
            </Chip>
          ) : null}
        </span>
      }
      description={
        tool.description ? (
          <span className="line-clamp-1" title={tool.description}>
            {tool.description}
          </span>
        ) : undefined
      }
      actions={
        <PolicyToggle
          label={t("settings.mcp.policy-label", { tool: tool.name })}
          // Shows the choice while it saves rather than after the list reloads.
          value={(save.isPending ? save.variables : undefined) ?? tool.policy}
          allowsAuto={tool.readOnly}
          onChange={(policy) => save.mutate(policy)}
        />
      }
    />
  );
}

/**
 * Sets every tool the list shows, all of them or those the filter matches, and shows their policy
 * while they share one.
 */
function SetEveryRow({
  server,
  tools,
  filtering,
}: {
  server: string;
  tools: McpToolSetting[];
  filtering: boolean;
}) {
  const { t } = useTranslation();
  const refresh = useRefresh();

  const save = useMutation({
    mutationFn: (policy: McpToolPolicy) =>
      window.solyx.settings.setMcpToolPolicy(
        server,
        tools.map((tool) => tool.name),
        policy
      ),
    onSettled: refresh,
  });

  const policies = uniq(tools.map((tool) => tool.policy));
  const count = tools.length;

  return (
    <div className="flex items-center gap-4">
      <span className="min-w-0 flex-1 text-xs text-muted">
        {filtering
          ? t("settings.mcp.set-matching", { count })
          : t("settings.mcp.set-all", { count })}
      </span>
      <PolicyToggle
        label={t("settings.mcp.set-label", { count })}
        value={
          (save.isPending ? save.variables : undefined) ??
          (policies.length === 1 ? policies[0] : undefined)
        }
        allowsAuto={tools.every((tool) => tool.readOnly)}
        onChange={(policy) => save.mutate(policy)}
      />
    </div>
  );
}

function ToolList({ server }: { server: McpServerSetting }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");

  const shown = server.tools.filter((tool) =>
    matchesFilter(filter, tool.name, tool.title, tool.description)
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="text-sm font-semibold">{t("settings.mcp.tools")}</h3>
        <span className="text-xs text-muted tabular-nums">
          {server.tools.length}
        </span>
        <PolicyTally tools={server.tools} />
        {server.tools.length >= LONG_LIST ? (
          <FilterField
            label={t("settings.mcp.filter")}
            value={filter}
            onChange={setFilter}
            className="ml-auto w-48"
          />
        ) : null}
      </div>
      {server.tools.length >= LONG_LIST && shown.length > 1 ? (
        <SetEveryRow
          server={server.name}
          tools={shown}
          filtering={filter.trim() !== ""}
        />
      ) : null}
      <SettingsList>
        {shown.map((tool) => (
          <ToolRow key={tool.name} server={server.name} tool={tool} />
        ))}
      </SettingsList>
      {shown.length === 0 ? (
        <p className="text-xs text-muted">
          {t("settings.mcp.no-matches", { query: filter.trim() })}
        </p>
      ) : null}
    </div>
  );
}

/** One server from mcp.json: how it connects, the keys and account it runs on and its tools. */
export function McpServer({ server }: { server: McpServerSetting }) {
  const { t } = useTranslation();

  return (
    <Section
      title={
        <span className="flex min-w-0 items-baseline gap-2">
          <Link
            to="/settings"
            search={{ section: SettingsSection.Mcp }}
            className="shrink-0 font-normal text-muted outline-none hover:text-foreground hover:underline focus-visible:underline">
            {t("settings.mcp.title")}
          </Link>
          <span aria-hidden className="text-muted">
            /
          </span>
          <span className="truncate">{server.name}</span>
        </span>
      }>
      <div className="flex flex-col gap-6">
        <SettingsList>
          <ConnectionRow server={server} />
          {server.state === McpServerState.NeedsSignIn || server.signedIn ? (
            <McpSignInRow server={server} />
          ) : null}
          {server.secrets.map((secret) => (
            <McpSecretRow
              key={secret.name}
              server={server.name}
              name={secret.name}
              saved={secret.saved}
            />
          ))}
        </SettingsList>
        {server.tools.length > 0 ? (
          <ToolList server={server} />
        ) : server.state === McpServerState.Connected ? (
          <p className="text-xs text-muted">{t("settings.mcp.no-tools")}</p>
        ) : null}
      </div>
    </Section>
  );
}
