import * as z from "zod";

import { GITHUB_URL } from "./links.ts";

/** Solyx itself, or Solyx Nightly, which installs beside it. */
export const Channel = {
  Stable: "stable",
  Nightly: "nightly",
} as const;

export type Channel = (typeof Channel)[keyof typeof Channel];

/** The systems a release ships an installer for. */
export const Platform = {
  MacOS: "macos",
  Windows: "windows",
} as const;

export type Platform = (typeof Platform)[keyof typeof Platform];

const INSTALLER_TYPES = {
  [Platform.MacOS]: ".dmg",
  [Platform.Windows]: ".exe",
};

/** A release as GitHub's REST API lists it; a draft has no publication date yet. */
const GitHubReleaseSchema = z.object({
  tag_name: z.string(),
  html_url: z.url(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.iso.datetime().nullable(),
  assets: z.array(
    z.object({
      name: z.string(),
      size: z.number(),
      browser_download_url: z.url(),
    })
  ),
});

function toRelease(
  release: z.infer<typeof GitHubReleaseSchema>,
  publishedAt: string
) {
  return {
    version: release.tag_name.replace(/^v/, ""),
    channel: release.prerelease ? Channel.Nightly : Channel.Stable,
    publishedAt,
    url: release.html_url,
    installers: release.assets.flatMap((asset) => {
      const platform = Object.values(Platform).find((candidate) =>
        asset.name.endsWith(INSTALLER_TYPES[candidate])
      );

      return platform
        ? [
            {
              platform,
              name: asset.name,
              size: asset.size,
              url: asset.browser_download_url,
            },
          ]
        : [];
    }),
  };
}

export type Release = ReturnType<typeof toRelease>;

const API_URL = GITHUB_URL.replace("github.com", "api.github.com/repos");

/**
 * Every published release, newest first, read from GitHub while the site builds. A token, as CI
 * passes, keeps the build clear of the API's limit for anonymous callers.
 */
export async function readReleases(
  token: string | undefined
): Promise<Release[]> {
  const releases: Release[] = [];

  for (let page = 1; ; page++) {
    const response = await fetch(
      `${API_URL}/releases?per_page=100&page=${page}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          ...(token && { authorization: `Bearer ${token}` }),
        },
      }
    );

    if (!response.ok) {
      throw new Error(
        `GitHub releases: ${response.status} ${await response.text()}`
      );
    }

    const batch = z.array(GitHubReleaseSchema).parse(await response.json());

    for (const release of batch) {
      if (!release.draft && release.published_at) {
        releases.push(toRelease(release, release.published_at));
      }
    }

    if (batch.length < 100) return releases;
  }
}

/** The newest release of each channel that has one. */
export function latestReleases(releases: Release[]) {
  return {
    [Channel.Stable]: releases.find(
      (release) => release.channel === Channel.Stable
    ),
    [Channel.Nightly]: releases.find(
      (release) => release.channel === Channel.Nightly
    ),
  };
}
