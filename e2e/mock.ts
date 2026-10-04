import type { Page, Route } from "@playwright/test";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

export const MODELS = [
  {
    id: "google/gemini-3.5-pro", name: "Gemini 3.5 Pro", created: 400, context_length: 1_000_000,
    pricing: { prompt: "0.000002", completion: "0.000012" },
    supported_parameters: ["max_tokens", "temperature", "top_p", "seed", "reasoning", "structured_outputs"],
    reasoning: { supported_efforts: ["high", "medium", "low", "minimal"], default_effort: "medium", default_enabled: true, mandatory: true, supports_max_tokens: true },
  },
  {
    id: "google/gemini-3.6-flash", name: "Gemini 3.6 Flash", created: 410, context_length: 1_000_000,
    pricing: { prompt: "0.0000003", completion: "0.0000025" },
    supported_parameters: ["max_tokens", "temperature", "reasoning", "structured_outputs"],
    reasoning: { supported_efforts: ["high", "medium", "low", "minimal"], default_effort: "low", default_enabled: true, mandatory: true, supports_max_tokens: true },
  },
  {
    id: "anthropic/claude-sonnet-5.5", name: "Claude Sonnet 5.5", created: 300, context_length: 1_000_000,
    pricing: { prompt: "0.000002", completion: "0.00001" },
    supported_parameters: ["max_tokens", "reasoning", "structured_outputs"],
    reasoning: { supported_efforts: ["max", "xhigh", "high", "medium", "low", "minimal"], default_effort: "medium", default_enabled: true, supports_max_tokens: true },
  },
  {
    id: "anthropic/claude-opus-5.5", name: "Claude Opus 5.5", created: 310, context_length: 1_000_000,
    pricing: { prompt: "0.000004", completion: "0.00002" },
    supported_parameters: ["max_tokens", "temperature", "reasoning", "structured_outputs"],
    reasoning: { supported_efforts: ["max", "xhigh", "high", "medium", "low", "minimal"], default_effort: "medium", default_enabled: true, supports_max_tokens: true },
  },
  {
    id: "x-ai/grok-4.5", name: "Grok 4.5", created: 350, context_length: 256_000,
    pricing: { prompt: "0.000003", completion: "0.000015" },
    supported_parameters: ["max_tokens", "temperature", "top_p", "reasoning"],
    reasoning: { supported_efforts: ["high", "low"], default_effort: "low", default_enabled: false },
  },
  {
    id: "openai/gpt-5.6-sol", name: "GPT-5.6 Sol", created: 380, context_length: 400_000,
    pricing: { prompt: "0.0000025", completion: "0.000015" },
    supported_parameters: ["max_tokens", "reasoning", "verbosity", "seed"],
    reasoning: { supported_efforts: ["xhigh", "high", "medium", "low", "none"], default_effort: "medium", default_enabled: true },
  },
];
const EMBED_MODELS = [{ id: "openai/text-embedding-3-small", created: 1, architecture: { output_modalities: ["embeddings"] } }];

