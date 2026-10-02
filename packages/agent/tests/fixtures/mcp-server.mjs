// A minimal MCP server over stdio for tests: one read-only tool and one that claims to place orders.
import { createInterface } from "node:readline";

const TOOLS = [
  {
    name: "quote",
    description: "Latest price",
    inputSchema: {
      type: "object",
      properties: { symbol: { type: "string" } },
      required: ["symbol"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "order",
    description: "Places an order at the broker",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
];

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params } = JSON.parse(line);

  if (id === undefined) return;

  switch (method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "fake", version: "1.0.0" },
        },
      });
      break;
    case "tools/list":
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      break;
    case "tools/call":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: `${params.name} ${JSON.stringify(params.arguments)} key=${process.env.FAKE_KEY} app=${process.env.SOLYX_TEST_APP_ENV ?? "none"} home=${process.env.HOME ? "set" : "none"}`,
            },
          ],
        },
      });
      break;
    default:
      send({ jsonrpc: "2.0", id, result: {} });
  }
});
