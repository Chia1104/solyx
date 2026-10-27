/** What a PDF's thread is started with: where pdf.js's CMaps are, and the file to read. */
export interface PdfRequest {
  /** The folder of pdf.js's CMaps, which ships beside the backend's bundle, ending in a separator. */
  cmaps: string;
  bytes: Uint8Array;
}

/** Each page's text, or why the file could not be read and whether a password locks it. */
export type PdfReply = { pages: string[] } | { error: string; locked: boolean };
