import { expect, test } from "vite-plus/test";

import {
  PartKind,
  changedFiles,
} from "../src/modules/strategies/strategy-diff.ts";

const file = (
  path: string,
  digest: string,
  text: string | null,
  bytes = 4
) => ({
  path,
  bytes,
  digest,
  text,
});

test("a file of the same size that is not text, but holds other bytes, is named as changed", () => {
  const previous = {
    version: "v1",
    files: [
      file("model.bin", "aaa", null),
      file("strategy.py", "s1", "x = 1\n"),
    ],
  };

  const current = {
    version: "v2",
    files: [
      file("model.bin", "bbb", null),
      file("strategy.py", "s1", "x = 1\n"),
    ],
  };

  expect(changedFiles(previous, current)).toEqual([
    expect.objectContaining({ path: "model.bin", text: false }),
  ]);
});

test("a text file's lines show as kept, added and removed, and a file gone or new shows whole", () => {
  const changes = changedFiles(
    {
      version: "v1",
      files: [
        file("a.py", "a1", "x = 1\ny = 2\n"),
        file("gone.py", "g", "old\n"),
      ],
    },
    {
      version: "v2",
      files: [
        file("a.py", "a2", "x = 1\ny = 3\n"),
        file("new.py", "n", "fresh\n"),
      ],
    }
  );

  expect(changes.map(({ path, text }) => [path, text])).toEqual([
    ["a.py", true],
    ["gone.py", true],
    ["new.py", true],
  ]);
  expect(changes[0].parts).toEqual([
    { kind: PartKind.Kept, lines: ["x = 1"] },
    { kind: PartKind.Removed, lines: ["y = 2"] },
    { kind: PartKind.Added, lines: ["y = 3"] },
  ]);
  expect(changes[1].parts).toEqual([
    { kind: PartKind.Removed, lines: ["old"] },
  ]);
  expect(changes[2].parts).toEqual([
    { kind: PartKind.Added, lines: ["fresh"] },
  ]);
});

test("a file that was not text and is text now shows every line it holds as added", () => {
  const changes = changedFiles(
    { version: "v1", files: [file("run.sh", "b1", null)] },
    { version: "v2", files: [file("run.sh", "t1", "curl example.com\n")] }
  );

  expect(changes).toEqual([
    {
      path: "run.sh",
      text: true,
      parts: [{ kind: PartKind.Added, lines: ["curl example.com"] }],
    },
  ]);
});
