import type { ConversationId, Storage } from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import type { SqliteExecutor } from "@earendil-works/pi-durable/storage/sqlite";
import { openNodeSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/node";

import { databaseBytes } from "./database-file.ts";

/** The pi-durable schema version the deletion below is written against. */
const DURABLE_SCHEMA_VERSION = 1;

export interface AgentStore {
  /** pi-durable's storage, which its Harness owns and closes. */
  storage: Storage;
  /**
   * Erases a conversation and everything it owns from the file, which pi-durable cannot do.
   * Rejects without deleting anything while the conversation has unfinished work, while another
   * conversation forks from it, or once pi-durable's schema has moved past the one this knows.
   */
  deleteConversation(id: ConversationId): Promise<void>;
  /** The file on disk, with its write-ahead log. */
  bytes(): number;
  /** Gives the space erased conversations held back to the disk. */
  compact(): Promise<void>;
}

const ids = (rows: { id: number }[]) =>
  JSON.stringify(rows.map((row) => row.id));

/** Matches an id in a JSON array bound as one parameter. */
const IN_IDS = "IN (SELECT value FROM json_each(?))";

async function eraseConversation(tx: SqliteExecutor, id: ConversationId) {
  const schema = await tx.get<{ version: number }>(
    "SELECT version FROM durable_schema WHERE singleton = 1"
  );

  if (schema?.version !== DURABLE_SCHEMA_VERSION) {
    throw new Error(
      `Conversations in pi-durable schema ${schema?.version} cannot be deleted yet`
    );
  }

  // The conversation, and those its tasks created, such as a subagent's.
  const conversations = ids(
    await tx.all<{ id: number }>(
      `WITH RECURSIVE owned(id) AS (
        SELECT id FROM conversations WHERE id = ?
        UNION
        SELECT conversations.id FROM conversations JOIN owned ON conversations.owner_conversation_id = owned.id
      )
      SELECT id FROM owned`,
      id
    )
  );

  const busy = await tx.get<{ count: number }>(
    `SELECT count(*) AS count FROM tasks WHERE conversation_id ${IN_IDS} AND status != 'terminal'`,
    conversations
  );

  if (busy?.count) {
    throw new Error(`Conversation ${id} still has work running`);
  }

  // A fork reads its parent's entries, so the parent must outlive it.
  const forks = await tx.get<{ count: number }>(
    `SELECT count(*) AS count FROM conversations
      WHERE json_extract(record, '$.parent.conversationId') ${IN_IDS}
      AND id NOT ${IN_IDS}`,
    conversations,
    conversations
  );

  if (forks?.count) {
    throw new Error(`Conversation ${id} has forks that read its history`);
  }

  const tasks = ids(
    await tx.all<{ id: number }>(
      `SELECT id FROM tasks WHERE conversation_id ${IN_IDS}`,
      conversations
    )
  );

  const documents = ids(
    await tx.all<{ id: number }>(
      `SELECT id FROM documents
        WHERE (scope_kind = 'conversation' AND owner_id ${IN_IDS})
        OR (scope_kind = 'task' AND owner_id ${IN_IDS})`,
      conversations,
      tasks
    )
  );

  // `record_ids` keeps the ids, which hold no content, so none is handed out twice.
  await tx.run(
    `DELETE FROM document_revisions WHERE document_id ${IN_IDS}`,
    documents
  );
  await tx.run(`DELETE FROM documents WHERE id ${IN_IDS}`, documents);
  await tx.run(
    `DELETE FROM submissions WHERE conversation_id ${IN_IDS}`,
    conversations
  );
  await tx.run(`DELETE FROM tasks WHERE id ${IN_IDS}`, tasks);
  await tx.run(
    `DELETE FROM entries WHERE conversation_id ${IN_IDS}`,
    conversations
  );
  await tx.run(`DELETE FROM conversations WHERE id ${IN_IDS}`, conversations);
}

/**
 * The agent's conversations, in a file pi-durable keeps in its own schema and migrates when it
 * opens. The file is opened here so deleting a conversation runs on the same connection, in line
 * with pi-durable's own writes.
 */
export async function openAgentStore(path: string): Promise<AgentStore> {
  const database = await openNodeSqliteDatabase(path);

  let storage: SqliteStorage;

  try {
    // Deleted rows are overwritten rather than left in free pages.
    await database.exec("PRAGMA secure_delete = ON");
    storage = await SqliteStorage.open(database);
  } catch (error) {
    await database.close();
    throw error;
  }

  return {
    storage,

    async deleteConversation(id) {
      await database.transaction((tx) => eraseConversation(tx, id));
      // The write-ahead log still holds the pages as they were before.
      await database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    },

    bytes: () => databaseBytes(path),

    // Queued behind pi-durable's own work on the connection, so no transaction is open.
    compact: () => database.exec("VACUUM; PRAGMA wal_checkpoint(TRUNCATE);"),
  };
}
