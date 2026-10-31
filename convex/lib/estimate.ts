// Phase 3 (Oct 31): estimates from a business's rates (Settings › Estimate rates). Built from general pieces (Heston,
// Oct 29): kinds of work billed per hour or per day, subcontractor costs per kind (expenses and profit only, never
// added to the client's price), links that set one kind's hours from one base kind × a level (D53: one base each, no
// chains), day lengths (D55), a travel rule (D54) and the profit split. Wrangler's values are me-wrangler § 4.
// All money is in cents.

export type Kind = { id: string; name: string; unit: "hour" | "day"; clientCents: number };
export type Cost = { id: string; name: string; kindId: string; cents: number };
export type Level = { id: string; name: string; mult: number };
export type Link = { id: string; target: string; base: string; levels: Level[]; defaultLevel: string };
export type Rates = {
  kinds: Kind[]; costs: Cost[]; links: Link[];
  fullDayHours: number; halfDayHours: number;
  travel: { on: boolean; thresholdHours: number; kindId: string };
  reservePct: number;
};

/** me-wrangler § 4 (written by Heston, Oct 26). */
export const WRANGLER_RATES: Rates = {
  kinds: [
    { id: "shooting", name: "Shooting", unit: "hour", clientCents: 20000 },
    { id: "editing", name: "Editing", unit: "hour", clientCents: 20000 },
    { id: "travel", name: "Travel day", unit: "day", clientCents: 67500 },
  ],
  costs: [
    { id: "shooter", name: "Shooter", kindId: "shooting", cents: 12500 },
    { id: "editor", name: "Editor", kindId: "editing", cents: 9000 },
    { id: "travel", name: "Travel", kindId: "travel", cents: 50000 },
  ],
  links: [{
    id: "link1", target: "editing", base: "shooting", defaultLevel: "standard",
    levels: [
      { id: "simple", name: "Simple", mult: 1.5 }, { id: "standard", name: "Standard", mult: 2 },
      { id: "heavy", name: "Heavy", mult: 2.5 }, { id: "highend", name: "High-end, cinematic or graphics-heavy", mult: 3 },
    ],
  }],
  fullDayHours: 8, halfDayHours: 4,
  travel: { on: true, thresholdHours: 2, kindId: "travel" },
  reservePct: 25,
};

/** A business with no rates of its own starts empty (only Wrangler's are filled in; Heston, Oct 29). */
export const EMPTY_RATES: Rates = { kinds: [], costs: [], links: [], fullDayHours: 8, halfDayHours: 4, travel: { on: false, thresholdHours: 2, kindId: "" }, reservePct: 25 };

/** What's wrong with a set of rates (empty when they're usable). */
export function ratesProblems(r: Rates): string[] {
  const out: string[] = [];
  const ids = new Set(r.kinds.map((k) => k.id));
  if (new Set(r.kinds.map((k) => k.name.trim().toLowerCase())).size !== r.kinds.length) out.push("Two kinds of work have the same name.");
  for (const k of r.kinds) {
    if (!k.name.trim()) out.push("Every kind of work needs a name.");
    if (!Number.isInteger(k.clientCents) || k.clientCents < 0) out.push(`${k.name || "A kind of work"}: the client rate must be $0 or more.`);
  }
  for (const c of r.costs) {
    if (!ids.has(c.kindId)) out.push(`${c.name || "A cost"} is for a kind of work that's gone.`);
    if (!Number.isInteger(c.cents) || c.cents < 0) out.push(`${c.name || "A cost"}: the rate must be $0 or more.`);
  }
  const targets = new Set<string>();
  for (const l of r.links) {
    if (!ids.has(l.target) || !ids.has(l.base)) { out.push("A link uses a kind of work that's gone."); continue; }
    if (l.target === l.base) out.push("A link can't set a kind from itself.");
    if (targets.has(l.target)) out.push("A kind of work can be set by one link only."); // D53: one base kind each
    targets.add(l.target);
    if (!l.levels.length) out.push("A link needs at least one level.");
    if (!l.levels.some((x) => x.id === l.defaultLevel)) out.push("Pick a default level for each link.");
    for (const x of l.levels) if (!(x.mult > 0 && x.mult <= 20)) out.push(`${x.name || "A level"}: the multiplier must be between 0 and 20.`);
  }
  // D53: no chains (a linked kind can't be the base of another link).
  for (const l of r.links) if (targets.has(l.base)) out.push("A linked kind can't be the base of another link (no chains).");
  for (const l of r.links) if (r.kinds.find((k) => k.id === l.target)?.unit !== "hour" || r.kinds.find((k) => k.id === l.base)?.unit !== "hour") out.push("Links work on kinds billed per hour.");
  if (!(r.fullDayHours > 0 && r.fullDayHours <= 24) || !(r.halfDayHours > 0 && r.halfDayHours <= r.fullDayHours)) out.push("Check the day lengths.");
  if (r.travel.on && !(r.kinds.find((k) => k.id === r.travel.kindId)?.unit === "day")) out.push("The travel rule needs a kind of work billed per day.");
  if (r.travel.on && !(r.travel.thresholdHours >= 0)) out.push("Check the travel threshold.");
  if (!(r.reservePct >= 0 && r.reservePct <= 100)) out.push("The reserve must be between 0% and 100%.");
  return [...new Set(out)];
}

