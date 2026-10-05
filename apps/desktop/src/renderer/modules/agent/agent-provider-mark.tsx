// Emitted as files, since the CSP lets images come only from the app's own bundle.
import antgroup from "@lobehub/icons-static-svg/icons/antgroup-color.svg?no-inline";
import baseten from "@lobehub/icons-static-svg/icons/baseten.svg?no-inline";
import cerebras from "@lobehub/icons-static-svg/icons/cerebras-color.svg?no-inline";
import claude from "@lobehub/icons-static-svg/icons/claude-color.svg?no-inline";
import deepseek from "@lobehub/icons-static-svg/icons/deepseek-color.svg?no-inline";
import fireworks from "@lobehub/icons-static-svg/icons/fireworks-color.svg?no-inline";
import gemini from "@lobehub/icons-static-svg/icons/gemini-color.svg?no-inline";
import groq from "@lobehub/icons-static-svg/icons/groq.svg?no-inline";
import huggingface from "@lobehub/icons-static-svg/icons/huggingface-color.svg?no-inline";
import kimi from "@lobehub/icons-static-svg/icons/kimi-color.svg?no-inline";
import meta from "@lobehub/icons-static-svg/icons/meta-color.svg?no-inline";
import minimax from "@lobehub/icons-static-svg/icons/minimax-color.svg?no-inline";
import mistral from "@lobehub/icons-static-svg/icons/mistral-color.svg?no-inline";
import moonshot from "@lobehub/icons-static-svg/icons/moonshot.svg?no-inline";
import nvidia from "@lobehub/icons-static-svg/icons/nvidia-color.svg?no-inline";
import openai from "@lobehub/icons-static-svg/icons/openai.svg?no-inline";
import opencode from "@lobehub/icons-static-svg/icons/opencode.svg?no-inline";
import openrouter from "@lobehub/icons-static-svg/icons/openrouter.svg?no-inline";
import qwen from "@lobehub/icons-static-svg/icons/qwen-color.svg?no-inline";
import together from "@lobehub/icons-static-svg/icons/together-color.svg?no-inline";
import vercel from "@lobehub/icons-static-svg/icons/vercel.svg?no-inline";
import xai from "@lobehub/icons-static-svg/icons/xai.svg?no-inline";
import xiaomi from "@lobehub/icons-static-svg/icons/xiaomimimo.svg?no-inline";
import zai from "@lobehub/icons-static-svg/icons/zai.svg?no-inline";

import type { AgentProvider } from "@solyx/agent/providers";

import { LogoMark } from "../../components/logo-mark.tsx";
import type { Logo } from "../../components/logo-mark.tsx";

/** Providers' own logos by id, from lobe-icons: in the brand's colours, or one shape to tint. */
const MARKS: Partial<Record<AgentProvider, Logo>> = {
  "ant-ling": { src: antgroup, colored: true },
  anthropic: { src: claude, colored: true },
  baseten: { src: baseten, colored: false },
  cerebras: { src: cerebras, colored: true },
  deepseek: { src: deepseek, colored: true },
  fireworks: { src: fireworks, colored: true },
  google: { src: gemini, colored: true },
  groq: { src: groq, colored: false },
  huggingface: { src: huggingface, colored: true },
  "kimi-coding": { src: kimi, colored: true },
  meta: { src: meta, colored: true },
  minimax: { src: minimax, colored: true },
  "minimax-cn": { src: minimax, colored: true },
  mistral: { src: mistral, colored: true },
  moonshotai: { src: moonshot, colored: false },
  "moonshotai-cn": { src: moonshot, colored: false },
  nvidia: { src: nvidia, colored: true },
  openai: { src: openai, colored: false },
  opencode: { src: opencode, colored: false },
  "opencode-go": { src: opencode, colored: false },
  openrouter: { src: openrouter, colored: false },
  "qwen-token-plan": { src: qwen, colored: true },
  "qwen-token-plan-cn": { src: qwen, colored: true },
  "qwen-token-plan-individual": { src: qwen, colored: true },
  together: { src: together, colored: true },
  "vercel-ai-gateway": { src: vercel, colored: false },
  xai: { src: xai, colored: false },
  xiaomi: { src: xiaomi, colored: false },
  "xiaomi-token-plan-ams": { src: xiaomi, colored: false },
  "xiaomi-token-plan-cn": { src: xiaomi, colored: false },
  "xiaomi-token-plan-sgp": { src: xiaomi, colored: false },
  zai: { src: zai, colored: false },
  "zai-coding-cn": { src: zai, colored: false },
};

/** The provider's logo, beside its models and wherever it is switched on. */
export function ProviderMark({
  provider,
  className,
}: {
  provider: AgentProvider;
  className?: string;
}) {
  return (
    <LogoMark
      logo={Object.hasOwn(MARKS, provider) ? MARKS[provider] : undefined}
      name={provider}
      className={className}
    />
  );
}
