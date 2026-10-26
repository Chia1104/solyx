/** How likely a strategy's code does each thing that makes it unsafe to run unasked, from 0 to 1. */
export interface CodeJudgement {
  model: string;
  files: number;
  network: number;
  secrets: number;
  runs: number;
}

/** One file of a strategy's code, by its path from the strategy's folder. */
export interface CodeFile {
  path: string;
  text: string;
}

/**
 * Judges the code of a strategy the user wrote: its files and the command that runs them. One
 * implementation per decisions model. It rejects code too long for its model to read whole rather
 * than judge part of it.
 */
export interface CodeJudge {
  judge(
    input: { command: string; files: readonly CodeFile[] },
    options?: { signal?: AbortSignal }
  ): Promise<CodeJudgement>;
}
