declare module "virtual:latest-releases" {
  import type { latestReleases } from "#lib/releases";

  /** The newest release of each channel, as GitHub listed them when the site was built. */
  const latest: ReturnType<typeof latestReleases>;

  export default latest;
}

declare module "virtual:release-notes" {
  import type { Release } from "#lib/releases";

  /** Every release that merged a pull request, newest first, as GitHub listed them at build time. */
  const releases: Release[];

  export default releases;
}
