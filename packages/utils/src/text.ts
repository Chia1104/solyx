import { escapeRegExp } from "es-toolkit";

/** `text` with each run of whitespace as one space, and none at either end. */
export const normalizeSpace = (text: string) =>
  text.replace(/\s+/g, " ").trim();

/** `text` cut to `max` characters with an ellipsis after them, or whole where it fits. */
export const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

/** The first line of `text`, truncated to `max` characters. */
export const firstLine = (text: string, max: number) =>
  truncate(text.trim().split("\n")[0] ?? "", max);

/** `text` with the home folder written `~` wherever a path in it starts there, as a person reads a path. */
export const tildify = (text: string, home: string) =>
  text.replace(new RegExp(`${escapeRegExp(home)}(?=[/\\\\]|$)`, "g"), "~");
