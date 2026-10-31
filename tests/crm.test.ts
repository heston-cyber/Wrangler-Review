// Phase 3 (Oct 31): the CRM. T3.1 website leads, T3.2 a card through every stage on events, T3.4 totals, T3.5 clients
// see nothing (also covered by the access matrix and the isolation test).
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { webflowSignatureOk, looksLikeSpam } from "../convex/leads";

const api = anyApi;
const SECRET = "wf_secret";
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.WEBFLOW_WEBHOOK_SECRET = SECRET;
});
afterEach(() => { vi.useRealTimers(); });

async function sign(body: string, t = Date.now()) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${t}:${body}`)))].map((x) => x.toString(16).padStart(2, "0")).join("");
  return { "x-webflow-timestamp": String(t), "x-webflow-signature": sig };
}

describe("T3.1 leads from the website", () => {
  test("a signed submission becomes a Lead card; a forged or stale one is refused; spam is dropped; a double submit is one lead", async () => {
    const w = await world();
    const body = JSON.stringify({ triggerType: "form_submission", payload: { name: "Quote", id: "sub_1", data: { Name: "Dana Fox", Email: "dana@okieroasters.example", Company: "Okie Roasters", Message: "Brand film, 4 days", Budget: "$15k–25k" } } });
    expect((await w.t.fetch("/leads/webflow", { method: "POST", body, headers: { "x-webflow-timestamp": String(Date.now()), "x-webflow-signature": "00" } })).status).toBe(400);
    expect((await w.t.fetch("/leads/webflow", { method: "POST", body, headers: await sign(body, Date.now() - 10 * 60_000) })).status).toBe(400);
    expect((await w.t.fetch("/leads/webflow", { method: "POST", body, headers: await sign(body) })).status).toBe(200);
    expect((await w.t.fetch("/leads/webflow", { method: "POST", body, headers: await sign(body) })).status).toBe(200);
    const spam = JSON.stringify({ triggerType: "form_submission", payload: { data: { Name: "x", Email: "x@y.example", hp: "http://spam.example" } } });
    await w.t.fetch("/leads/webflow", { method: "POST", body: spam, headers: await sign(spam) });
    const b = await w.heston.query(api.crm.board, {});
    expect(b.deals).toEqual([expect.objectContaining({ title: "Okie Roasters", stage: "lead", website: true, company: "Okie Roasters" })]);
    const d = await w.heston.query(api.crm.deal, { dealId: b.deals[0]._id });
    expect(d.lead).toMatchObject({ name: "Dana Fox", email: "dana@okieroasters.example", message: "Brand film, 4 days", fields: [{ label: "Budget", value: "$15k–25k" }] });
    expect(looksLikeSpam({ Email: "no-at-sign" })).toBe("no email");
    expect(await webflowSignatureOk("{}", null, null, SECRET)).toBe(false);
  });

  test("off until the secret is set", async () => {
    const w = await world();
    delete process.env.WEBFLOW_WEBHOOK_SECRET;
    expect((await w.t.fetch("/leads/webflow", { method: "POST", body: "{}" })).status).toBe(404);
    process.env.WEBFLOW_WEBHOOK_SECRET = SECRET;
  });
});

describe("T3.2 a card moves on events (forward only, D60)", () => {
  test("estimate (D56 makes the company and contact) → contract sent → signed → in production → delivered → paid; a hand move stays until a later event", async () => {
    const w = await world();
    const body = JSON.stringify({ triggerType: "form_submission", payload: { data: { Name: "Dana Fox", Email: "dana@okieroasters.example", Company: "Okie Roasters" } } });
    await w.t.fetch("/leads/webflow", { method: "POST", body, headers: await sign(body) });
    const dealId = (await w.heston.query(api.crm.board, {})).deals[0]._id as Id<"deals">;
    const estimateId = await w.heston.mutation(api.crm.saveEstimate, { dealId, title: "Brand film", scope: "4 shoot days", input: { unit: "days", amount: 4, travelOver: true, travelDays: 1 } });
    let d = await w.heston.query(api.crm.deal, { dealId });
    expect(d).toMatchObject({ stage: "quoted", valueCents: 1_987_500, company: { name: "Okie Roasters" } });
    const est = await w.heston.query(api.crm.getEstimate, { estimateId });
    expect(est.result).toMatchObject({ priceCents: 1_987_500, netCents: 961_500, reserveCents: 240_375 });
    // Link the deal to a document and a project, as the contract draft and the project would.
    const { docId, projectId } = await w.t.run(async (ctx) => {
      const docId = await ctx.db.insert("wsDocuments", { businessId: w.A, number: 30, title: "Service Agreement", status: "approved", currentVersion: 1, createdAt: 0, updatedAt: 0 });
      await ctx.db.patch(dealId, { documentId: docId, projectId: w.p });
      return { docId, projectId: w.p };
    });
    const { crmDocument, crmProject } = await import("../convex/crm");
    const step = (f: (ctx: never) => Promise<void>) => w.t.run(async (ctx) => { await f(ctx as never); });
    await step((ctx) => crmDocument(ctx, docId, "contract_sent", "sent"));
    await step((ctx) => crmDocument(ctx, docId, "signed", "signed"));
    expect((await w.heston.query(api.crm.deal, { dealId })).stage).toBe("signed");
    await w.heston.mutation(api.crm.moveDeal, { dealId, stage: "delivered" }); // by hand, ahead
    await step((ctx) => crmDocument(ctx, docId, "signed", "signed again")); // an earlier stage's event doesn't pull it back
    expect((await w.heston.query(api.crm.deal, { dealId })).stage).toBe("delivered");
    await w.heston.mutation(api.crm.moveDeal, { dealId, stage: "quoted" }); // by hand, backwards: it stays until a later event
    expect((await w.heston.query(api.crm.deal, { dealId })).stage).toBe("quoted");
    await w.heston.mutation(api.projects.setStage, { projectId, stage: "production", post: false });
    expect((await w.heston.query(api.crm.deal, { dealId })).stage).toBe("in_production");
    await step((ctx) => crmProject(ctx, projectId, "delivered", "files"));
    await step((ctx) => crmProject(ctx, projectId, "paid", "final paid"));
    d = await w.heston.query(api.crm.deal, { dealId });
    expect(d.stage).toBe("paid");
  });
});

describe("T3.4 totals, follow-ups, the ledger; T3.5 clients see none of it", () => {
  test("company totals from the invoices; follow-ups due; ledger actual vs estimate; client refused everywhere", async () => {
    const w = await world();
    await w.t.run(async (ctx) => {
      const base = { businessId: w.A, clientId: w.harbor, kind: "other" as const, title: "T", billTo: { name: "M", email: "maya@harbor.example" }, lines: [], dueDate: "2030-01-01", history: [], createdAt: 0, updatedAt: 0 };
      await ctx.db.insert("invoices", { ...base, status: "paid", totalCents: 300000, amountPaidCents: 300000, amountRemainingCents: 0 });
      await ctx.db.insert("invoices", { ...base, status: "open", totalCents: 900000, amountPaidCents: 100000, amountRemainingCents: 800000 });
      await ctx.db.insert("invoices", { ...base, status: "draft", totalCents: 50000, amountPaidCents: 0, amountRemainingCents: 50000 });
    });
    expect(await w.heston.query(api.crm.company, { clientId: w.harbor })).toMatchObject({ billedCents: 1_200_000, paidCents: 400_000, outstandingCents: 800_000 });
    await w.heston.mutation(api.crm.addFollowUp, { who: "Maya", about: "Check in on v2", due: "2020-01-01", clientId: w.harbor });
    expect(await w.heston.query(api.crm.due, {})).toEqual([expect.objectContaining({ who: "Maya", overdue: true })]);
    await w.heston.mutation(api.crm.saveEstimate, { clientId: w.harbor, projectId: w.p, title: "Launch", scope: "", input: { unit: "days", amount: 4 } });
    await w.heston.mutation(api.crm.logEntry, { projectId: w.p, kind: "hours", workId: "shooting", hours: 30, date: "2026-10-31" });
    await w.heston.mutation(api.crm.logEntry, { projectId: w.p, kind: "hours", workId: "editing", hours: 70, date: "2026-10-31" });
    await w.heston.mutation(api.crm.logEntry, { projectId: w.p, kind: "cost", cents: 25000, note: "Drone", date: "2026-10-31" });
    const l = await w.heston.query(api.crm.ledger, { projectId: w.p });
    // Actual: 30 × $125 + 70 × $90 + $250 = $3,750 + $6,300 + $250 = $10,300 against $19,200.
    expect(l.estimate.priceCents).toBe(1_920_000);
    expect(l.actual).toMatchObject({ expenseCents: 1_030_000, netCents: 890_000, reserveCents: 222_500, ownerCents: 667_500 });
    await expect(w.maya.query(api.crm.board, {})).rejects.toThrow();
    await expect(w.maya.query(api.crm.ledger, { projectId: w.p })).rejects.toThrow();
    await expect(w.maya.query(api.crm.company, { clientId: w.harbor })).rejects.toThrow();
    // Another business's owner sees only their own (empty) pipeline, and none of this business's projects.
    expect((await w.boss.query(api.crm.board, {})).deals).toEqual([]);
    expect(await w.boss.query(api.crm.ledger, { projectId: w.p })).toBeNull();
    expect(await w.boss.query(api.crm.company, { clientId: w.harbor })).toBeNull();
  });
});

describe("Phase 3 screens' extras (Oct 31)", () => {
  test("a card linked to its project moves with it; day-before reminders; per-kind actuals at the picked cost; billed price; export all", async () => {
    const w = await world();
    const dealId = await w.heston.mutation(api.crm.addDeal, { title: "Launch", clientId: w.harbor });
    await w.heston.mutation(api.crm.saveEstimate, { dealId, title: "Launch", scope: "", input: { unit: "days", amount: 4 } });
    await w.heston.mutation(api.crm.linkProject, { dealId, projectId: w.p });
    expect((await w.heston.query(api.crm.deal, { dealId })).projectId).toBe(w.p);
    await w.heston.mutation(api.projects.setStage, { projectId: w.p, stage: "production", post: false });
    expect((await w.heston.query(api.crm.deal, { dealId })).stage).toBe("in_production");
    // The estimate now belongs to the project, so the ledger compares against it.
    const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 86_400_000));
    await w.heston.mutation(api.crm.addFollowUp, { who: "Maya", about: "", due: tomorrow, remind: "day_before" });
    await w.heston.mutation(api.crm.addFollowUp, { who: "Jordan", about: "", due: tomorrow });
    expect((await w.heston.query(api.crm.due, {})).map((f: { who: string }) => f.who)).toEqual(["Maya"]);
    await w.heston.mutation(api.crm.logEntry, { projectId: w.p, kind: "hours", workId: "editing", costId: "editor", hours: 10, date: "2026-10-31" });
    await expect(w.heston.mutation(api.crm.logEntry, { projectId: w.p, kind: "hours", workId: "editing", costId: "shooter", hours: 1, date: "2026-10-31" })).rejects.toThrow(/Pick a cost/);
    let l = await w.heston.query(api.crm.ledger, { projectId: w.p });
    const editing = l.kinds.find((k: { id: string }) => k.id === "editing");
    expect(editing).toMatchObject({ estQty: 64, actQty: 10, estCents: 576_000, actCents: 90_000 });
    expect(l.actual).toMatchObject({ priceCents: 1_920_000, billed: false });
    await w.t.run(async (ctx) => {
      await ctx.db.insert("invoices", { businessId: w.A, clientId: w.harbor, projectId: w.p, kind: "deposit", title: "Deposit", billTo: { name: "M", email: "maya@harbor.example" }, lines: [], dueDate: "2030-01-01", history: [], createdAt: 0, updatedAt: 0,
        status: "paid", totalCents: 480_000, amountPaidCents: 480_000, amountRemainingCents: 0 });
    });
    l = await w.heston.query(api.crm.ledger, { projectId: w.p });
    expect(l).toMatchObject({ billedCents: 480_000, paidCents: 480_000, actual: { priceCents: 1_920_000, billed: false } });
    await w.t.run(async (ctx) => {
      await ctx.db.insert("invoices", { businessId: w.A, clientId: w.harbor, projectId: w.p, kind: "final", title: "Final", billTo: { name: "M", email: "maya@harbor.example" }, lines: [], dueDate: "2030-01-01", history: [], createdAt: 0, updatedAt: 0,
        status: "open", totalCents: 1_440_000, amountPaidCents: 0, amountRemainingCents: 1_440_000, refundedCents: 0 });
    });
    l = await w.heston.query(api.crm.ledger, { projectId: w.p });
    expect(l.actual).toMatchObject({ priceCents: 1_920_000, billed: true });
    expect(await w.heston.mutation(api.crm.setLedgerExportAll, {})).toBe(1);
    expect((await w.heston.query(api.crm.ledger, { projectId: w.p })).exportedAt).toBeTruthy();
  });
});

describe("review fixes (Oct 31)", () => {
  test("another business can't hang a card on this business's project, company or card", async () => {
    const w = await world();
    await expect(w.boss.mutation(api.crm.saveEstimate, { projectId: w.p, title: "x", scope: "", input: { unit: "days", amount: 1 } })).rejects.toThrow();
    await expect(w.boss.mutation(api.crm.saveEstimate, { clientId: w.harbor, title: "x", scope: "", input: { unit: "days", amount: 1 } })).rejects.toThrow();
    await expect(w.boss.mutation(api.crm.addFollowUp, { who: "x", about: "", due: "2030-01-01", clientId: w.harbor })).rejects.toThrow();
    // Even a card stored with this project's id (written straight to the table) isn't moved by its events.
    const other = await w.t.run(async (ctx) => {
      const B = (await ctx.db.query("businesses").collect()).find((b) => b._id !== w.A)!._id;
      return ctx.db.insert("deals", { businessId: B, title: "theirs", projectId: w.p, stage: "lead", source: "hand", history: [], createdAt: 0, updatedAt: 0 });
    });
    const { crmProject } = await import("../convex/crm");
    await w.t.run(async (ctx) => { await crmProject(ctx as never, w.p, "paid", "final paid"); });
    expect(await w.t.run((ctx) => ctx.db.get(other))).toMatchObject({ stage: "lead" });
  });

  test("a lead from an existing client's person reuses the company and contact; one card per project", async () => {
    const w = await world();
    const dealId = await w.t.run((ctx) => ctx.db.insert("deals", { businessId: w.A, title: "Harbor", stage: "lead", source: "website", contactEmail: "maya@harbor.example",
      lead: { name: "Maya Brooks", email: "maya@harbor.example", company: "Harbor Coffee", fields: [], at: 0 }, history: [], createdAt: 0, updatedAt: 0 }));
    await w.heston.mutation(api.crm.saveEstimate, { dealId, title: "Spring", scope: "", input: { unit: "days", amount: 1 } });
    const counts = await w.t.run(async (ctx) => ({ clients: (await ctx.db.query("clients").collect()).filter((c) => c.businessId === w.A).length, maya: (await ctx.db.query("clientPeople").collect()).filter((p) => p.email === "maya@harbor.example").length }));
    expect(counts).toEqual({ clients: 1, maya: 1 });
    expect((await w.heston.query(api.crm.deal, { dealId })).clientId).toBe(w.harbor);
    await w.heston.mutation(api.crm.linkProject, { dealId, projectId: w.p });
    await w.heston.mutation(api.crm.saveEstimate, { projectId: w.p, clientId: w.harbor, title: "From the ledger", scope: "", input: { unit: "days", amount: 2 } });
    expect((await w.heston.query(api.crm.board, {})).deals.length).toBe(1);
  });

  test("logged work is priced at the current rates; hours need a kind; unpriced hours are shown; a deposit isn't a loss", async () => {
    const w = await world();
    await w.heston.mutation(api.crm.saveEstimate, { projectId: w.p, clientId: w.harbor, title: "Job", scope: "", input: { unit: "days", amount: 4 } });
    const r = (await w.heston.query(api.crm.rates, {})).rates;
    await w.heston.mutation(api.crm.saveRates, { rates: { ...r, kinds: [...r.kinds, { id: "color", name: "Color", unit: "hour", clientCents: 15000 }, { id: "admin", name: "Admin", unit: "hour", clientCents: 0 }], costs: [...r.costs, { id: "colorist", name: "Colorist", kindId: "color", cents: 10000 }] } });
    await w.heston.mutation(api.crm.logEntry, { projectId: w.p, kind: "hours", workId: "color", hours: 10, date: "2026-10-31" });
    await w.heston.mutation(api.crm.logEntry, { projectId: w.p, kind: "hours", workId: "admin", hours: 2, date: "2026-10-31" });
    await expect(w.heston.mutation(api.crm.logEntry, { projectId: w.p, kind: "hours", hours: 3, date: "2026-10-31" })).rejects.toThrow(/kind of work/);
    const l = await w.heston.query(api.crm.ledger, { projectId: w.p });
    expect(l.kinds.find((k: { id: string }) => k.id === "color")).toMatchObject({ actQty: 10, actCents: 100_000 });
    expect(l.entries.find((e: { workId: string }) => e.workId === "admin")).toMatchObject({ unpriced: true, cents: 0 });
    await w.t.run(async (ctx) => {
      await ctx.db.insert("invoices", { businessId: w.A, clientId: w.harbor, projectId: w.p, kind: "deposit", title: "Deposit", billTo: { name: "M", email: "maya@harbor.example" }, lines: [], dueDate: "2030-01-01", history: [], createdAt: 0, updatedAt: 0,
        status: "paid", totalCents: 480_000, amountPaidCents: 480_000, amountRemainingCents: 0 });
    });
    const after = await w.heston.query(api.crm.ledger, { projectId: w.p });
    expect(after.actual).toMatchObject({ priceCents: 1_920_000, billed: false });
    expect(after).toMatchObject({ billedCents: 480_000, paidCents: 480_000 });
  });
});

describe("Phase 3b step 1: brand kits", () => {
  test("the owner saves the business's and a company's kit; limits hold (D90); clients and other businesses can't", async () => {
    const w = await world();
    await w.heston.mutation(api.brandKit.save, { colors: [{ hex: "#e10600" }], fonts: { heading: "Anton" }, links: [{ url: "instagram.com/wranglerproductions" }], tone: ["Cinematic", "Warm", "Warm"] });
    expect(await w.heston.query(api.brandKit.get, {})).toMatchObject({ kind: "business", colors: [{ hex: "#E10600" }], fonts: { heading: "Anton" }, links: [{ label: "Instagram" }], tone: ["Cinematic", "Warm"] });
    await w.heston.mutation(api.brandKit.save, { clientId: w.harbor, colors: [{ hex: "#3B2A20" }], fonts: {}, links: [], tone: ["Community"] });
    expect(await w.heston.query(api.brandKit.get, { clientId: w.harbor })).toMatchObject({ kind: "company", name: "Harbor Coffee", tone: ["Community"] });
    await expect(w.heston.mutation(api.brandKit.save, { colors: [{ hex: "red" }], fonts: {}, links: [], tone: [] })).rejects.toThrow(/colour/);
    // A 26 MB upload is refused and deleted; a small one is kept.
    const big = await w.t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(26 * 1024 * 1024)], { type: "application/pdf" })));
    expect((await w.heston.mutation(api.brandKit.addFile, { storageId: big, name: "huge.pdf" })).error).toMatch(/25 MB/);
    expect(await w.t.run((ctx) => ctx.storage.getUrl(big))).toBeNull();
    const small = await w.t.run((ctx) => ctx.storage.store(new Blob(["%PDF"], { type: "application/pdf" })));
    expect((await w.heston.mutation(api.brandKit.addFile, { storageId: small, name: "guide.pdf" })).error).toBeNull();
    expect((await w.heston.query(api.brandKit.get, {})).files).toEqual([expect.objectContaining({ name: "guide.pdf" })]);
    await expect(w.maya.query(api.brandKit.get, {})).rejects.toThrow();
    await expect(w.boss.query(api.brandKit.get, { clientId: w.harbor })).rejects.toThrow();
    await expect(w.boss.mutation(api.brandKit.save, { clientId: w.harbor, colors: [], fonts: {}, links: [], tone: [] })).rejects.toThrow();
  });
});
