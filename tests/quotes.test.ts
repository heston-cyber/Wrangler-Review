// Phase 3b · Quick quotes. T3b.2 the round trip (save → send → accept or decline on the no-account page, recorded with
// name, time and IP; forged, used, expired and void links refused), T3b.3 nothing moves or converts without the
// owner (D84), T3b.6 numbers never repeat, plus isolation (T3b.5).
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { fakeStripe, world } from "./payHarness";
import { quoteTotals } from "../convex/quotes";

const api = anyApi;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
});
afterEach(() => { vi.unstubAllGlobals(); });

const draft = (w: Awaited<ReturnType<typeof world>>, extra: Record<string, unknown> = {}) => w.heston.mutation(api.quotes.save, {
  who: { clientId: w.harbor, name: "Maya Brooks", email: "maya@harbor.example", company: "Harbor Coffee" }, title: "Menu board refresh",
  lines: [{ id: "a", description: "Shooting · 1 day (8 h)", qty: 1, unitCents: 160_000, suggestedCents: 160_000 }, { id: "b", description: "Editing · simple (12 h)", qty: 1, unitCents: 240_000, suggestedCents: 200_000 }],
  deposit: { kind: "percent", value: 50 }, terms: "Includes one round of changes.", ...extra,
});
const post = (w: Awaited<ReturnType<typeof world>>, body: Record<string, unknown>, ip = "203.0.113.7") =>
  w.t.fetch("/q-respond", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip, "user-agent": "TestBrowser/1" }, body: JSON.stringify(body) });