export type EstimateInput = {
  /** Hours of each base kind (not set by a link), e.g. { shooting: 32 }. Day kinds other than travel: days. */
  base: Record<string, number>;
  /** The level picked for each link (missing: its default). */
  levels?: Record<string, string>;
  /** Extra hours on a linked kind ("Extra editing hours"). */
  extra?: Record<string, number>;
  /** The project's travel is over the threshold. */
  travelOver?: boolean;
  travelDays?: number;
  travelWaived?: boolean;
};

export type Line = { kindId: string; name: string; unit: "hour" | "day"; qty: number; clientCents: number; costCents: number };
export type Estimate = {
  lines: Line[];          // every kind with a quantity
  priceCents: number;
  expenseCents: number;
  expenses: Array<{ kindId: string; name: string; cents: number }>;
  netCents: number; reserveCents: number; ownerCents: number;
  travelDays: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function estimate(r: Rates, input: EstimateInput): Estimate {
  const qty = new Map<string, number>();
  for (const k of r.kinds) qty.set(k.id, Math.max(0, Number(input.base[k.id] ?? 0) || 0));
  for (const l of r.links) {
    const level = l.levels.find((x) => x.id === (input.levels?.[l.id] ?? l.defaultLevel)) ?? l.levels.find((x) => x.id === l.defaultLevel);
    qty.set(l.target, round2((qty.get(l.base) ?? 0) * (level?.mult ?? 1) + Math.max(0, Number(input.extra?.[l.target] ?? 0) || 0)));
  }
  let travelDays = 0;
  if (r.travel.on && r.travel.kindId) {
    travelDays = input.travelOver && !input.travelWaived ? Math.max(0, Math.floor(Number(input.travelDays ?? 1) || 0)) : 0;
    qty.set(r.travel.kindId, travelDays);
  }
  const lines: Line[] = [];
  for (const k of r.kinds) {
    const q = qty.get(k.id) ?? 0;
    if (!q) continue;
    const costCents = r.costs.filter((c) => c.kindId === k.id).reduce((t, c) => t + Math.round(q * c.cents), 0);
    lines.push({ kindId: k.id, name: k.name, unit: k.unit, qty: q, clientCents: Math.round(q * k.clientCents), costCents });
  }
  const priceCents = lines.reduce((t, l) => t + l.clientCents, 0);
  const expenses = lines.map((l) => ({ kindId: l.kindId, name: l.name, cents: l.costCents }));
  const expenseCents = expenses.reduce((t, e) => t + e.cents, 0);
  const netCents = priceCents - expenseCents;
  const reserveCents = Math.round((netCents * r.reservePct) / 100);
  return { lines, priceCents, expenseCents, expenses, netCents, reserveCents, ownerCents: netCents - reserveCents, travelDays };
}

/** The base kind of the first link (Wrangler: Shooting): the one whose time the owner types in. */
export function primaryKind(r: Rates): Kind | null {
  const base = r.links[0]?.base;
  return r.kinds.find((k) => k.id === base) ?? r.kinds.find((k) => k.unit === "hour") ?? null;
}
