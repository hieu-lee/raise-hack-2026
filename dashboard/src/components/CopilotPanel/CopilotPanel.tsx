import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, Sparkles, X } from "lucide-react";
import type { DriftIssue } from "../../types/report";
import "./CopilotPanel.css";

export interface CopilotMessage {
  role: "user" | "assistant";
  content: string;
}

export function FloatingCopilot({
  apiBaseUrl,
  runId,
  issue,
  issueLabel,
  mutationToken,
  enabled = true
}: {
  apiBaseUrl: string;
  runId: string;
  issue?: DriftIssue;
  issueLabel?: string;
  mutationToken?: string;
  enabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<CopilotMessage[]>([
    {
      role: "assistant",
      content: "Ask about drift, token fixes, or PR drafts for this scan."
    }
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, open]);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || busy) {
      return;
    }

    const nextHistory = [...messages, { role: "user" as const, content: message }];
    setMessages(nextHistory);
    setInput("");
    setBusy(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/runs/${runId}/copilot`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-DriftRadar-Client": "dashboard",
          ...(mutationToken ? { "X-DriftRadar-Token": mutationToken } : {})
        },
        body: JSON.stringify({
          message,
          issueId: issue?.id,
          history: messages.slice(-8)
        })
      });
      const payload = (await response.json()) as { reply?: string; error?: string };
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: payload.reply ?? payload.error ?? "Copilot did not return a reply."
        }
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: error instanceof Error ? error.message : "Copilot request failed."
        }
      ]);
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return null;
  }

  return (
    <div className={`floating-copilot${open ? " floating-copilot--open" : ""}`}>
      {open ? (
        <section className="floating-copilot__panel" aria-label="Drift copilot">
          <header className="floating-copilot__header">
            <div className="floating-copilot__title">
              <Sparkles size={16} aria-hidden />
              <span>Copilot</span>
            </div>
            <button
              type="button"
              className="floating-copilot__icon-btn"
              aria-label="Close copilot"
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </button>
          </header>
          {issue ? (
            <p className="floating-copilot__context" title={issue.id}>
              {issueLabel ?? issue.title}
            </p>
          ) : null}
          <div className="floating-copilot__messages" ref={scrollRef}>
            {messages.map((entry, index) => (
              <div
                key={`${entry.role}-${index}`}
                className={`floating-copilot__bubble floating-copilot__bubble--${entry.role}`}
              >
                {entry.content}
              </div>
            ))}
            {busy ? <p className="floating-copilot__thinking">…</p> : null}
          </div>
          <form className="floating-copilot__composer" onSubmit={sendMessage}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about this finding…"
              aria-label="Copilot message"
            />
            <button
              type="submit"
              className="floating-copilot__icon-btn floating-copilot__send"
              disabled={busy || !input.trim()}
              aria-label="Send message"
            >
              <Send size={16} />
            </button>
          </form>
        </section>
      ) : null}
      <button
        type="button"
        className="floating-copilot__launcher"
        aria-label={open ? "Close copilot" : "Open copilot"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
      </button>
    </div>
  );
}

// Backward-compatible export for existing tests/imports.
export const CopilotPanel = FloatingCopilot;
