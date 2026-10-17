/** Each line of newline-delimited text a byte stream carries, as its bytes come in. */
export async function* lines(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let rest = "";

  for await (const bytes of body) {
    const parts = `${rest}${decoder.decode(bytes, { stream: true })}`.split(
      "\n"
    );

    rest = parts.pop() ?? "";
    yield* parts;
  }

  yield `${rest}${decoder.decode()}`;
}
