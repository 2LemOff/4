import { describe, expect, it } from "vitest";
import { applyChunk, authUrl, challengeS256, emptyStream, parseJSONLoose, prepareMessages } from "../src/openrouter";

const feed = (events: unknown[]) => {
  const s = emptyStream();
  for (const e of events) applyChunk(s, typeof e === "string" ? e : JSON.stringify(e));
  return s;
};
const delta = (d: object, finish: string | null = null) => ({ choices: [{ delta: d, finish_reason: finish }] });

describe("applyChunk", () => {
  it("accumulates content and reasoning", () => {
    const s = feed([delta({ reasoning: "Hm " }), delta({ reasoning: "ok" }), delta({ content: "Hel" }), delta({ content: "lo" }, "stop"), "[DONE]"]);
    expect(s.content).toBe("Hello");
    expect(s.reasoning).toBe("Hm ok");
    expect(s.finishReason).toBe("stop");
    expect(s.done).toBe(true);
  });
  it("joins reasoning_details pieces of one block and keeps the signature", () => {
    const s = feed([
      delta({ reasoning_details: [{ type: "reasoning.text", text: "A", index: 0, id: "r1", format: "anthropic-claude-v1" }] }),
      delta({ reasoning_details: [{ type: "reasoning.text", text: "B", index: 0, id: "r1", format: "anthropic-claude-v1" }] }),
      delta({ reasoning_details: [{ type: "reasoning.text", text: "", signature: "SIG", index: 0, id: "r1", format: "anthropic-claude-v1" }] }),
      delta({ reasoning_details: [{ type: "reasoning.encrypted", data: "ENC", index: 1, format: "anthropic-claude-v1" }] }),
    ]);
    expect(s.reasoningDetails).toHaveLength(2);
    expect(s.reasoningDetails[0]).toMatchObject({ text: "AB", signature: "SIG", index: 0 });
    expect(s.reasoningDetails[1]).toMatchObject({ type: "reasoning.encrypted", data: "ENC" });
  });
  it("keeps reading past the first finish_reason to get the usage chunk", () => {
    const s = feed([
      delta({ content: "x" }, "stop"),
      { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.002, completion_tokens_details: { reasoning_tokens: 30 } } },
      "[DONE]",
    ]);
    expect(s.finishReason).toBe("stop");
    expect(s.usage).toMatchObject({ prompt: 100, completion: 50, reasoning: 30, cost: 0.002, completion_tokens: 50, reasoning_tokens: 30 });
  });
  it("records a mid-stream error object", () => {
    const s = feed([delta({ content: "partial" }), { error: { message: "Provider disconnected", code: 502 } }]);
    expect(s.error).toBe("Provider disconnected");
    expect(s.content).toBe("partial");
  });
  it("flags finish_reason error", () => {
    expect(feed([delta({ content: "p" }, "error")]).error).toBeTruthy();
  });
  it("ignores non-JSON payloads", () => {
    expect(feed(["not json", delta({ content: "ok" })]).content).toBe("ok");
  });
});

describe("prepareMessages", () => {
  it("adds cache_control to the system prompt for Claude only", () => {
    const msgs = [{ role: "system" as const, content: "SYS" }, { role: "user" as const, content: "hi" }];
    const claude = prepareMessages("anthropic/claude-opus-5", msgs) as any[];
    expect(claude[0].content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(prepareMessages("google/gemini-3.5-pro", msgs)).toBe(msgs);
  });
  it("leaves empty config-update system messages alone", () => {
    const cfg = { role: "system" as const, content: "", configuration_update: { reasoning: { effort: "low" } } };
    const out = prepareMessages("anthropic/claude-opus-5", [{ role: "system", content: "S" }, cfg]) as any[];
    expect(out[1]).toBe(cfg);
  });
});

describe("helpers", () => {
  it("parses JSON from fenced or chatty replies", () => {
    expect(parseJSONLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJSONLoose('Sure! {"a":2} hope that helps')).toEqual({ a: 2 });
    expect(() => parseJSONLoose("nope")).toThrow();
  });
  it("matches the RFC 7636 PKCE example", async () => {
    expect(await challengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  it("builds the auth url", () => {
    const u = new URL(authUrl("https://x.test/app/", "CH"));
    expect(u.origin + u.pathname).toBe("https://openrouter.ai/auth");
    expect(u.searchParams.get("callback_url")).toBe("https://x.test/app/");
    expect(u.searchParams.get("code_challenge")).toBe("CH");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  });
});
