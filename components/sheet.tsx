"use client";
// The in-app "What's new" design, shared by the dashboard preview and the Preview tab's phone. It mirrors the
// Swift and React Native packages: a half-height sheet with the notes, two big reactions, a Got it button,
// and feedback as a thread with replies indented under what they answer.

export interface SheetRelease { version: string; date: string; notes: string; up: number; down: number; mine: number; comments: number }
export interface ChatMessage {
  id: string;
  author: string;
  text: string;
  mine?: boolean;
  dev?: boolean;
  removed?: string; // why it isn't shown, e.g. "Deleted by its author."
  replies?: ChatMessage[];
}

// "Intro\n\n- a\n- b" → an intro paragraph and a bullet list. Anything else stays a paragraph.
export function splitNotes(notes: string) {
  const lines = notes.split("\n").map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => /^[-•*]\s+/.test(l)).map((l) => l.replace(/^[-•*]\s+/, ""));
  const text = lines.filter((l) => !/^[-•*]\s+/.test(l));
  return { text, bullets };
}

const fmt = (d: string) => new Date(d + (d.length === 10 ? "T12:00:00Z" : "")).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function SheetBody({ release, badge, onReact, onFeedback, onBug, onClose }: {
  release: SheetRelease;
  badge?: string | null;
  onReact?: (dir: 1 | -1) => void;
  onFeedback?: () => void;
  onBug?: () => void;
  onClose?: () => void;
}) {
  const { text, bullets } = splitNotes(release.notes);
  return (
    <div className="as-body">
      <div className="as-grabber" aria-hidden="true" />
      <div className="as-title">
        <h2>New in {release.version}</h2>
        <span className="as-date">{badge ? <b>{badge}</b> : null}{fmt(release.date)}</span>
      </div>
      {text.map((t, i) => <p key={i} className="as-text">{t}</p>)}
      {bullets.length > 0 && <ul className="as-list">{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>}
      <div className="as-react" role="group" aria-label="Your reaction">
        <button type="button" aria-pressed={release.mine === 1} onClick={() => onReact?.(1)}><span aria-hidden="true">👍</span> Love it <em>{release.up}</em></button>
        <button type="button" aria-pressed={release.mine === -1} onClick={() => onReact?.(-1)}><span aria-hidden="true">👎</span> Not for me <em>{release.down}</em></button>
      </div>
      <button type="button" className="as-feedback" onClick={onFeedback}>
        <span>Leave feedback</span><em>{release.comments}</em><span aria-hidden="true">›</span>
      </button>
      <button type="button" className="as-primary" onClick={onClose}>Got it</button>
      {onBug && <button type="button" className="as-bug" onClick={onBug}><span aria-hidden="true">🐞</span> Report a bug</button>}
    </div>
  );
}

// Oldest first; each reply sits under its comment, behind a thread line.
export function ChatThread({ messages, actions }: {
  messages: ChatMessage[];
  actions?: (m: ChatMessage) => React.ReactNode;
}) {
  if (!messages.length) return <p className="as-empty">No feedback yet. Say what you think.</p>;
  const row = (m: ChatMessage) => (
    <div className={"as-msg" + (m.dev ? " is-dev" : "")}>
      <span className="as-who">{m.mine ? "You" : m.author}{m.dev && <b>Developer</b>}</span>
      <p className={m.removed ? "as-removed" : undefined}>{m.removed || m.text}</p>
      {!m.removed && actions?.(m)}
    </div>
  );
  return (
    <ol className="as-chat">
      {messages.map((m) => (
        <li key={m.id}>
          {row(m)}
          {m.replies?.length ? <ol className="as-replies">{m.replies.map((r) => <li key={r.id}>{row(r)}</li>)}</ol> : null}
        </li>
      ))}
    </ol>
  );
}
