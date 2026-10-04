import { createParser } from "eventsource-parser";
import type { ModelInfo, ReasoningDetail, Usage } from "./types";
import type { ChatMessage } from "./tree";
import { familyOf } from "./modelRules";

export const API = "https://openrouter.ai/api/v1";

export class OpenRouterError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// ── Stream accumulation (pure, unit-tested) ─────────────────────────────────

export interface StreamState {
  id?: string;
  model?: string;
  content: string;
  reasoning: string;
  reasoningDetails: ReasoningDetail[];
  finishReason: string | null;
  usage?: Usage & { completion_tokens: number; reasoning_tokens: number };
  error?: string;
  done: boolean;
}

export const emptyStream = (): StreamState => ({
  content: "",
  reasoning: "",
  reasoningDetails: [],
  finishReason: null,
  done: false,
});

/** Merge a streamed reasoning_details chunk: pieces of one block (same type/index/id) are concatenated in order,
 *  so the stored array has the same shape a non-streaming response would carry. */
function mergeDetail(list: ReasoningDetail[], d: ReasoningDetail) {
  const last = list[list.length - 1];
  const same = last && last.type === d.type && last.index === d.index && (last.id ?? null) === (d.id ?? null);
  if (!same) {
    list.push({ ...d });
    return;
  }
  if (d.text) last.text = (last.text ?? "") + d.text;
  if (d.summary) last.summary = (last.summary ?? "") + d.summary;
  if (d.data) last.data = d.data;
  if (d.signature) last.signature = d.signature;
}

/** Feed one SSE `data:` payload. Keeps reading after the first finish_reason: OpenRouter repeats it on a
 *  trailing usage chunk. Returns the same (mutated) state. */
export function applyChunk(state: StreamState, data: string): StreamState {
  if (data.trim() === "[DONE]") {
    state.done = true;
    return state;
  }
  let json: any;
  try {
    json = JSON.parse(data);
  } catch {
    return state; // ignore non-JSON keep-alives
  }
  if (json.id) state.id = json.id;
  if (json.model) state.model = json.model;
  if (json.error) {
    state.error = json.error.message ?? String(json.error);
    return state;
  }
  const choice = json.choices?.[0];
  if (choice) {
    const delta = choice.delta ?? {};
    if (typeof delta.content === "string") state.content += delta.content;
    if (typeof delta.reasoning === "string") state.reasoning += delta.reasoning;
    else if (typeof delta.reasoning_content === "string") state.reasoning += delta.reasoning_content;
    if (Array.isArray(delta.reasoning_details)) for (const d of delta.reasoning_details) mergeDetail(state.reasoningDetails, d);
    if (choice.finish_reason) {
      state.finishReason = choice.finish_reason;
      if (choice.finish_reason === "error") state.error ||= choice.error?.message ?? "The provider failed mid-response.";
    }
  }
  if (json.usage) {
    const u = json.usage;
    const reasoning = u.completion_tokens_details?.reasoning_tokens ?? 0;
    state.usage = {
      prompt: u.prompt_tokens ?? 0,
      completion: u.completion_tokens ?? 0,
      reasoning,
      cost: typeof u.cost === "number" ? u.cost : undefined,
      completion_tokens: u.completion_tokens ?? 0,
      reasoning_tokens: reasoning,
    };
  }
  return state;
}

// ── Requests ─────────────────────────────────────────────────────────────────

/** Anthropic models get cache_control on the system prompt so sibling branches share a cached prefix. */
export function prepareMessages(model: string, messages: ChatMessage[]): unknown[] {
  if (familyOf(model) !== "claude") return messages;
  return messages.map((m, i) =>
    i === 0 && m.role === "system" && m.content
      ? { ...m, content: [{ type: "text", text: m.content, cache_control: { type: "ephemeral" } }] }
      : m,
  );
}

