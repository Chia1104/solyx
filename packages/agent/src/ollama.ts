import {
  calculateCost,
  clampThinkingLevel,
  collapseSystemMessages,
  contentText,
  createAssistantMessageEventStream,
  createProvider,
  getCurrentTools,
  getSystemMessageText,
  uuidv7,
} from "@earendil-works/pi-ai";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  ImageContent,
  JsonObject,
  Message,
  Model,
  Provider,
  SimpleStreamOptions,
  StreamOptions,
  TextContent,
  ThinkingContent,
  ToolCall,
  TranscriptContext,
  Usage,
} from "@earendil-works/pi-ai";
import { transformMessages } from "@earendil-works/pi-ai/api/transform-messages";
import * as z from "zod";

import { errorMessage } from "@solyx/utils/error";
import { parseJson } from "@solyx/utils/json";
import { lines } from "@solyx/utils/stream";

import type { AgentProvider } from "./providers.ts";

/** The provider's id, which no provider of pi-ai's takes. */
export const OLLAMA: AgentProvider = "ollama";

/** Where Ollama listens on this computer, until the user names another host. */
export const OLLAMA_ENDPOINT = "http://127.0.0.1:11434";

// Ollama's own chat API, the only one that takes a context length with each request.
const API = "ollama-chat";

// The context every request asks for, which pi-durable also compacts in: room for the agent's prompt
// and tools (about 17K tokens), pi-durable's 16K reserve and a conversation. Ollama sizes the
// model's cache to it.
const CONTEXT = 65_536;

// Below this the prompt, the tools and the reserve leave too little room for a conversation.
const MIN_CONTEXT = 49_152;

// pi-durable's reserve, so an answer stops before it runs past the window.
const MAX_TOKENS = 16_384;

const failureSchema = z.object({ error: z.string() });

const tagsSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      capabilities: z.array(z.string()).optional(),
      details: z
        .object({ context_length: z.number().int().positive().optional() })
        .optional(),
    })
  ),
});

type ListedModel = z.infer<typeof tagsSchema>["models"][number];

// A line of a reply as Ollama streams it: a piece of it, its last line with the counts, or why it stopped.
const chunkSchema = z.union([
  failureSchema,
  z.object({
    message: z
      .object({
        content: z.string().optional(),
        thinking: z.string().optional(),
        tool_calls: z
          .array(
            z.object({
              id: z.string().optional(),
              function: z.object({
                name: z.string(),
                arguments: z.record(z.string(), z.json()),
              }),
            })
          )
          .optional(),
      })
      .optional(),
    done: z.boolean(),
    done_reason: z.string().optional(),
    prompt_eval_count: z.number().optional(),
    prompt_eval_cached_count: z.number().optional(),
    eval_count: z.number().optional(),
  }),
]);

const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

/** Ollama's root address, without a trailing slash. */
const rootOf = (endpoint: string) => endpoint.replace(/\/+$/, "");

/**
 * A model the agent can run on: one that chats, calls tools and holds the agent's prompt with room
 * to spare. An embedding model may list tools too, so chatting is what tells it apart.
 */
function chatModel(listed: ListedModel, baseUrl: string): Model<Api>[] {
  const capabilities = new Set(listed.capabilities);
  const most = listed.details?.context_length;

  if (
    !capabilities.has("completion") ||
    !capabilities.has("tools") ||
    most === undefined ||
    most < MIN_CONTEXT
  ) {
    return [];
  }

  const reasoning = capabilities.has("thinking");

  return [
    {
      id: listed.name,
      name: listed.name,
      api: API,
      provider: OLLAMA,
      baseUrl,
      reasoning,
      // Ollama switches a model's thinking on or off, so one level stands for on.
      ...(reasoning && {
        thinkingLevelMap: { minimal: null, low: null, high: null },
      }),
      input: capabilities.has("vision") ? ["text", "image"] : ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: Math.min(most, CONTEXT),
      maxTokens: MAX_TOKENS,
    },
  ];
}

/** Reads `url` from the server, naming its host and the reason it gives when it fails. */
async function request(
  fetch: typeof globalThis.fetch,
  url: string,
  init: RequestInit
): Promise<Response> {
  const { host } = new URL(url);
  let response: Response;

  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new Error(`${host}: ${errorMessage(error)}`);
  }

  if (!response.ok) {
    const reason = parseJson(await response.text(), failureSchema)?.error;

    throw new Error(
      `${host} answered ${response.status}${reason ? `: ${reason}` : ""}`
    );
  }

  return response;
}

const authorization = (apiKey: string | undefined): Record<string, string> =>
  apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

