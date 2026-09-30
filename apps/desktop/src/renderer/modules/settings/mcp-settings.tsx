import { useMemo, useState } from "react";

import {
  Alert,
  Button,
  Chip,
  FieldError,
  Form,
  Input,
  ListBox,
  Select,
  TextField,
} from "@heroui/react";
import type { ChipProps } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { McpServerState, McpToolPolicy } from "@solyx/agent/mcp-config";
import { isEnumValue } from "@solyx/utils/is";

import { AppLocation } from "#shared/ipc/settings.ts";
import type { McpServerSetting, McpToolSetting } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { Section } from "../../components/section.tsx";
import { RailedColumn } from "../../components/sheet.tsx";

import { SettingsList, SettingsRow } from "./settings-list.tsx";
import { mcpQuery, settingsQueryKeys } from "./settings-query.ts";

const STATE_COLOR: Record<McpServerState, ChipProps["color"]> = {
  [McpServerState.Connecting]: "default",
  [McpServerState.Connected]: "success",
  [McpServerState.Failed]: "danger",
};

function useRefresh() {
  const queryClient = useQueryClient();

  return () =>
    queryClient.invalidateQueries({ queryKey: settingsQueryKeys.mcp });
}

/** Rebuilt per language so the field error comes out localized. */
function useValueSchema() {
  const { t } = useTranslation();

  return useMemo(
    () =>
      z.object({
        value: z
          .string()
          .trim()
          .min(1, { error: t("settings.secrets.required") }),
      }),
    [t]
  );
}

/** A secret the server's entry names as `secret:NAME`; its value is never read back. */
function McpSecretRow({
  server,
  name,
  saved,
}: {
  server: string;
  name: string;
  saved: boolean;
}) {
  const { t } = useTranslation();
  const refresh = useRefresh();
  const schema = useValueSchema();
  const [editing, setEditing] = useState(false);
  const label = `secret:${name}`;

  const form = useForm({
    resolver: zodResolver(schema),
    reValidateMode: "onSubmit",
    defaultValues: { value: "" },
  });

  const save = useMutation({
    mutationFn: (value: string) =>
      window.solyx.settings.saveMcpSecret(server, name, value),
    onSuccess: () => {
      form.reset();
      setEditing(false);
    },
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: () => window.solyx.settings.deleteMcpSecret(server, name),
    onSettled: refresh,
  });

  const submit = form.handleSubmit((values) => save.mutate(values.value));

  return (
    <SettingsRow
      label={<span className="font-mono text-xs">{label}</span>}
      value={
        saved
          ? t("settings.secrets.states.saved")
          : t("settings.secrets.states.missing")
      }
      actions={
        editing || !saved ? null : (
          <>
            <Button
              size="sm"
              variant="secondary"
              onPress={() => setEditing(true)}>
              {t("settings.secrets.replace")}
            </Button>
            <Button
              size="sm"
              variant="tertiary"
              isPending={remove.isPending}
              onPress={() => remove.mutate()}>
              {t("settings.secrets.remove")}
            </Button>
          </>
        )
      }>
      {editing || !saved ? (
        <Form
          validationBehavior="aria"
          className="flex items-start gap-2"
          onSubmit={(event) => void submit(event)}>
          <Controller
            control={form.control}
            name="value"
            render={({ field, fieldState }) => (
              <TextField
                isRequired
                aria-label={label}
                isInvalid={fieldState.invalid}
                className="grow">
                <Input
                  {...field}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                />
                <FieldError>{fieldState.error?.message}</FieldError>
              </TextField>
            )}
          />
          <Button type="submit" variant="secondary" isPending={save.isPending}>
            {t("settings.secrets.save")}
          </Button>
          {saved ? (
            <Button variant="tertiary" onPress={() => setEditing(false)}>
              {t("common.cancel")}
            </Button>
          ) : null}
        </Form>
      ) : null}
      {save.error ? (
        <ErrorAlert
          title={t("settings.secrets.save-failed")}
          description={save.error.message}
        />
      ) : null}
    </SettingsRow>
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
        <Select
          aria-label={label}
          className="w-44"
          value={tool.policy}
          isDisabled={save.isPending}
          // Only a tool its server marks read-only may run without asking.
          disabledKeys={tool.readOnly ? [] : [McpToolPolicy.Auto]}
          onChange={(key) => {
            if (
              key !== null &&
              isEnumValue(McpToolPolicy, key) &&
              key !== tool.policy
            ) {
              save.mutate(key);
            }
          }}>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {Object.values(McpToolPolicy).map((policy) => (
                <ListBox.Item
                  key={policy}
                  id={policy}
                  textValue={t(`settings.mcp.policies.${policy}`)}>
                  {t(`settings.mcp.policies.${policy}`)}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
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
        <ErrorAlert
          title={t("common.load-failed")}
          description={error.message}
          onRetry={() => void refetch()}
        />
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
