import { diffLines } from "diff";

import type { StrategyVersionFiles } from "@solyx/api/strategies";

type FileFiles = StrategyVersionFiles["files"][number];

/** What became of a run of a file's lines between two versions. */
export const PartKind = {
  Kept: "kept",
  Added: "added",
  Removed: "removed",
} as const;

export type PartKind = (typeof PartKind)[keyof typeof PartKind];

/** One run of lines a file kept, added or removed between two versions. */
export interface Part {
  kind: PartKind;
  lines: string[];
}

/** What changed in `path` between `before` and `after`, `null` where nothing did, told by what each holds. */
function fileParts(
  before: FileFiles | undefined,
  after: FileFiles | undefined
): Part[] | null {
  if (before?.digest === after?.digest) return null;

  return diffLines(before?.text ?? "", after?.text ?? "").map((change) => ({
    kind: change.added
      ? PartKind.Added
      : change.removed
        ? PartKind.Removed
        : PartKind.Kept,
    lines: change.value.replace(/\n$/, "").split("\n"),
  }));
}

/**
 * Each file whose content differs between `previous` and `current`, oldest path first, with the
 * runs of lines it kept, added and removed; a file that is not text on either side is named as
 * changed, never shown as text. With no `previous`, every file is added.
 */
export function changedFiles(
  previous: StrategyVersionFiles | null,
  current: StrategyVersionFiles
) {
  const paths = [
    ...new Set([
      ...(previous?.files ?? []).map((file) => file.path),
      ...current.files.map((file) => file.path),
    ]),
  ].toSorted();

  return paths.flatMap((path) => {
    const before = previous?.files.find((file) => file.path === path);
    const after = current.files.find((file) => file.path === path);
    const parts = fileParts(before, after);
    const text = before?.text !== null && after?.text !== null;

    return parts ? [{ path, parts, text }] : [];
  });
}
