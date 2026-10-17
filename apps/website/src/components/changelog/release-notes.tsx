import { useTranslation } from "react-i18next";

import { GITHUB_URL } from "../../lib/links.ts";
import { ChangeKind } from "../../lib/releases.ts";
import type { Release } from "../../lib/releases.ts";
import { SheetRow } from "../landing/sheet.tsx";
import { Badge } from "../ui/badge.tsx";

const KINDS = [ChangeKind.Feature, ChangeKind.Fix, ChangeKind.Other];

/** One release's merged pull requests, new features first. Its version is its anchor. */
export function ReleaseNotes({ release }: { release: Release }) {
  const { t } = useTranslation();

  return (
    <SheetRow
      id={release.version}
      className="scroll-mt-16 px-6 py-12 md:px-10 md:py-14">
      <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-[15rem_1fr] md:gap-10">
        <div className="md:sticky md:top-20 md:self-start">
          <h2 className="font-semibold break-all tabular-nums">
            <a href={`#${release.version}`} className="hover:text-primary">
              {release.version}
            </a>
          </h2>
          <p className="text-muted-foreground mt-1 text-sm tabular-nums">
            {release.publishedAt.slice(0, 10)} ·{" "}
            {t(`download.channel.${release.channel}.name`)}
          </p>
          <a
            href={release.url}
            className="text-primary mt-2 inline-block text-sm hover:underline">
            {t("changelog.on-github")}
          </a>
        </div>
        <div className="space-y-7">
          {KINDS.map((kind) => {
            const changes = release.changes.filter(
              (change) => change.kind === kind
            );

            return (
              changes.length > 0 && (
                <section key={kind}>
                  <h3 className="text-muted-foreground text-xs font-medium tracking-[0.08em] uppercase">
                    {t(`changelog.kind.${kind}`)}
                  </h3>
                  <ul className="mt-3 space-y-2.5">
                    {changes.map((change) => (
                      <li
                        key={change.pullRequest}
                        className="flex items-baseline gap-3 leading-relaxed">
                        <span className="min-w-0 flex-1 text-pretty">
                          {change.scope && (
                            <Badge
                              variant="outline"
                              className="mr-2 align-[0.1em]">
                              {change.scope}
                            </Badge>
                          )}
                          {change.summary}
                        </span>
                        <a
                          href={`${GITHUB_URL}/pull/${change.pullRequest}`}
                          aria-label={t("changelog.pull-request", {
                            number: change.pullRequest,
                          })}
                          className="text-muted-foreground hover:text-primary shrink-0 text-sm tabular-nums">
                          #{change.pullRequest}
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            );
          })}
        </div>
      </div>
    </SheetRow>
  );
}
