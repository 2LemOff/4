export type Effort = "max" | "xhigh" | "high" | "medium" | "low" | "minimal" | "none";
export const ALL_EFFORTS: Effort[] = ["max", "xhigh", "high", "medium", "low", "minimal", "none"];

export interface ModelReasoningInfo {
  supported_efforts?: Effort[] | null;
  default_effort?: Effort;
  default_enabled?: boolean;
  supports_max_tokens?: boolean;
  mandatory?: boolean;
}

export interface ModelInfo {
  id: string;
  name?: string;
  created?: number;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
  reasoning?: ModelReasoningInfo;
  architecture?: { output_modalities?: string[] };
}

export interface ReasoningSettings {
  /** undefined = use the model default */
  enabled?: boolean;
  effort?: Effort;
  /** reasoning token budget; mutually exclusive with effort */
  budget?: number;
  /** send exclude: true (reasoning is still billed) */
  exclude?: boolean;
  /** OpenAI GPT-5.6+ */
  mode?: "standard" | "pro";
  context?: "auto" | "all_turns" | "current_turn";
}

export interface ModelSettings {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  seed?: number;
  verbosity?: "low" | "medium" | "high";
  reasoning: ReasoningSettings;
  provider?: { sort?: "price" | "throughput" | "latency"; data_collection?: "allow" | "deny"; allow_fallbacks?: boolean };
  fallbackModels?: string[];
}

export interface ReasoningDetail {
  type: string;
  id?: string | null;
  format?: string;
  index?: number;
  text?: string;
  summary?: string;
  data?: string;
  signature?: string | null;
}

export interface AssistantMessage {
  content: string;
  reasoning?: string;
  reasoning_details?: ReasoningDetail[];
}

export interface Usage {
  prompt: number;
  completion: number;
  reasoning: number;
  cost?: number;
}

export interface Anchor {
  text: string;
  blockIdx: number;
  sentenceIdx: number;
}

export type CardStatus = "streaming" | "done" | "error" | "refused" | "length";

export interface Card {
  id: string;
  sessionId: string;
  parentId: string | null;
  anchor?: Anchor;
  question: string;
  /** effort change stored with the card so replays keep it in the same position */
  configUpdate?: { effort: Effort };
  blocks: string[];
  assistant?: AssistantMessage;
  model: string;
  modelSettings?: ModelSettings;
  usage?: Usage;
  tag?: string;
  status: CardStatus;
  error?: string;
  /** fresh-branch portals */
  portalFrom?: string;
  createdAt: number;
}

export interface Session {
  id: string;
  title: string;
  rootCardId: string;
  lastCardId: string;
  systemPrompt: string;
  answerModel: string;
  createdAt: number;
  updatedAt: number;
}

export interface OutlinePoint { text: string; cardIds: string[] }
export interface OutlineSection { heading: string; points: OutlinePoint[] }

export interface Outline {
  id: string;
  sessionId: string;
  version: number;
  title: string;
  category: string;
  summary: string;
  sections: OutlineSection[];
  synthesisSettings: SynthesisSettings;
  status: "pending" | "running" | "done" | "error";
  error?: string;
  createdAt: number;
}

export type SynthesisPreset = "outline" | "notes" | "flashcards" | "argument" | "chapter";

export interface SynthesisOptions {
  depth: 1 | 2 | 3;
  length: "brief" | "standard" | "detailed";
  examples: boolean;
  openQuestions: boolean;
  language: string;
}

export interface SynthesisSettings {
  prompt: string;
  preset: SynthesisPreset;
  options: SynthesisOptions;
  /** empty = the session's model */
  model: string;
  modelSettings?: ModelSettings;
  categoryMode: "reuse" | "free";
}

export interface PromptToggles {
  noWalls: boolean;
  firstPrinciples: boolean;
  premiseFormat: boolean;
  pushback: boolean;
}
