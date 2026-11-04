// Simple hand-drawn line icons (16×16), stroke = currentColor.
const P = {
  grid: "M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z",
  plus: "M8 3v10M3 8h10",
  lines: "M3 5h10M3 8h10M3 11h7",
  star: "M8 2.5l1.7 3.5 3.8.5-2.8 2.6.7 3.8L8 11.1l-3.4 1.8.7-3.8-2.8-2.6 3.8-.5z",
  bubble: "M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z",
  updown: "M8 2.5l3 3.5H5zM8 13.5l-3-3.5h6z",
  reply: "M6.5 4L3 7.5 6.5 11M3.5 7.5h6a3.5 3.5 0 013.5 3.5v1",
  person: "M8 8a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM3 13.5c.6-2.4 2.6-3.7 5-3.7s4.4 1.3 5 3.7",
  sync: "M13 6.5A5 5 0 004 4.6L3 5.8M3 2.8v3h3M3 9.5a5 5 0 009 1.9l1-1.2M13 13.2v-3h-3",
  sparkle: "M6 2l1.2 3.3L10.5 6.5 7.2 7.7 6 11 4.8 7.7 1.5 6.5l3.3-1.2zM11.5 9.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z",
  chat2: "M2.5 3h8v5.5h-4L4 10.5V8.5H2.5zM10.5 6h3v5.5H12v1.8l-2.2-1.8H6.5V10",
  shield: "M8 2l5 2v4c0 3-2.2 5.2-5 6-2.8-.8-5-3-5-6V4z",
  search: "M7 12a5 5 0 100-10 5 5 0 000 10zM10.6 10.6L14 14",
  check: "M3.2 8.2l3.2 3.2 6.4-6.8",
  up: "M8.5 4l5 7h-10z",
  down: "M8.5 13l-5-7h10z",
  doc: "M4 2h5.5L12 4.5V14H4zM9.5 2v2.5H12",
  sun: "M8 10.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1",
  moon: "M13 9.5A5.5 5.5 0 016.5 3 5.5 5.5 0 1013 9.5z",
  monitor: "M2 3h12v8H2zM6 14h4M8 11v3",
  out: "M6 3H3v10h3M10 5l3 3-3 3M13 8H6",
  eye: "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 100-4 2 2 0 000 4z",
};

export type IconName = keyof typeof P;

export function Icon({ name, size, className, filled }: { name: IconName; size?: number; className?: string; filled?: boolean }) {
  const vb = name === "up" || name === "down" ? "0 0 17 17" : "0 0 16 16";
  return (
    <svg viewBox={vb} aria-hidden="true" className={className} width={size} height={size}>
      <path d={P[name]} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Mark: a speech bubble holding two lines, the note you wrote and the reply you got.
const BUBBLE = "M7 3h10a5 5 0 0 1 5 5v5a5 5 0 0 1-5 5h-6l-5 4v-4.3A5 5 0 0 1 2 13V8a5 5 0 0 1 5-5z";
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d={BUBBLE} fill="currentColor" />
      <path d="M7 8.5h10" stroke="var(--bg)" strokeWidth="2" strokeLinecap="round" />
      <path d="M7 12.5h5" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <a className="brand" href={href}>
      <BrandMark />
      Changelark
    </a>
  );
}

// App icon: coloured rounded square with a white ring (or initial).
export function AppMark({ color = "#007AFF", className = "app-mark", letter }: { color?: string; className?: string; letter?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill={color} />
      {letter ? (
        <text x="16" y="21" textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff" fontFamily="system-ui">{letter}</text>
      ) : (
        <circle cx="16" cy="16" r="7" fill="none" stroke="#fff" strokeWidth="2.4" />
      )}
    </svg>
  );
}

// Public app icon: the app's colour with a white ring, as a data URL.
export function appIconUrl(color = "#007AFF") {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><rect width="72" height="72" fill="${color}"/><circle cx="36" cy="36" r="15" fill="none" stroke="#fff" stroke-width="6"/></svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}
