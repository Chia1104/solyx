import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { contentText } from "@earendil-works/pi-ai";
import type {
  ToolExecutionApi,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import { expect, test, vi } from "vite-plus/test";

import { pdfText } from "../src/attachment.ts";
import { createAttachmentTools } from "../src/read-attachment.ts";

const PATH = "attachments/1700000000000/annual-report.pdf";

// A long report of 40 pages, each a page's worth of figures.
const report = pdfText(
  Array.from({ length: 40 }, (_, at) =>
    [
      `第 ${at + 1} 頁的內容`.padEnd(900, "。"),
      at === 31 ? "資本支出 400 億美元" : "",
    ].join("\n")
  )
);

function setup(text = report) {
  const reader = { text: vi.fn(async () => text) };
  const [tool] = createAttachmentTools({ reader }).tools ?? [];

  // SAFETY: the tool reads only which conversation it runs in.
  const api = { conversationId: 7, callId: "call-1" } as ToolExecutionApi;

  const call = async (params: Parameters<ToolRegistration["execute"]>[0]) => {
    const result = await tool?.execute(params, api, BACKGROUND_CONTEXT);

    return contentText(result?.output ?? []);
  };

  return { reader, call };
}

test("a long file is read a part at a time, each saying where it stands and where to go on", async () => {
  const { reader, call } = setup();

  const first = await call({ path: PATH });

  expect(reader.text).toHaveBeenCalledWith(7, PATH);
  expect(first).toMatch(
    /^annual-report\.pdf: characters 1 to 20000 of \d+, pages 1 to 22 of 40\. Read on with start 20000\.\n\n\[page 1\]\n第 1 頁/
  );

  const last = await call({ path: PATH, start: report.length - 10 });

  expect(last).toMatch(/pages 40 to 40 of 40\. That is the end of it\./);

  await expect(call({ path: PATH, start: report.length })).rejects.toThrow(
    "has none from"
  );
});

test("a search names each place the words appear, with the start and page to read them at", async () => {
  const { call } = setup();

  const found = await call({ path: PATH, search: "資本支出" });

  expect(found).toMatch(
    /^"資本支出" appears 1 times in annual-report\.pdf:\n- start \d+ \(page 32\): …[^\n]*資本支出 400 億美元/
  );
  expect(await call({ path: PATH, search: "股利" })).toBe(
    '"股利" is nowhere in annual-report.pdf.'
  );
});

test("a path that is not a kept file's is refused before anything is read", async () => {
  const { reader, call } = setup();

  await expect(call({ path: "../../.ssh/id_ed25519" })).rejects.toThrow();
  await expect(call({ path: "attachments/1/.text/a.txt" })).rejects.toThrow();
  expect(reader.text).not.toHaveBeenCalled();
});
