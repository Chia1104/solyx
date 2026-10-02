/** The first line of `text`, cut to `max` characters with an ellipsis. */
export function firstLine(text: string, max: number): string {
  const [line = ""] = text.trim().split("\n");

  return line.length > max ? `${line.slice(0, max)}…` : line;
}
