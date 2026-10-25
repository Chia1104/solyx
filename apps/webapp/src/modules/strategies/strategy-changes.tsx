import { cn } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { diffLines } from "diff";
import { useTranslation } from "react-i18next";

import type { StrategyVersionFiles } from "@solyx/api/strategies";

import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";

import { strategyReviewQuery } from "./strategies-query.ts";

/** The first characters of a version, as a person tells versions apart. */
export const shortVersion = (version: string) => version.slice(0, 8);

// Unchanged lines kept on each side of a change, so a change reads in its place.
const CONTEXT = 3;

type FileFiles = StrategyVersionFiles["files"][number];

/** What became of a run of a file's lines between two versions. */
const PartKind = {
  Kept: "kept",
  Added: "added",
  Removed: "removed",
} as const;

type PartKind = (typeof PartKind)[keyof typeof PartKind];

/** One run of lines a file kept, added or removed between two versions. */
interface Part {
  kind: PartKind;
  lines: string[];
}

/** What changed in `path` between `before` and `after`, `null` where nothing did. */
function fileParts(
  before: FileFiles | undefined,
  after: FileFiles | undefined
): Part[] | null {
  if (before?.text === after?.text && before?.bytes === after?.bytes) {
    return null;
  }

  return diffLines(before?.text ?? "", after?.text ?? "").map((change) => ({
    kind: change.added
      ? PartKind.Added
      : change.removed
        ? PartKind.Removed
        : PartKind.Kept,
    lines: change.value.replace(/\n$/, "").split("\n"),
  }));
}

/** A part as it is shown: kept lines far from any change folded to how many they are. */
function shownLines(part: Part, first: boolean, last: boolean) {
  if (part.kind !== PartKind.Kept || part.lines.length <= CONTEXT * 2) {
    return { head: part.lines, folded: 0, tail: [] };
  }

  const head = first ? [] : part.lines.slice(0, CONTEXT);
  const tail = last ? [] : part.lines.slice(-CONTEXT);

  return {
    head,
    folded: part.lines.length - head.length - tail.length,
    tail,
  };
}

const MARK: Record<PartKind, string> = {
  [PartKind.Kept]: " ",
  [PartKind.Added]: "+",
  [PartKind.Removed]: "-",
};

// Added in ink and removed in pencil, since red and green mark a price's direction alone.
const STYLE: Record<PartKind, string> = {
  [PartKind.Kept]: "text-muted",
  [PartKind.Added]: "font-semibold text-foreground",
  [PartKind.Removed]: "text-muted line-through",
};

function FileChange({ path, parts }: { path: string; parts: Part[] }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-1">
      <p className="font-mono text-xs">{path}</p>
      <pre className="overflow-auto rounded-sm bg-surface-secondary p-2 font-mono text-xs whitespace-pre-wrap">
        {parts.map((part, index) => {
          const { head, folded, tail } = shownLines(
            part,
            index === 0,
            index === parts.length - 1
          );

          const line = (text: string, at: number) => (
            <span key={at} className={cn("block", STYLE[part.kind])}>
              {`${MARK[part.kind]} ${text}`}
            </span>
          );

          return (
            <span key={index} className="block">
              {head.map(line)}
              {folded > 0 ? (
                <span className="block text-muted italic">
                  {t("strategies.changes.folded", { count: folded })}
                </span>
              ) : null}
              {tail.map((text, at) => line(text, head.length + at))}
            </span>
          );
        })}
      </pre>
    </div>
  );
}

/**
 * What changed in a strategy's files since the version allowed before them, each file's lines added
 * and removed, or every file where none was; one that is not text is named alone. It shows the
 * files as they are now, so a version they have left since is said so.
 */
export function StrategyChanges({
  name,
  version,
}: {
  name: string;
  version: string;
}) {
  const { t } = useTranslation();
  const review = useQuery(strategyReviewQuery(name));

  if (review.isPending) return <LoadingState />;

  if (review.error) {
    return (
      <LoadError error={review.error} onRetry={() => void review.refetch()} />
    );
  }

  const { current, previous } = review.data;

  if (current.version !== version) {
    return (
      <p role="alert" className="text-xs text-danger">
        {t("strategies.changes.moved-on")}
      </p>
    );
  }

  const paths = [
    ...new Set([
      ...(previous?.files ?? []).map((file) => file.path),
      ...current.files.map((file) => file.path),
    ]),
  ].toSorted();

  const changes = paths.flatMap((path) => {
    const before = previous?.files.find((file) => file.path === path);
    const after = current.files.find((file) => file.path === path);
    const parts = fileParts(before, after);

    return parts ? [{ path, parts, text: after?.text !== null }] : [];
  });

  return (
    <div className="flex max-h-96 flex-col gap-3 overflow-auto">
      <p className="text-xs text-muted">
        {previous
          ? t("strategies.changes.since", {
              version: shortVersion(previous.version),
              count: changes.length,
            })
          : t("strategies.changes.first", { count: current.files.length })}
      </p>
      {changes.map(({ path, parts, text }) =>
        text ? (
          <FileChange key={path} path={path} parts={parts} />
        ) : (
          <p key={path} className="font-mono text-xs">
            {t("strategies.changes.not-text", { path })}
          </p>
        )
      )}
    </div>
  );
}
