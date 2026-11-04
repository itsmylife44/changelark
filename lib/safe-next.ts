// Where a `next` query value may send someone: only a path on this site, else "/".
// Browsers read "/\" as "//", so backslashes, control characters and whitespace are refused outright,
// then the URL parser has the last word: the origin must not change.
export function safeNext(next: string | null): string {
  if (!next || !/^\/(?![/\\])/.test(next) || /[\\\x00-\x1f\x7f]/.test(next)) return "/";
  const base = "http://same.site";
  const url = new URL(next, base);
  return url.origin === base ? url.pathname + url.search + url.hash : "/";
}
