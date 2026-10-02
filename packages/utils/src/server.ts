import { watch } from "node:fs";
import { basename, dirname } from "node:path";

import { debounce } from "es-toolkit";

/**
 * Calls `onChange` shortly after `file` changes on disk, whoever changed it, until the returned
 * function stops watching. The file's folder must exist.
 */
export function watchFile(file: string, onChange: () => void): () => void {
  const notify = debounce(onChange, 200);

  // Editors often save by renaming a new file into place, so the folder is watched.
  const watcher = watch(dirname(file), (_event, name) => {
    if (name === basename(file)) notify();
  });

  return () => {
    notify.cancel();
    watcher.close();
  };
}
