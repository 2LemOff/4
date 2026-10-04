import type { Card, ModelInfo } from "../src/types";

export const claude: ModelInfo = {
  id: "anthropic/claude-sonnet-5.5",
  created: 300,
  context_length: 1_000_000,
  supported_parameters: ["max_tokens", "reasoning", "structured_outputs"],
  reasoning: { supported_efforts: ["max", "xhigh", "high", "medium", "low", "minimal"], default_effort: "medium", default_enabled: true, supports_max_tokens: true },
};
export const claudeTemp: ModelInfo = { ...claude, id: "anthropic/claude-opus-4.1", supported_parameters: ["max_tokens", "temperature", "top_p", "reasoning"] };
export const gemini: ModelInfo = {
  id: "google/gemini-3.5-pro",
  created: 400,
  context_length: 1_048_576,
  supported_parameters: ["max_tokens", "temperature", "top_p", "seed", "reasoning", "structured_outputs"],
  reasoning: { supported_efforts: ["high", "medium", "low", "minimal"], default_effort: "medium", default_enabled: true, mandatory: true, supports_max_tokens: true },
};
export const grok: ModelInfo = {
  id: "x-ai/grok-4.5",
  created: 350,
  context_length: 256_000,
  supported_parameters: ["max_tokens", "temperature", "reasoning"],
  reasoning: { supported_efforts: ["high", "low"], default_effort: "low", default_enabled: false },
};
export const gpt: ModelInfo = {
  id: "openai/gpt-5.6-sol",
  created: 380,
  context_length: 400_000,
  supported_parameters: ["max_tokens", "reasoning", "verbosity", "seed"],
  reasoning: { supported_efforts: ["xhigh", "high", "medium", "low", "none"], default_effort: "medium", default_enabled: true },
};
export const plain: ModelInfo = { id: "meta/plain-model", created: 1, supported_parameters: ["temperature", "max_tokens"] };

let n = 0;
export function card(over: Partial<Card> & { id: string }): Card {
  return {
    sessionId: "s1",
    parentId: null,
    question: `Q ${over.id}`,
    blocks: [],
    model: "google/gemini-3.5-pro",
    status: "done",
    createdAt: ++n,
    assistant: { content: `A ${over.id}` },
    ...over,
  };
}
