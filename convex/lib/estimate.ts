// Phase 3 (Oct 31): estimates from a business's rates (Settings › Estimate rates). Built from general pieces (Heston,
// Oct 29): kinds of work billed per hour or per day, subcontractor costs per kind (expenses and profit only, never
// added to the client's price), links that set one kind's hours from one base kind × a level (D53: one base each, no
// chains), day lengths (D55), a travel rule (D54) and the profit split. Wrangler's values are me-wrangler § 4.
// All money is in cents.
import { evaluate } from "./formula";

export type Kind = { id: string; name: string; unit: "hour" | "day"; clientCents: number };
export type Cost = { id: string; name: string; kindId: string; cents: number };
export type Level = { id: string; name: string; mult: number };
export type Link = { id: string; target: string; base: string; levels: Level[]; defaultLevel: string };
/** Phase 3b (D77): a discount, suggested when its condition is met (e.g. shoot days at least 3). "percent" comes off
 *  the subtotal; "amount" is a fixed number of cents. `qty` is a quantity key (see quantityNames). */
export type Discount = { id: string; name: string; kind: "percent" | "amount"; value: number; qty: string; min: number };
export type Rates = {
  kinds: Kind[]; costs: Cost[]; links: Link[];
  fullDayHours: number; halfDayHours: number;
  travel: { on: boolean; thresholdHours: number; kindId: string };
  reservePct: number;
  // Phase 3b · Settings › Pricing (D76, D77, D88). Optional so rates saved before Phase 3b still read.
  defaults?: { hourlyCents: number; dailyCents: number }; // for lines that aren't one of the kinds of work
  discounts?: Discount[];                                    // apply everywhere, estimates included (D88)
  formula?: { on: boolean; text: string };                   // quotes and proposals suggest this instead
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
  if (r.defaults && (!(r.defaults.hourlyCents >= 0) || !(r.defaults.dailyCents >= 0))) out.push("Default rates must be $0 or more.");
  const qty = new Set(quantityNames(r).map((x) => x.key));
  for (const d of r.discounts ?? []) {
    if (!d.name.trim()) out.push("Every discount needs a name.");
    if (d.kind === "percent" && !(d.value >= 0 && d.value <= 100)) out.push(`${d.name || "A discount"}: the percent must be between 0 and 100.`);
    if (d.kind === "amount" && !(Number.isInteger(d.value) && d.value >= 0)) out.push(`${d.name || "A discount"}: the amount must be $0 or more.`);
    if (!qty.has(d.qty)) out.push(`${d.name || "A discount"}: pick what it depends on.`);
    if (!(d.min >= 0)) out.push(`${d.name || "A discount"}: the condition must be 0 or more.`);
  }
  if (r.formula?.on) {
    const k = primaryKind(r);
    const v = k ? formulaPrice(r, estimate(r, { base: { [k.id]: 4 * r.fullDayHours } })) : "Add a kind of work billed per hour first.";
    if (typeof v === "string") out.push(`Custom formula: ${v}`);
  }
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
  subtotalCents?: number; // before discounts (Phase 3b)
  discounts?: Array<{ id: string; name: string; cents: number }>; // discounts whose condition is met (D88)
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
  const subtotalCents = lines.reduce((t, l) => t + l.clientCents, 0);
  // D88: discounts whose condition is met come off the price (and so off profit and the split).
  const q = quantities(r, qty);
  const discounts = (r.discounts ?? []).filter((d) => (q.get(d.qty) ?? 0) >= d.min && d.value > 0).map((d) => ({
    id: d.id, name: d.name, cents: d.kind === "percent" ? Math.round((subtotalCents * d.value) / 100) : Math.round(d.value),
  }));
  const priceCents = Math.max(0, subtotalCents - discounts.reduce((t, d) => t + d.cents, 0));
  const expenses = lines.map((l) => ({ kindId: l.kindId, name: l.name, cents: l.costCents }));
  const expenseCents = expenses.reduce((t, e) => t + e.cents, 0);
  const netCents = priceCents - expenseCents;
  const reserveCents = Math.round((netCents * r.reservePct) / 100);
  return { lines, ...(discounts.length ? { subtotalCents, discounts } : {}), priceCents, expenseCents, expenses, netCents, reserveCents, ownerCents: netCents - reserveCents, travelDays };
}

