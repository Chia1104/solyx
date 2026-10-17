declare module "virtual:latest-releases" {
  import type { latestReleases } from "#lib/releases";

  /** The newest release of each channel, as GitHub listed them when the site was built. */
  const latest: ReturnType<typeof latestReleases>;

  export default latest;
}
