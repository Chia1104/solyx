import { Button, Chip, IconChevronRight } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { McpServerState } from "@solyx/agent/mcp-config";

import { AppLocation } from "#shared/ipc/settings.ts";
import type { McpServerSetting } from "#shared/ipc/settings.ts";
import { SettingsSection } from "#shared/settings-section.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { Section } from "../../components/section.tsx";
import { RailedColumn } from "../../components/sheet.tsx";

import { PolicyLegend, PolicyTally } from "./mcp-policy.tsx";
import { McpServer, McpStateChip } from "./mcp-server.tsx";
import { SettingsList } from "./settings-list.tsx";
import { mcpQuery } from "./settings-query.ts";

/**
 * One server in the list, opening its page. A connected server shows what its tools may do; any
 * other shows what it waits for.
 */
function ServerRow({ server }: { server: McpServerSetting }) {
  const { t } = useTranslation();
  const missingSecret = server.secrets.some((secret) => !secret.saved);

  return (
    <li>
      <Link
        to="/settings"
        search={{ section: SettingsSection.Mcp, server: server.name }}
        className="-mx-3 flex items-center gap-4 rounded px-3 py-3 outline-none hover:bg-default/60 focus-visible:bg-default">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{server.name}</span>
            <span className="shrink-0 text-xs text-muted">
              {t(`settings.mcp.kinds.${server.kind}`)}
            </span>
            {server.state === McpServerState.Connected ? null : (
              <McpStateChip state={server.state} />
            )}
            {missingSecret ? (
              <Chip size="sm" variant="soft" color="warning">
                {t("settings.mcp.missing-secret")}
              </Chip>
            ) : null}
          </span>
          {server.error ? (
            <span className="truncate text-xs text-muted">{server.error}</span>
          ) : (
            <span className="truncate font-mono text-xs text-muted">
              {server.target}
            </span>
          )}
        </div>
        {server.tools.length > 0 ? (
          // A fixed column, so every server's tally starts from the same line and lengths compare.
          <span className="flex shrink-0 items-center gap-3">
            <span className="w-16 text-right text-xs text-muted tabular-nums">
              {t("settings.mcp.tool-count", { count: server.tools.length })}
            </span>
            <span className="flex w-32">
              <PolicyTally tools={server.tools} />
            </span>
          </span>
        ) : null}
        <IconChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
      </Link>
    </li>
  );
}

/**
 * The MCP servers in mcp.json as a list, or the one `server` names with its secrets and what each
 * tool may do. Servers connect when this page or the agent first needs them.
 */
export function McpSettings({ server }: { server?: string }) {
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

  // A server removed from mcp.json while its page is open falls back to the list.
  const opened = data.servers.find((entry) => entry.name === server);

  if (opened) return <McpServer server={opened} />;

  return (
    <Section
      title={t("settings.mcp.title")}
      description={t("settings.mcp.description", { path: data.path })}>
      <div className="flex flex-col gap-4">
        {data.error ? (
          <ErrorAlert
            title={t("settings.mcp.file-error")}
            description={data.error}
          />
        ) : null}
        {data.servers.length === 0 ? (
          <p className="text-sm text-muted">{t("settings.mcp.empty")}</p>
        ) : (
          <>
            <SettingsList>
              {data.servers.map((entry) => (
                <ServerRow key={entry.name} server={entry} />
              ))}
            </SettingsList>
            <PolicyLegend />
          </>
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
