import { cn } from "@heroui/react";
// Emitted as files, since the CSP lets images come only from the app's own bundle.
import claude from "@lobehub/icons-static-svg/icons/claude-color.svg?no-inline";
import gemini from "@lobehub/icons-static-svg/icons/gemini-color.svg?no-inline";
import openai from "@lobehub/icons-static-svg/icons/openai.svg?no-inline";
import openrouter from "@lobehub/icons-static-svg/icons/openrouter.svg?no-inline";

import { AgentProvider } from "@solyx/agent/providers";

/** Each provider's own logo, from lobe-icons: in the brand's colours, or one shape to tint. */
const MARKS: Record<AgentProvider, { src: string; colored: boolean }> = {
  [AgentProvider.Anthropic]: { src: claude, colored: true },
  [AgentProvider.OpenAI]: { src: openai, colored: false },
  [AgentProvider.Google]: { src: gemini, colored: true },
  [AgentProvider.OpenRouter]: { src: openrouter, colored: false },
};

/**
 * The provider's logo, beside its models and wherever it is switched on. A coloured logo is drawn
 * as it is; a one-colour logo is a mask filled with the text colour, so it follows the theme.
 */
export function ProviderMark({
  provider,
  className,
}: {
  provider: AgentProvider;
  className?: string;
}) {
  const { src, colored } = MARKS[provider];

  return colored ? (
    <img
      aria-hidden
      alt=""
      src={src}
      draggable={false}
      className={cn("size-4 shrink-0 object-contain", className)}
    />
  ) : (
    <span
      aria-hidden
      className={cn("inline-block size-4 shrink-0 bg-current", className)}
      style={{ mask: `url("${src}") center / contain no-repeat` }}
    />
  );
}