/** A message as `/api/chat` takes it. */
interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  thinking?: string;
  /** Base64, as pi-ai keeps them. */
  images?: string[];
  tool_calls?: {
    id: string;
    function: { name: string; arguments: JsonObject };
  }[];
  tool_name?: string;
  tool_call_id?: string;
}

/** The images among a message's parts, in base64 as Ollama takes them. */
const images = (content: string | readonly (TextContent | ImageContent)[]) =>
  Array.isArray(content)
    ? content.flatMap((part) => (part.type === "image" ? [part.data] : []))
    : [];

/** The conversation as Ollama's messages, after pi-ai drops what this model cannot be sent. */
function ollamaMessages(model: Model<Api>, messages: Message[]) {
  return transformMessages(messages, model).flatMap(
    (message): OllamaMessage[] => {
      switch (message.role) {
        case "system":
          return [];

        case "user":
          return [
            {
              role: "user",
              content: contentText(message.content, "\n"),
              images: images(message.content),
            },
          ];

        case "assistant": {
          const calls = message.content.filter(
            (part): part is ToolCall => part.type === "toolCall"
          );

          return [
            {
              role: "assistant",
              content: message.content
                .flatMap((part) => (part.type === "text" ? [part.text] : []))
                .join(""),
              thinking: message.content
                .flatMap((part) =>
                  part.type === "thinking" ? [part.thinking] : []
                )
                .join(""),
              tool_calls: calls.map((call) => ({
                id: call.id,
                function: { name: call.name, arguments: call.arguments },
              })),
            },
          ];
        }

        case "toolResult":
          return [
            {
              role: "tool",
              tool_name: message.toolName,
              tool_call_id: message.toolCallId,
              content: contentText(message.content, "\n"),
              images: images(message.content),
            },
          ];
      }
    }
  );
}

/** What a request to `/api/chat` carries. */
function chatBody(
  model: Model<Api>,
  context: TranscriptContext,
  options: StreamOptions | undefined,
  think: boolean | undefined
) {
  // Ollama takes one system prompt, so the transcript's later changes fold into it.
  const transcript = collapseSystemMessages(context);
  const [first, ...rest] = transcript.messages;
  const system = first?.role === "system" ? first : undefined;
  const tools = getCurrentTools(transcript.messages);

  return {
    model: model.id,
    messages: [
      ...(system
        ? [{ role: "system", content: getSystemMessageText(system) }]
        : []),
      ...ollamaMessages(model, system ? rest : transcript.messages),
    ],
    ...(tools.length > 0 && {
      tools: tools.map(({ name, description, parameters }) => ({
        type: "function",
        function: { name, description, parameters },
      })),
    }),
    stream: true,
    ...(think !== undefined && { think }),
    options: {
      num_ctx: model.contextWindow,
      num_predict: options?.maxTokens ?? model.maxTokens,
      ...(options?.temperature !== undefined && {
        temperature: options.temperature,
      }),
    },
    // Past the window Ollama would drop or shift the oldest messages unseen; failing instead
    // leaves compacting to pi-durable, which keeps what was said.
    truncate: false,
    shift: false,
  };
}

