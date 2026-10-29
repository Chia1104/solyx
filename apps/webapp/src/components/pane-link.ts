/** A side pane's row that opens a page, the open one lying on a sheet of its own as an open listing's does. */
export const PANE_LINK =
  "group flex items-center gap-3 rounded-sheet px-4 py-2 text-sm outline-none hover:bg-default/60 focus-visible:bg-default data-[status=active]:sheet data-[status=active]:font-medium";

/** The icon leading a `PANE_LINK`, inked while its page is open. */
export const PANE_LINK_ICON =
  "shrink-0 text-muted group-data-[status=active]:text-foreground";