describe("quick quotes", () => {
  test("totals and deposit", () => {
    expect(quoteTotals({ lines: [{ qty: 1, unitCents: 160_000 }, { qty: 1, unitCents: 240_000 }], deposit: { kind: "percent", value: 50 } })).toEqual({ subtotal: 400_000, discount: 0, tax: 0, total: 400_000, deposit: 200_000 });
    expect(quoteTotals({ lines: [{ qty: 2, unitCents: 10_000 }], discountCents: 5_000, taxPercent: 10, deposit: { kind: "amount", value: 999_999 } })).toMatchObject({ total: 16_500, deposit: 16_500 });
  });

  test("T3b.6 numbers run per business and never repeat; drafts can change, sent quotes can't", async () => {
    const w = await world();
    const a = await draft(w), b = await draft(w);
    const qa = await w.heston.query(api.quotes.get, { quoteId: a }), qb = await w.heston.query(api.quotes.get, { quoteId: b });
    expect(qa.number).toMatch(/-Q-0001$/); expect(qb.number).toMatch(/-Q-0002$/);
    await w.heston.mutation(api.quotes.deleteDraft, { quoteId: b });
    expect((await w.heston.query(api.quotes.get, { quoteId: await draft(w) })).number).toMatch(/-Q-0003$/); // a deleted number isn't reused
    expect(qa).toMatchObject({ status: "draft", totalCents: 400_000, totals: { deposit: 200_000 } });
    expect(qa.validUntil > new Date().toISOString().slice(0, 10)).toBe(true); // 30 days by default (D74)
    await expect(w.heston.mutation(api.quotes.save, { who: { name: "X", email: "not-an-email" }, title: "T", lines: [], deposit: { kind: "percent", value: 25 } })).rejects.toThrow(/email/);
  });

  test("T3b.2 send → the no-account page → accept (name, time, IP recorded); a second answer, a forged link and a decline after it are refused", async () => {
    const w = await world();
    fakeStripe();
    const id = await draft(w) as Id<"quotes">;
    await w.heston.action(api.quotes.send, { quoteId: id });
    const q = await w.heston.query(api.quotes.get, { quoteId: id });
    expect(q.status).toBe("sent");
    const token = q.link.split("/q/")[1];
    const page = await w.t.query(api.quotes.page, { token });
    expect(page).toMatchObject({ number: q.number, status: "sent", totals: { total: 400_000, deposit: 200_000 } });
    expect(JSON.stringify(page)).not.toMatch(/suggestedCents|history|asked/); // the client sees the quote, not the owner's notes
    expect(await w.t.query(api.quotes.page, { token: "x".repeat(24) })).toBeNull();
    await w.t.mutation(api.quotes.markViewed, { token });
    expect((await post(w, { token, action: "accept", name: "M" })).status).toBe(409); // a name, please
    const ok = await post(w, { token, action: "accept", name: "Maya Brooks" });
    expect(await ok.json()).toEqual({ ok: true, status: "accepted" });
    const after = await w.heston.query(api.quotes.get, { quoteId: id });
    expect(after).toMatchObject({ status: "accepted", response: { kind: "accepted", name: "Maya Brooks", ip: "203.0.113.7", userAgent: "TestBrowser/1" }, viewedAt: expect.any(Number) });
    expect((await post(w, { token, action: "decline", name: "" })).status).toBe(409);
    expect((await post(w, { token: "y".repeat(24), action: "accept", name: "Maya Brooks" })).status).toBe(409);
    // The owner sees it on Home until they draft from it or say not now.
    expect((await w.heston.query(api.home.needs, {})).find((n: { kind: string }) => n.kind === "quote")).toMatchObject({ what: "accepted", who: "Maya Brooks" });
  });

  test("T3b.2 decline with a reason; expired and void quotes can't be answered", async () => {
    const w = await world();
    fakeStripe();
    const id = await draft(w) as Id<"quotes">;
    await w.heston.action(api.quotes.send, { quoteId: id });
    const token = (await w.heston.query(api.quotes.get, { quoteId: id })).link.split("/q/")[1];
    await post(w, { token, action: "decline", name: "", reason: "Gone another way" });
    expect(await w.heston.query(api.quotes.get, { quoteId: id })).toMatchObject({ status: "declined", response: { kind: "declined", name: "Maya Brooks", reason: "Gone another way" } });
    const v = await draft(w) as Id<"quotes">;
    await w.heston.action(api.quotes.send, { quoteId: v });
    const vt = (await w.heston.query(api.quotes.get, { quoteId: v })).link.split("/q/")[1];
    await w.heston.mutation(api.quotes.voidQuote, { quoteId: v });
    expect(await (await post(w, { token: vt, action: "accept", name: "Maya Brooks" })).json()).toMatchObject({ error: expect.stringMatching(/withdrawn/) });
    const e = await draft(w) as Id<"quotes">;
    await w.heston.action(api.quotes.send, { quoteId: e });
    const et = (await w.heston.query(api.quotes.get, { quoteId: e })).link.split("/q/")[1];
    await w.t.run(async (ctx) => { await ctx.db.patch(e, { validUntil: "2020-01-01" }); });
    expect(await (await post(w, { token: et, action: "accept", name: "Maya Brooks" })).json()).toMatchObject({ error: expect.stringMatching(/expired/) });
    expect((await w.t.query(api.quotes.page, { token: et })).status).toBe("expired");
  });

  test("T3b.3 nothing moves or converts without the owner (D84); the invoice draft is the deposit or the full total (D87)", async () => {
    const w = await world();
    fakeStripe();
    const id = await draft(w) as Id<"quotes">;
    await w.heston.action(api.quotes.send, { quoteId: id });
    expect((await w.heston.query(api.crm.board, {})).deals).toEqual([]); // sending moved nothing
    const token = (await w.heston.query(api.quotes.get, { quoteId: id })).link.split("/q/")[1];
    await post(w, { token, action: "accept", name: "Maya Brooks" });
    expect((await w.heston.query(api.crm.board, {})).deals).toEqual([]); // accepting moved nothing
    expect(await w.t.run((ctx) => ctx.db.query("invoices").collect())).toHaveLength(0); // and drafted nothing
    await w.heston.mutation(api.quotes.answerMove, { quoteId: id, yes: true });
    expect((await w.heston.query(api.crm.board, {})).deals).toEqual([expect.objectContaining({ stage: "quoted", company: "Harbor Coffee", valueCents: 400_000 })]);
    const r = await w.heston.action(api.quotes.draftFrom, { quoteId: id, contract: false, invoice: "deposit" });
    const inv = await w.t.run((ctx) => ctx.db.get(r.invoiceId!));
    expect(inv).toMatchObject({ status: "draft", kind: "deposit", totalCents: 200_000, billTo: { email: "maya@harbor.example" } });
    expect((await w.heston.query(api.home.needs, {})).some((n: { kind: string }) => n.kind === "quote")).toBe(false); // answered: off Home
    // Another quote, the full total.
    const id2 = await draft(w) as Id<"quotes">;
    await w.heston.action(api.quotes.send, { quoteId: id2 });
    await post(w, { token: (await w.heston.query(api.quotes.get, { quoteId: id2 })).link.split("/q/")[1], action: "accept", name: "Maya Brooks" });
    const r2 = await w.heston.action(api.quotes.draftFrom, { quoteId: id2, contract: false, invoice: "full" });
    expect(await w.t.run((ctx) => ctx.db.get(r2.invoiceId!))).toMatchObject({ kind: "other", totalCents: 400_000, lines: [expect.objectContaining({ unitCents: 160_000 }), expect.objectContaining({ unitCents: 240_000 })] });
  });

  test("T3b.5 clients and other businesses see none of it; a client can't answer by guessing", async () => {
    const w = await world();
    const id = await draft(w) as Id<"quotes">;
    await expect(w.maya.query(api.quotes.list, {})).rejects.toThrow();
    await expect(w.maya.query(api.quotes.get, { quoteId: id })).rejects.toThrow();
    expect(await w.boss.query(api.quotes.list, {})).toEqual([]);
    await expect(w.boss.query(api.quotes.get, { quoteId: id })).rejects.toThrow();
    await expect(w.boss.mutation(api.quotes.answerMove, { quoteId: id, yes: true })).rejects.toThrow();
    await expect(w.boss.mutation(api.quotes.save, { who: { clientId: w.harbor, name: "M", email: "m@x.example" }, title: "T", lines: [], deposit: { kind: "percent", value: 25 } })).rejects.toThrow(/company/);
    expect(await w.t.query(api.quotes.page, { token: "draftdraftdraftdraft" })).toBeNull(); // drafts have no link
  });
});