function headers(apiKey?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json", "X-Title": "Fractal" };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

async function failure(res: Response): Promise<OpenRouterError> {
  let msg = `${res.status} ${res.statusText}`;
  try {
    const j = await res.json();
    msg = j.error?.message ?? msg;
  } catch {
    /* keep default */
  }
  return new OpenRouterError(msg, res.status);
}

export async function listModels(output: "text" | "embeddings" = "text"): Promise<ModelInfo[]> {
  const url = output === "text" ? `${API}/models` : `${API}/models?output_modalities=${output}`;
  const res = await fetch(url);
  if (!res.ok) throw await failure(res);
  const j = await res.json();
  return (j.data ?? []) as ModelInfo[];
}

export async function streamChat(opts: {
  apiKey: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  onUpdate: (s: StreamState) => void;
}): Promise<StreamState> {
  const res = await fetch(`${API}/chat/completions`, {
    method: "POST",
    headers: headers(opts.apiKey),
    body: JSON.stringify({ ...opts.body, stream: true, usage: { include: true } }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) throw await failure(res);
  const state = emptyStream();
  const parser = createParser({
    onEvent: (e) => {
      applyChunk(state, e.data);
      opts.onUpdate(state);
    },
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.feed(dec.decode(value, { stream: true }));
    if (state.done) break;
  }
  if (state.error && !state.content) throw new OpenRouterError(state.error, 502);
  return state;
}

export function parseJSONLoose(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error("The model did not return valid JSON.");
  }
}

/** One non-streaming call that returns parsed JSON (tags, rerank, synthesis). */
export async function completeJSON<T>(opts: {
  apiKey: string;
  model: ModelInfo;
  messages: ChatMessage[];
  schemaName: string;
  schema: object;
  extra?: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<{ data: T; usage?: Usage }> {
  const structured = opts.model.supported_parameters?.includes("structured_outputs");
  const body: Record<string, unknown> = {
    model: opts.model.id,
    messages: prepareMessages(opts.model.id, opts.messages),
    ...opts.extra,
  };
  if (structured) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: opts.schemaName, strict: true, schema: opts.schema },
    };
  }
  const res = await fetch(`${API}/chat/completions`, {
    method: "POST",
    headers: headers(opts.apiKey),
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) throw await failure(res);
  const j = await res.json();
  const text: string = j.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("The model returned an empty reply (reasoning may have used the whole token budget).");
  const u = j.usage;
  return {
    data: parseJSONLoose(text) as T,
    usage: u
      ? {
          prompt: u.prompt_tokens ?? 0,
          completion: u.completion_tokens ?? 0,
          reasoning: u.completion_tokens_details?.reasoning_tokens ?? 0,
          cost: u.cost,
        }
      : undefined,
  };
}

export async function completeText(opts: {
  apiKey: string;
  model: ModelInfo;
  messages: ChatMessage[];
  extra?: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<string> {
  const res = await fetch(`${API}/chat/completions`, {
    method: "POST",
    headers: headers(opts.apiKey),
    body: JSON.stringify({ model: opts.model.id, messages: prepareMessages(opts.model.id, opts.messages), ...opts.extra }),
    signal: opts.signal,
  });
  if (!res.ok) throw await failure(res);
  const j = await res.json();
  return j.choices?.[0]?.message?.content ?? "";
}

export async function embed(apiKey: string, model: string, input: string[]): Promise<number[][]> {
  const res = await fetch(`${API}/embeddings`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ model, input }),
  });
  if (!res.ok) throw await failure(res);
  const j = await res.json();
  return (j.data as { embedding: number[]; index: number }[])
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

// ── Sign-in (OAuth PKCE) ─────────────────────────────────────────────────────

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export function makeVerifier(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function challengeS256(verifier: string): Promise<string> {
  return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}

export function authUrl(callbackUrl: string, challenge: string): string {
  const u = new URL("https://openrouter.ai/auth");
  u.searchParams.set("callback_url", callbackUrl);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

export async function exchangeCode(code: string, verifier: string): Promise<string> {
  const res = await fetch(`${API}/auth/keys`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
  });
  if (!res.ok) throw await failure(res);
  return (await res.json()).key as string;
}
