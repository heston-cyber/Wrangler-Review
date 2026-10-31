// Phase 3b (D77): the custom pricing formula in Settings › Pricing. Spreadsheet-style, using the names of the
// business's own rates and quantities ("Shooting rate × shoot hours + Editing rate × edit hours − Multi-day shoot").
// It is parsed and worked out here, never run as code: numbers, the names below, + − × ÷ (or + - * /) and brackets.
// Rates and discounts are in dollars; quantities are counts. The result is a price in cents.

export type Names = Map<string, number>; // lower-case name → value

type Tok = { t: "num"; v: number } | { t: "name"; v: string } | { t: "op"; v: "+" | "-" | "*" | "/" | "(" | ")" };

const OPS: Record<string, Tok["v"]> = { "+": "+", "-": "-", "−": "-", "–": "-", "*": "*", "×": "*", "x": "*", "/": "/", "÷": "/", "(": "(", ")": ")" };

/** Splits the formula into tokens, matching the longest known name at each point (names can have spaces). */
export function tokenize(src: string, names: string[]): Tok[] | string {
  const sorted = [...names].sort((a, b) => b.length - a.length);
  const s = src.toLowerCase().replace(/\s+/g, " ");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " ") { i++; continue; }
    const num = /^(\d+(?:\.\d+)?|\.\d+)%?/.exec(s.slice(i).replace(/^\$/, ""));
    if (c === "$" || /[\d.]/.test(c)) {
      if (!num) return `I don't understand "${s.slice(i, i + 12)}".`;
      const raw = num[0];
      out.push({ t: "num", v: raw.endsWith("%") ? Number(raw.slice(0, -1)) / 100 : Number(raw) });
      i += raw.length + (c === "$" ? 1 : 0);
      continue;
    }
    const name = sorted.find((n) => s.startsWith(n, i) && !/[a-z0-9]/.test(s[i + n.length] ?? ""));
    if (name) { out.push({ t: "name", v: name }); i += name.length; continue; }
    // "x" is multiply only between two things (so names with an x in them still match first).
    if (c in OPS) { out.push({ t: "op", v: OPS[c] as Tok["v"] } as Tok); i++; continue; }
    const word = /^[a-z][a-z0-9 -]*?(?=$|[+\-−–*×/÷()]|\s[+\-−–*×/÷])/.exec(s.slice(i))?.[0]?.trim() ?? s.slice(i, i + 12);
    return `"${word}" isn't one of your names.`;
  }
  return out;
}

/** Works out a formula. Returns dollars, or a sentence saying what's wrong. */
export function evaluate(src: string, names: Names): number | string {
  if (!src.trim()) return "The formula is empty.";
  if (src.length > 1000) return "The formula is too long.";
  const got = tokenize(src, [...names.keys()]);
  if (typeof got === "string") return got;
  const toks: Tok[] = got;
  let i = 0;
  const peek = () => toks[i];
  function expr(): number | string {
    let a = term(); if (typeof a === "string") return a;
    while (peek()?.t === "op" && (peek()!.v === "+" || peek()!.v === "-")) {
      const op = toks[i++].v; const b = term(); if (typeof b === "string") return b;
      a = op === "+" ? a + b : a - b;
    }
    return a;
  }
  function term(): number | string {
    let a = factor(); if (typeof a === "string") return a;
    while (peek()?.t === "op" && (peek()!.v === "*" || peek()!.v === "/")) {
      const op = toks[i++].v; const b = factor(); if (typeof b === "string") return b;
      if (op === "/" && b === 0) return "The formula divides by zero.";
      a = op === "*" ? a * b : a / b;
    }
    return a;
  }
  function factor(): number | string {
    const t = toks[i++];
    if (!t) return "The formula ends too early.";
    if (t.t === "num") return t.v;
    if (t.t === "name") return names.get(t.v) ?? 0;
    if (t.v === "-") { const v = factor(); return typeof v === "string" ? v : -v; }
    if (t.v === "(") { const v = expr(); if (typeof v === "string") return v; if (toks[i++]?.v !== ")") return "A bracket isn't closed."; return v; }
    return `"${t.v}" is in the wrong place.`;
  }
  const v = expr();
  if (typeof v === "string") return v;
  if (i < toks.length) return `"${toks[i].v}" is in the wrong place.`;
  if (!Number.isFinite(v)) return "The formula doesn't give a number.";
  return v;
}
