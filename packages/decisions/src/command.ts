/** How likely a shell command does each thing that makes it unsafe to run unasked, from 0 to 1. */
export interface CommandJudgement {
  model: string;
  changes: number;
  network: number;
  secrets: number;
  runs: number;
  privileged: number;
}

/** Judges a shell command. One implementation per decisions model. */
export interface CommandJudge {
  judge(
    input: { command: string; shell: string },
    options?: { signal?: AbortSignal }
  ): Promise<CommandJudgement>;
}