/** Deterministic character-trigram embedding so "observers" lands near "observer". */
export function fakeEmbed(text: string): number[] {
  const v = new Array(64).fill(0);
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9 ]/g, "")} `;
  for (let i = 0; i < t.length - 2; i++) {
    let h = 0;
    for (const ch of t.slice(i, i + 3)) h = (h * 31 + ch.charCodeAt(0)) % 64;
    v[h] += 1;
  }
  return v;
}

export interface MockOptions {
  /** answer text per question substring */
  answer?: (question: string, body: any) => string;
  /** override finish_reason / usage on streamed answers */
  stream?: (body: any) => { finish?: string; usage?: any; reasoning?: boolean };
}

export interface Calls {
  chat: any[];
  stream: any[];
  json: any[];
  embeddings: any[];
}

const ANSWER = "Premise one is simple.\n\nPremise two depends on it. It has a second sentence about observers.\n\nPremise three concludes.";

export async function mockOpenRouter(page: Page, opts: MockOptions = {}): Promise<Calls> {
  const calls: Calls = { chat: [], stream: [], json: [], embeddings: [] };
  let n = 0;
  await page.route(/https:\/\/openrouter\.ai\/api\/v1\/.*/, async (route: Route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const json = (data: unknown) => route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(data) });

    if (url.pathname.endsWith("/models")) {
      return json({ data: url.searchParams.get("output_modalities") === "embeddings" ? EMBED_MODELS : MODELS });
    }
    if (url.pathname.endsWith("/embeddings")) {
      const body = req.postDataJSON();
      calls.embeddings.push(body);
      return json({ data: body.input.map((t: string, index: number) => ({ index, embedding: fakeEmbed(t) })) });
    }
    if (url.pathname.endsWith("/chat/completions")) {
      const body = req.postDataJSON();
      calls.chat.push(body);
      const sysText = (m: any) => (typeof m.content === "string" ? m.content : (m.content ?? []).map((p: any) => p.text).join(""));
      const msgs: any[] = body.messages ?? [];
      const system = msgs.find((m) => m.role === "system" && sysText(m))?.content;
      const systemText = system ? (typeof system === "string" ? system : system.map((p: any) => p.text).join("")) : "";
      const lastUser = [...msgs].reverse().find((m) => m.role === "user");
      const userText = lastUser ? sysText(lastUser) : "";

      if (body.stream) {
        calls.stream.push(body);
        const o = opts.stream?.(body) ?? {};
        const text = opts.answer ? opts.answer(userText, body) : ANSWER;
        const chunks: unknown[] = [];
        if (o.reasoning !== false) {
          chunks.push({ choices: [{ delta: { reasoning: "Let me think. ", reasoning_details: [{ type: "reasoning.text", text: "Let me think. ", index: 0, id: "r1", format: "google-gemini-v1" }] } }] });
          chunks.push({ choices: [{ delta: { reasoning_details: [{ type: "reasoning.text", text: "", signature: "SIG123", index: 0, id: "r1", format: "google-gemini-v1" }] } }] });
        }
        for (let i = 0; i < text.length; i += 24) chunks.push({ id: `gen-${++n}`, choices: [{ delta: { content: text.slice(i, i + 24) } }] });
        chunks.push({ choices: [{ delta: {}, finish_reason: o.finish ?? "stop" }] });
        chunks.push({ choices: [{ delta: {}, finish_reason: o.finish ?? "stop" }], usage: o.usage ?? { prompt_tokens: 120, completion_tokens: 60, cost: 0.0012, completion_tokens_details: { reasoning_tokens: 20 } } });
        const body2 = ": OPENROUTER PROCESSING\n\n" + chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
        return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "text/event-stream" }, body: body2 });
      }

      calls.json.push(body);
      const reply = (content: string) => json({ choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
      if (systemText.includes("topic tag")) return reply(JSON.stringify({ tag: `Tag ${calls.json.filter((b) => (b.messages?.[0]?.content ?? "").toString().includes("topic tag")).length}` }));
      if (userText.includes("Candidates:")) {
        const ids = [...userText.matchAll(/^\[(\w+)\]/gm)].map((m) => m[1]);
        return reply(JSON.stringify({ results: ids.slice(0, 2).map((id) => ({ id, why: "mentions observers" })) }));
      }
      if (systemText.includes("Summarize the conversation")) return reply("We established that premise one is simple and premise two depends on it.");
      if (systemText.includes("Respond with JSON only, matching: { title")) {
        const ids = [...userText.matchAll(/\[(\w{8})\]/g)].map((m) => m[1]);
        return reply(JSON.stringify({
          title: "Observers and premises",
          category: "Physics",
          summary: "A short summary of the session.",
          sections: [{ heading: "Core ideas", points: [{ text: "Premise two depends on premise one.", cardIds: ids.slice(0, 1) }, { text: "A made-up card link.", cardIds: ["nope0000"] }] }],
        }));
      }
      return reply("{}");
    }
    return route.fulfill({ status: 404, headers: CORS, body: "{}" });
  });
  return calls;
}
