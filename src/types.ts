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
  architecture?: { output_modalities?: string[]; input_modalities?: string[] };
  /** speech models: the voices this model accepts */
  supported_voices?: string[];
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
  /** map points the question is about (global ids like K7.n2) */
  nodeIds?: string[];
  /** quoted texts of the selected points */
  quotes?: string[];
  /** what was selected: some points, a whole pyramid, a category, or highlighted words in the chat */
  scope?: "points" | "pyramid" | "category" | "highlights";
  /** chat highlights this question is about (their quotes are in `quotes`) */
  highlightIds?: string[];
  /** where each quote is from, set only when one is from the text read from a picture of the learner's */
  quoteFrom?: QuoteFrom[];
  /** v1 sentence anchors (kept so old sessions replay unchanged) */
  blockIdx?: number;
  sentenceIdx?: number;
}

export type CardStatus = "streaming" | "done" | "error" | "refused" | "length";
export type QuoteFrom = "answer" | "picture";

/** A photo or screenshot attached to a question (the picture itself is in `media`). */
export interface CardImage {
  mediaId: string;
  label: string;
  /** a part of another attached image, chosen with a box */
  partOf?: number;
  /** the text found in it (highlightable) */
  text?: string;
  textStatus?: "running" | "done" | "error";
  textError?: string;
}

export interface Card {
  id: string;
  sessionId: string;
  parentId: string | null;
  anchor?: Anchor;
  question: string;
  /** effort change stored with the card so replays keep it in the same position */
  configUpdate?: { effort: Effort };
  /** request-level effort actually in force for this card (root: the baseline sent on every replay) */
  effortUsed?: Effort;
  /** v1: answer paragraphs. v2: the text of each answer node, in order (search and embeddings use this) */
  blocks: string[];
  /** v2: per-session sequence number; node ids are prefixed K{seq} */
  seq?: number;
  /** v2: the answer as pyramids */
  answer?: import("./answer").Answer;
  assistant?: AssistantMessage;
  model: string;
  modelSettings?: ModelSettings;
  usage?: Usage;
  tag?: string;
  status: CardStatus;
  error?: string;
  /** answered by the LLM Council (model = the chairman) */
  mode?: "council";
  council?: CouncilData;
  /** fresh-branch portals */
  portalFrom?: string;
  /** asked from a visual's side chat (the study doc) */
  fromVisual?: string;
  /** photos or screenshots sent with the question */
  images?: CardImage[];
  createdAt: number;
}

export interface CouncilMember {
  label: string;
  model: string;
  status: "running" | "done" | "error";
  content: string;
  answer?: import("./answer").Answer;
  error?: string;
  usage?: Usage;
}

export interface CouncilReview {
  model: string;
  label: string;
  evaluation: string;
  ranking: string[];
  error?: string;
}

export interface CouncilData {
  stage: "members" | "reviews" | "chairman" | "checking" | "done" | "error";
  chairman: string;
  members: CouncilMember[];
  reviews: CouncilReview[];
  aggregate: { label: string; model: string; avgRank: number; votes: number }[];
  verifier?: string;
  /** chairman points that weren't found in the council's answers */
  unsupported?: string[];
  removed?: boolean;
  chairmanReasoning?: string;
  /** full-text council: each kept paragraph with the answers it came from */
  textSources?: { text: string; sources: string[] }[];
  /** full-text council: paragraphs not found in the members' answers (folded, never deleted) */
  unverified?: { text: string; sources: string[] }[];
  /** member sentences the final answer left out */
  leftOut?: { label: string; sentence: string }[];
  /** how much the members agree (0–1) */
  agreement?: number;
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

/** Words highlighted in an answer: the quote and where it sits in the answer's rendered text. */
export interface Highlight {
  id: string;
  sessionId: string;
  cardId: string;
  /** words in the text found in an attached image ("img0"), not in the answer */
  part?: string;
  quote: string;
  start: number;
  end: number;
  prefix: string;
  suffix: string;
  createdAt: number;
}

export type JobStatus = "running" | "done" | "error";

/** What a visual shows: one answer, highlighted words, a branch or the whole topic. */
export interface VisualScope {
  kind: "answer" | "highlight" | "highlights" | "branch" | "topic";
  cardIds: string[];
  highlightIds?: string[];
  label: string;
}

/**
 * A saved visual of a scope: its sentences (split when it was made), the arrangement the structural views are
 * drawn from, and any AI diagrams and sketch, each made on demand and kept so reopening costs nothing.
 */
export interface Visual {
  id: string;
  sessionId: string;
  /** the answer it belongs to (the latest one in the scope) */
  cardId: string;
  scope: VisualScope;
  scopeKey: string;
  sentences: import("./split").Sentence[];
  arrangement?: { status: JobStatus; data?: import("./arrange").Arrangement; error?: string };
  diagrams: Partial<Record<import("./diagrams").DiagramType, { status: JobStatus; spec?: import("./diagrams").AnyDiagram; error?: string }>>;
  sketch?: { status: JobStatus; svg?: string; error?: string };
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type QuickVerdict = "ok" | "unsure" | "wrong";

/** One question and short answer in a quick side thread. */
export interface QuickTurn {
  question: string;
  answer: string;
  status: JobStatus;
  error?: string;
  model: string;
  usage?: Usage;
  /** a second model's verdict on the answer */
  check?: { status: JobStatus; verdict?: QuickVerdict; reason?: string; model: string; error?: string };
}

/**
 * A quick side thread about highlighted words. It's shown under the answer and never replayed, so the
 * branch history stays append-only; "Make it a branch" turns it into real questions and answers.
 */
export interface Quick {
  id: string;
  sessionId: string;
  /** the answer it hangs under (the latest one the highlights come from) */
  cardId: string;
  highlightIds: string[];
  quotes: string[];
  quoteFrom?: QuoteFrom[];
  turns: QuickTurn[];
  createdAt: number;
}

export type ClaimVerdict = "supported" | "uncertain" | "disputed";
export interface Claim {
  claim: string;
  /** the words it comes from */
  quote: string;
  verdict: ClaimVerdict;
  reason: string;
}

/** Highlighted text split into claims, each judged by a second model. */
export interface ClaimCheck {
  id: string;
  sessionId: string;
  cardId: string;
  highlightIds: string[];
  quotes: string[];
  status: JobStatus;
  error?: string;
  claims: Claim[];
  model: string;
  web: boolean;
  usage?: Usage;
  createdAt: number;
}

export interface Bookmark {
  id: string;
  sessionId: string;
  cardId: string;
  /** a single point on the map; absent = the whole question/answer */
  nodeId?: string;
  label: string;
  createdAt: number;
}

export type MediaKind = "audio" | "image" | "video";

export interface MediaRecord {
  id: string;
  sessionId: string;
  storyId?: string;
  kind: MediaKind;
  mime: string;
  size: number;
  label: string;
  blob: Blob;
  createdAt: number;
}

export interface PromptToggles {
  premises: boolean;
  pushback: boolean;
}
