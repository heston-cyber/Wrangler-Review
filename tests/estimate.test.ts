// Phase 3: T3.3, the estimate against me-wrangler § 4's worked examples, to the cent.
import { describe, expect, test } from "vitest";
import { WRANGLER_RATES, estimate, ratesProblems, type Rates } from "../convex/lib/estimate";

describe("T3.3 estimate (me-wrangler § 4)", () => {
  test("4 shoot days, standard edit: $19,200 · expenses $9,760 · net $9,440 · reserve $2,360 · owner $7,080", () => {
    const e = estimate(WRANGLER_RATES, { base: { shooting: 4 * 8 } });
    expect(e.lines.map((l) => `${l.kindId} ${l.qty}`)).toEqual(["shooting 32", "editing 64"]);
    expect(e).toMatchObject({ priceCents: 1_920_000, expenseCents: 976_000, netCents: 944_000, reserveCents: 236_000, ownerCents: 708_000, travelDays: 0 });
  });
  test("with 1 travel day: $19,875 · $10,260 · $9,615 · $2,403.75 · $7,211.25; waived goes back to $19,200", () => {
    const e = estimate(WRANGLER_RATES, { base: { shooting: 32 }, travelOver: true, travelDays: 1 });
    expect(e).toMatchObject({ priceCents: 1_987_500, expenseCents: 1_026_000, netCents: 961_500, reserveCents: 240_375, ownerCents: 721_125, travelDays: 1 });
    expect(estimate(WRANGLER_RATES, { base: { shooting: 32 }, travelOver: true, travelDays: 1, travelWaived: true }).priceCents).toBe(1_920_000);
  });
  test("edit levels and extra editing hours; no travel without the rule", () => {
    expect(estimate(WRANGLER_RATES, { base: { shooting: 8 }, levels: { link1: "highend" }, extra: { editing: 4 } }).lines.find((l) => l.kindId === "editing")!.qty).toBe(28);
    const off: Rates = { ...WRANGLER_RATES, travel: { ...WRANGLER_RATES.travel, on: false } };
    expect(estimate(off, { base: { shooting: 8 }, travelOver: true, travelDays: 2 }).travelDays).toBe(0);
  });
  test("rules (D53): one link per kind, no chains; Wrangler's rates are clean", () => {
    expect(ratesProblems(WRANGLER_RATES)).toEqual([]);
    const chained: Rates = { ...WRANGLER_RATES, kinds: [...WRANGLER_RATES.kinds, { id: "color", name: "Color", unit: "hour", clientCents: 15000 }],
      links: [...WRANGLER_RATES.links, { id: "link2", target: "color", base: "editing", levels: [{ id: "a", name: "A", mult: 0.25 }], defaultLevel: "a" }] };
    expect(ratesProblems(chained)).toContain("A linked kind can't be the base of another link (no chains).");
  });
});
