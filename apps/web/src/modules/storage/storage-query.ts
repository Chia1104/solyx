import { orpc } from "../../app/rpc.ts";

/** Measured afresh whenever the page shows, since nothing pushes what the files take up. */
export const storageUsageQuery = () =>
  orpc.storage.usage.queryOptions({ staleTime: 0 });
