import { join } from "node:path";

/** Where the app keeps what a backup holds. */
export interface DataFolders {
  /** Electron's `userData`, which holds the databases. */
  dataDir: string;
  /** The folder of the config file and of what the user writes for the agent. */
  configDir: string;
  /** The folders the conversations' shell commands work in. */
  workspaces: string;
}

/** The databases the app's own migrations keep, each `<name>.sqlite` in `userData`. */
export const DRIZZLE_DATABASES = ["user", "research", "memory", "news"];

/** The agent's conversations, in pi-durable's schema. */
export const AGENT_DATABASE = "agent";

/** One file or folder of a backup: its path inside the bundle and where the app keeps it. */
export interface BackupPlace {
  part: string;
  path: string;
}

/** A database's place; the cache has none, since what it holds can be fetched again. */
export const databasePlace = (
  { dataDir }: DataFolders,
  name: string
): BackupPlace => ({
  part: join("databases", `${name}.sqlite`),
  path: join(dataDir, `${name}.sqlite`),
});

/**
 * What a backup holds beside the databases: the settings, and what the user wrote for the agent
 * and its conversations left. Secrets have no place, since the OS key that seals them stays on
 * this computer.
 */
export const filePlaces = ({
  configDir,
  workspaces,
}: DataFolders): BackupPlace[] => [
  ...["config.json", "mcp.json", "AGENTS.md", "skills"].map((name) => ({
    part: join("config", name),
    path: join(configDir, name),
  })),
  { part: "workspaces", path: workspaces },
];

/** Every place of a backup, the databases first. */
export const backupPlaces = (folders: DataFolders): BackupPlace[] => [
  ...[...DRIZZLE_DATABASES, AGENT_DATABASE].map((name) =>
    databasePlace(folders, name)
  ),
  ...filePlaces(folders),
];
