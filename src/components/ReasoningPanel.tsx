import { reasoningParts } from "../reasoning";
import type { AssistantMessage } from "../types";

export function ReasoningPanel({ assistant, live }: { assistant?: AssistantMessage; live?: string }) {
  const parts = reasoningParts(assistant);
  const text = live ?? parts.text;
  if (!text && !parts.encrypted) return null;
  return (
    <details className="reasoning">
      <summary>Show reasoning</summary>
      {text && <p className="reasoning-text">{text}</p>}
      {parts.encrypted > 0 && <p className="muted small">🔒 {parts.encrypted} private reasoning block{parts.encrypted > 1 ? "s" : ""} (not readable)</p>}
    </details>
  );
}
