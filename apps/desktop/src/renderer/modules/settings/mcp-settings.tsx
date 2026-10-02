import { Alert, Button, Chip } from "@heroui/react";
import type { ChipProps } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { McpServerState, McpToolPolicy } from "@solyx/agent/mcp-config";

import { AppLocation, SecretState } from "#shared/ipc/settings.ts";
import type { McpServerSetting, McpToolSetting } from "#shared/ipc/settings.ts";

import { currentLocale } from "../../app/i18n.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { OptionSelect } from "../../components/option-select.tsx";
import { Section } from "../../components/section.tsx";
import { RailedColumn } from "../../components/sheet.tsx";

import { SecretRow } from "./secret-row.tsx";
import { SettingsList, SettingsRow } from "./settings-list.tsx";
import { mcpQuery, settingsQueryKeys } from "./settings-query.ts";
import { SignInRow } from "./sign-in-row.tsx";

const STATE_COLOR: Record<McpServerState, ChipProps["color"]> = {
  [McpServerState.Connecting]: "default",
  [McpServerState.Connected]: "success",
  [McpServerState.NeedsSignIn]: "warning",
  [McpServerState.Failed]: "danger",
};

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

function ToolRow({ server, tool }: { server: string; tool: McpToolSetting }) {
  const { t } = useTranslation();
  const refresh = useRefresh();
  const label = t("settings.mcp.policy-label", { tool: tool.name });

  const save = useMutation({
    mutationFn: (policy: McpToolPolicy) =>
      window.solyx.settings.setMcpToolPolicy(server, tool.name, policy),
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
          <span className="line-clamp-2">{tool.description}</span>
        ) : undefined
      }
      actions={
        <OptionSelect
          aria-label={label}
          className="w-44"
          value={tool.policy}
          isDisabled={save.isPending}
          // Only a tool its server marks read-only may run without asking.
          disabledKeys={tool.readOnly ? [] : [McpToolPolicy.Auto]}
          options={Object.values(McpToolPolicy).map((policy) => ({
            id: policy,
            label: t(`settings.mcp.policies.${policy}`),
          }))}
          onChange={(policy) => save.mutate(policy)}
        />
      }
    />
  );
}

function ServerSection({ server }: { server: McpServerSetting }) {
  const { t } = useTranslation();
  const refresh = useRefresh();

  const reconnect = useMutation({
    mutationFn: () => window.solyx.settings.reconnectMcp(server.name),
    onSettled: refresh,
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{server.name}</h3>
        <span className="text-xs text-muted">
          {t(`settings.mcp.kinds.${server.kind}`)}
        </span>
        <Chip size="sm" variant="soft" color={STATE_COLOR[server.state]}>
          {t(`settings.mcp.states.${server.state}`)}
        </Chip>
        <Button
          size="sm"
          variant="tertiary"
          className="ml-auto"
          isPending={reconnect.isPending}
          isDisabled={server.state === McpServerState.Connecting}
          onPress={() => reconnect.mutate()}>
          {t("settings.mcp.reconnect")}
        </Button>
      </div>
      {server.target ? (
        <p
          className="truncate font-mono text-xs text-muted"
          title={server.target}>
          {server.target}
        </p>
      ) : null}
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
      <SettingsList>
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
        {server.tools.map((tool) => (
          <ToolRow key={tool.name} server={server.name} tool={tool} />
        ))}
      </SettingsList>
      {server.state === McpServerState.Connected &&
      server.tools.length === 0 ? (
        <p className="text-xs text-muted">{t("settings.mcp.no-tools")}</p>
      ) : null}
    </div>
  );
}

/**
 * The MCP servers in mcp.json, their secrets and what each tool may do. Servers connect when this
 * page or the agent first needs them.
 */
export function McpSettings() {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(mcpQuery());

  const open = useMutation({
    mutationFn: () => window.solyx.settings.reveal(AppLocation.Mcp),
  });

  if (error) {
    return (
      <RailedColumn className="px-6 py-5">
        <LoadError error={error} onRetry={() => void refetch()} />
      </RailedColumn>
    );
  }

  if (!data) return <LoadingState />;

  return (
    <Section
      title={t("settings.mcp.title")}
      description={t("settings.mcp.description", { path: data.path })}>
      <div className="flex flex-col gap-6">
        {data.error ? (
          <ErrorAlert
            title={t("settings.mcp.file-error")}
            description={data.error}
          />
        ) : null}
        {data.servers.length === 0 ? (
          <p className="text-sm text-muted">{t("settings.mcp.empty")}</p>
        ) : (
          data.servers.map((server) => (
            <ServerSection key={server.name} server={server} />
          ))
        )}
        <div>
          <Button size="sm" variant="secondary" onPress={() => open.mutate()}>
            {t("settings.mcp.open-file")}
          </Button>
        </div>
      </div>
    </Section>
  );
}
