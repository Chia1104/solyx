import antgroup from "@lobehub/icons-static-svg/icons/antgroup-color.svg?url";
import baseten from "@lobehub/icons-static-svg/icons/baseten.svg?url";
import cerebras from "@lobehub/icons-static-svg/icons/cerebras-color.svg?url";
import claude from "@lobehub/icons-static-svg/icons/claude-color.svg?url";
import deepseek from "@lobehub/icons-static-svg/icons/deepseek-color.svg?url";
import exa from "@lobehub/icons-static-svg/icons/exa.svg?url";
import firecrawl from "@lobehub/icons-static-svg/icons/firecrawl-color.svg?url";
import fireworks from "@lobehub/icons-static-svg/icons/fireworks-color.svg?url";
import gemini from "@lobehub/icons-static-svg/icons/gemini-color.svg?url";
import githubcopilot from "@lobehub/icons-static-svg/icons/githubcopilot.svg?url";
import groq from "@lobehub/icons-static-svg/icons/groq.svg?url";
import huggingface from "@lobehub/icons-static-svg/icons/huggingface-color.svg?url";
import meta from "@lobehub/icons-static-svg/icons/meta-color.svg?url";
import minimax from "@lobehub/icons-static-svg/icons/minimax-color.svg?url";
import mistral from "@lobehub/icons-static-svg/icons/mistral-color.svg?url";
import moonshot from "@lobehub/icons-static-svg/icons/moonshot.svg?url";
import nvidia from "@lobehub/icons-static-svg/icons/nvidia-color.svg?url";
import ollama from "@lobehub/icons-static-svg/icons/ollama.svg?url";
import openai from "@lobehub/icons-static-svg/icons/openai.svg?url";
import opencode from "@lobehub/icons-static-svg/icons/opencode.svg?url";
import openrouter from "@lobehub/icons-static-svg/icons/openrouter.svg?url";
import qwen from "@lobehub/icons-static-svg/icons/qwen-color.svg?url";
import tavily from "@lobehub/icons-static-svg/icons/tavily-color.svg?url";
import together from "@lobehub/icons-static-svg/icons/together-color.svg?url";
import vercel from "@lobehub/icons-static-svg/icons/vercel.svg?url";
import xai from "@lobehub/icons-static-svg/icons/xai.svg?url";
import xiaomi from "@lobehub/icons-static-svg/icons/xiaomimimo.svg?url";
import zai from "@lobehub/icons-static-svg/icons/zai.svg?url";
import { cn } from "cn";

export interface Provider {
  name: string;
  logo: string;
  /** Drawn in the brand's colours; otherwise one shape tinted with the text colour. */
  colored: boolean;
}

/**
 * The model providers the app offers, one per company: pi-ai's built-in providers the agent's
 * catalog does not withhold, and Ollama. The logos are lobe-icons', as the app's own settings use.
 */
export const MODEL_PROVIDERS: Provider[] = [
  { name: "Anthropic", logo: claude, colored: true },
  { name: "OpenAI", logo: openai, colored: false },
  { name: "Google", logo: gemini, colored: true },
  { name: "xAI", logo: xai, colored: false },
  { name: "Meta", logo: meta, colored: true },
  { name: "DeepSeek", logo: deepseek, colored: true },
  { name: "Mistral", logo: mistral, colored: true },
  { name: "Qwen", logo: qwen, colored: true },
  { name: "Moonshot AI", logo: moonshot, colored: false },
  { name: "Z.AI", logo: zai, colored: false },
  { name: "MiniMax", logo: minimax, colored: true },
  { name: "Xiaomi", logo: xiaomi, colored: false },
  { name: "Ant Ling", logo: antgroup, colored: true },
  { name: "GitHub Copilot", logo: githubcopilot, colored: false },
  { name: "OpenRouter", logo: openrouter, colored: false },
  { name: "Vercel AI Gateway", logo: vercel, colored: false },
  { name: "Groq", logo: groq, colored: false },
  { name: "Cerebras", logo: cerebras, colored: true },
  { name: "Fireworks", logo: fireworks, colored: true },
  { name: "Together", logo: together, colored: true },
  { name: "Hugging Face", logo: huggingface, colored: true },
  { name: "NVIDIA", logo: nvidia, colored: true },
  { name: "Baseten", logo: baseten, colored: false },
  { name: "OpenCode", logo: opencode, colored: false },
  { name: "Ollama", logo: ollama, colored: false },
];

/** The web search vendors the app searches and reads the web through, as its settings draw them. */
export const WEB_SEARCH_VENDORS: Provider[] = [
  { name: "Firecrawl", logo: firecrawl, colored: true },
  { name: "Exa", logo: exa, colored: false },
  { name: "Tavily", logo: tavily, colored: true },
];

export function ProviderLogo({
  provider,
  className,
}: {
  provider: Provider;
  className?: string;
}) {
  return provider.colored ? (
    <img
      alt=""
      src={provider.logo}
      draggable={false}
      className={cn("size-5 shrink-0 object-contain", className)}
    />
  ) : (
    <span
      aria-hidden="true"
      className={cn("inline-block size-5 shrink-0 bg-current", className)}
      style={{ mask: `url("${provider.logo}") center / contain no-repeat` }}
    />
  );
}
