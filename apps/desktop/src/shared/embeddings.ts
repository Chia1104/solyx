export const LocalModelStatus = {
  /** Nothing answers where the settings say it runs, as while Ollama is not running. */
  Unreachable: "unreachable",
  Missing: "missing",
  Pulling: "pulling",
  Ready: "ready",
} as const;

export type LocalModelStatus =
  (typeof LocalModelStatus)[keyof typeof LocalModelStatus];

/** What the server on this computer has of the model the embeddings settings name. */
export type LocalModelState =
  | { status: typeof LocalModelStatus.Unreachable; model: string; host: string }
  | {
      status: typeof LocalModelStatus.Missing;
      model: string;
      /** Why the last pull of it failed; `null` where none did. */
      failure: string | null;
    }
  | {
      status: typeof LocalModelStatus.Pulling;
      model: string;
      /** Bytes of the layers Ollama has named so far; `0` of `0` until it names the first. */
      completed: number;
      total: number;
    }
  | { status: typeof LocalModelStatus.Ready; model: string };

// Hosts that name this computer itself.
const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/;

/** Whether `url` reaches a server on this computer, so what is sent there stays on it. */
export const onThisComputer = (url: string) =>
  LOOPBACK.test(new URL(url).hostname);