/** The base kind of the first link (Wrangler: Shooting): the one whose time the owner types in. */
export function primaryKind(r: Rates): Kind | null {
  const base = r.links[0]?.base;
  return r.kinds.find((k) => k.id === base) ?? r.kinds.find((k) => k.unit === "hour") ?? null;
}

// ---------- Phase 3b: quantities, discounts and the custom formula's names ----------

/** "Shooting" → "Shoot", "Editing" → "Edit": the short word people use ("shoot days", "edit hours"). */
const stem = (name: string) => { const n = name.trim(); return /ing$/i.test(n) && n.length > 5 ? n.slice(0, -3) : n; };

/** The quantities a discount can depend on and a formula can use: hours and days of each hour kind, days of each
 *  day kind. Keys are stable ids; names are what the owner reads and types. */
export function quantityNames(r: Rates): Array<{ key: string; name: string; aliases: string[] }> {
  const out: Array<{ key: string; name: string; aliases: string[] }> = [];
  for (const k of r.kinds) {
    if (k.unit === "hour") {
      out.push({ key: `${k.id}.days`, name: `${stem(k.name)} days`, aliases: [`${k.name} days`] });
      out.push({ key: `${k.id}.hours`, name: `${stem(k.name)} hours`, aliases: [`${k.name} hours`] });
    } else {
      const plural = /day$/i.test(k.name) ? `${k.name}s` : `${k.name} days`;
      out.push({ key: `${k.id}.days`, name: plural, aliases: [] });
    }
  }
  return out;
}

function quantities(r: Rates, qty: Map<string, number>) {
  const m = new Map<string, number>();
  for (const k of r.kinds) {
    const v = qty.get(k.id) ?? 0;
    if (k.unit === "hour") { m.set(`${k.id}.hours`, v); m.set(`${k.id}.days`, r.fullDayHours > 0 ? v / r.fullDayHours : 0); }
    else m.set(`${k.id}.days`, v);
  }
  return m;
}

/** Every name a formula can use, with its value for this estimate: rates and discounts in dollars, quantities as
 *  counts. Shown as chips under the formula box. */
export function formulaNames(r: Rates, e?: Estimate): Array<{ name: string; value: number; aliases: string[] }> {
  const qty = new Map<string, number>((e?.lines ?? []).map((l) => [l.kindId, l.qty]));
  if (e) for (const k of r.kinds) if (!qty.has(k.id)) qty.set(k.id, 0);
  const q = quantities(r, qty);
  const out: Array<{ name: string; value: number; aliases: string[] }> = [];
  if (r.defaults) { out.push({ name: "Hourly rate", value: r.defaults.hourlyCents / 100, aliases: [] }); out.push({ name: "Daily rate", value: r.defaults.dailyCents / 100, aliases: [] }); }
  for (const k of r.kinds) out.push(k.unit === "hour" ? { name: `${k.name} rate`, value: k.clientCents / 100, aliases: [`${stem(k.name)} rate`] } : { name: k.name, value: k.clientCents / 100, aliases: [`${k.name} rate`] });
  for (const n of quantityNames(r)) out.push({ name: n.name, value: q.get(n.key) ?? 0, aliases: n.aliases });
  for (const d of r.discounts ?? []) out.push({ name: d.name, value: (e?.discounts?.find((x) => x.id === d.id)?.cents ?? 0) / 100, aliases: [] });
  return out;
}

/** The custom formula's price for an estimate, in cents (or what's wrong with it). */
export function formulaPrice(r: Rates, e: Estimate): number | string {
  if (!r.formula?.text.trim()) return "The formula is empty.";
  const names = new Map<string, number>();
  for (const n of formulaNames(r, e)) for (const k of [n.name, ...n.aliases]) names.set(k.toLowerCase(), n.value);
  const v = evaluate(r.formula.text, names);
  return typeof v === "string" ? v : Math.round(v * 100);
}
