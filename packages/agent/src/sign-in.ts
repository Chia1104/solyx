/**
 * One sign-in at a time. A new one cancels the one still open, such as one whose browser page was
 * closed, and a cancelled sign-in resolves quietly.
 */
export function createSignInSlot() {
  let open: AbortController | undefined;

  return {
    async run(signIn: (signal: AbortSignal) => Promise<void>): Promise<void> {
      open?.abort();

      const controller = new AbortController();

      open = controller;

      try {
        await signIn(controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        if (open === controller) open = undefined;
      }
    },

    cancel() {
      open?.abort();
    },
  };
}
