import { writeFile } from "node:fs/promises";

// Longer than a watcher waits before it reports, so an edit it noticed is reported before the next.
const SAVED_AGAIN_AFTER_MS = 500;

const LOOKED_EVERY_MS = 10;

/**
 * Saves `text` to a watched `file` as an editor outside the app would, until `reported` says the
 * watcher told of it. The system starts watching a folder a moment after `watch` returns, and an
 * edit made before then is never reported, so one save alone may go unseen.
 */
export async function handEdit(
  file: string,
  text: string,
  reported: () => boolean
) {
  while (!reported()) {
    await writeFile(file, text);

    const savedAgainAt = Date.now() + SAVED_AGAIN_AFTER_MS;

    while (!reported() && Date.now() < savedAgainAt) {
      await new Promise((resolve) => setTimeout(resolve, LOOKED_EVERY_MS));
    }
  }
}