/** Streams one reply from `/api/chat` as pi-ai's events. */
function chat(
  fetch: typeof globalThis.fetch,
  model: Model<Api>,
  context: TranscriptContext,
  options: StreamOptions | undefined,
  think: boolean | undefined
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const { host } = new URL(model.baseUrl);

  const output: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: NO_COST,
    },
    stopReason: "pending",
    timestamp: Date.now(),
  };

  void (async () => {
    try {
      const response = await request(
        options?.fetch ?? fetch,
        `${rootOf(model.baseUrl)}/api/chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authorization(options?.apiKey),
          },
          body: JSON.stringify(chatBody(model, context, options, think)),
          signal: options?.signal,
        }
      );

      if (!response.body) throw new Error(`${host} answered with nothing`);

      stream.push({ type: "start", partial: output });

      let open: TextContent | ThinkingContent | undefined;
      let reason: "stop" | "length" | "toolUse" | undefined;

      const close = () => {
        if (!open) return;

        const contentIndex = output.content.indexOf(open);

        stream.push(
          open.type === "text"
            ? {
                type: "text_end",
                contentIndex,
                content: open.text,
                partial: output,
              }
            : {
                type: "thinking_end",
                contentIndex,
                content: open.thinking,
                partial: output,
              }
        );

        open = undefined;
      };

      const append = (type: "text" | "thinking", delta: string) => {
        if (open?.type !== type) {
          close();
          open = type === "text" ? { type, text: "" } : { type, thinking: "" };
          output.content.push(open);
          stream.push({
            type: `${type}_start`,
            contentIndex: output.content.length - 1,
            partial: output,
          });
        }

        const contentIndex = output.content.length - 1;

        if (open.type === "text") {
          open.text += delta;
          stream.push({
            type: "text_delta",
            contentIndex,
            delta,
            partial: output,
          });
        } else {
          open.thinking += delta;
          stream.push({
            type: "thinking_delta",
            contentIndex,
            delta,
            partial: output,
          });
        }
      };

      for await (const line of lines(response.body)) {
        const chunk = parseJson(line, chunkSchema);

        if (!chunk) continue;

        // A reply that fails after it starts still answers 200, and says why in its last line.
        if ("error" in chunk) throw new Error(`${host}: ${chunk.error}`);

        const { message } = chunk;

        if (message?.thinking) append("thinking", message.thinking);

        if (message?.content) append("text", message.content);

        // Ollama sends each call whole, never its arguments in pieces.
        for (const call of message?.tool_calls ?? []) {
          close();

          const toolCall: ToolCall = {
            type: "toolCall",
            id: call.id || uuidv7(),
            name: call.function.name,
            arguments: call.function.arguments,
          };

          output.content.push(toolCall);

          const contentIndex = output.content.length - 1;

          stream.push({
            type: "toolcall_start",
            contentIndex,
            partial: output,
          });
          stream.push({
            type: "toolcall_delta",
            contentIndex,
            delta: JSON.stringify(toolCall.arguments),
            partial: output,
          });
          stream.push({
            type: "toolcall_end",
            contentIndex,
            toolCall,
            partial: output,
          });
        }

        if (chunk.done) {
          close();
          output.usage = usage(model, chunk);
          reason = output.content.some((part) => part.type === "toolCall")
            ? "toolUse"
            : chunk.done_reason === "length"
              ? "length"
              : "stop";
        }
      }

      if (options?.signal?.aborted) throw new Error("Request was aborted");

      if (reason === undefined) {
        throw new Error(`${host} stopped before the reply ended`);
      }

      output.stopReason = reason;
      stream.push({ type: "done", reason, message: output });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = errorMessage(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}

/** The counts on a reply's last line, in pi-ai's terms: Ollama counts the cached prompt in with the rest. */
function usage(
  model: Model<Api>,
  {
    prompt_eval_count = 0,
    prompt_eval_cached_count = 0,
    eval_count = 0,
  }: {
    prompt_eval_count?: number;
    prompt_eval_cached_count?: number;
    eval_count?: number;
  }
): Usage {
  const counted: Usage = {
    input: Math.max(0, prompt_eval_count - prompt_eval_cached_count),
    output: eval_count,
    cacheRead: prompt_eval_cached_count,
    cacheWrite: 0,
    totalTokens: prompt_eval_count + eval_count,
    cost: NO_COST,
  };

  return { ...counted, cost: calculateCost(model, counted) };
}

export interface OllamaProviderOptions {
  /** Ollama's address, read for every listing; a request goes where its model was served from. */
  endpoint: () => string;
  /** @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
}

/**
 * The user's own Ollama as a provider: the models it holds that can run the agent, listed from the
 * server, and replies through its own chat API with the context length each request needs.
 */
export function createOllamaProvider({
  endpoint,
  fetch = globalThis.fetch,
}: OllamaProviderOptions): Provider {
  return createProvider({
    id: OLLAMA,
    name: "Ollama",
    baseUrl: OLLAMA_ENDPOINT,
    auth: {
      apiKey: {
        name: "Ollama key",
        // Ollama checks no key; a proxy the user put in front of it may.
        async login(interaction) {
          const key = await interaction.prompt({
            type: "secret",
            message: "A key for the proxy in front of Ollama, if it checks one",
          });

          return { type: "api_key", key };
        },
        resolve: async ({ credential }) => ({
          auth: credential?.key ? { apiKey: credential.key } : {},
        }),
      },
    },
    models: [],
    async fetchModels({ credential, signal }) {
      const root = rootOf(endpoint());

      const response = await request(fetch, `${root}/api/tags`, {
        headers: authorization(
          credential?.type === "api_key" ? credential.key : undefined
        ),
        signal,
      });

      return tagsSchema
        .parse(await response.json())
        .models.flatMap((listed) => chatModel(listed, root));
    },
    api: {
      stream: (model, context, options) =>
        chat(fetch, model, context, options, undefined),

      streamSimple(model, context, options?: SimpleStreamOptions) {
        const level =
          model.reasoning && options?.reasoning
            ? clampThinkingLevel(model, options.reasoning)
            : undefined;

        return chat(
          fetch,
          model,
          context,
          options,
          model.reasoning ? level !== undefined && level !== "off" : undefined
        );
      },
    },
  });
}
