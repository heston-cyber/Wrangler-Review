// Phase 3 (Oct 31): the CRM, back office only. Clients › Pipeline · Companies · Follow-ups; estimates from Settings ›
// Estimate rates; the job ledger on each project. Companies are the client records (0.5d step 5) and contacts are their
// people (Phase 1), so nothing is copied. Decisions: D27 (ledger in the portal, Sheet export), D53–D60, D56 (a website
// lead's company and contact are made at its first estimate), D67 (Claude drafts wait for Confirm), D68 (existing clients
// get no cards; the board starts with new leads and estimates).
import { action } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe } from "./lib/access";
import { businessInScope, defaultBusiness } from "./lib/business";
import { EMPTY_RATES, WRANGLER_RATES, estimate, primaryKind, ratesProblems, type EstimateInput, type Rates } from "./lib/estimate";
import { applyArgs } from "./wsMcp";
import { accessOf } from "./clients";
import type { Fields } from "./lib/wsBuilder";

export const STAGES = ["lead", "quoted", "contract_sent", "signed", "in_production", "delivered", "paid"] as const;
export type Stage = (typeof STAGES)[number];
const stageV = v.union(v.literal("lead"), v.literal("quoted"), v.literal("contract_sent"), v.literal("signed"), v.literal("in_production"), v.literal("delivered"), v.literal("paid"));
export const STAGE_NAME: Record<Stage, string> = { lead: "Lead", quoted: "Quoted", contract_sent: "Contract sent", signed: "Signed", in_production: "In production", delivered: "Delivered", paid: "Paid" };
const label = (p: { name: string; jobNumber?: string }) => (p.jobNumber ? `${p.jobNumber} ${p.name}` : p.name);
// "Today" in Central time (Wrangler's), through daylight saving (review, Oct 31). A per-business time zone comes
// with Phase P.
const todayIso = () => {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
  catch { return new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10); }
};

async function ownerBiz(ctx: QueryCtx | MutationCtx) {
  const me = await requireMe(ctx);
  const id = businessInScope(ctx);
  const b = id ? await ctx.db.get(id) : null;
  if (!b) throw new ConvexError("Not allowed.");
  return { me, b };
}

/** The business's rates: its own, or Wrangler's (me-wrangler § 4) for the first business, or empty. */
export async function ratesOf(ctx: QueryCtx | MutationCtx, b: Doc<"businesses">): Promise<Rates> {
  if (b.estimateRates) return b.estimateRates as Rates;
  return (await defaultBusiness(ctx))?._id === b._id ? WRANGLER_RATES : EMPTY_RATES;
}

// ---------- Settings › Estimate rates ----------

export const rates = query({
  args: {},
  handler: async (ctx) => {
    const { b } = await ownerBiz(ctx);
    const r = await ratesOf(ctx, b);
    const k = primaryKind(r);
    const check = k ? estimate(r, { base: { [k.id]: 4 * r.fullDayHours } }) : null;
    const withTravel = k && r.travel.on ? estimate(r, { base: { [k.id]: 4 * r.fullDayHours }, travelOver: true, travelDays: 1 }) : null;
    return { rates: r, problems: ratesProblems(r), check, withTravel };
  },
});

export const saveRates = mutation({
  args: { rates: v.any() },
  handler: async (ctx, { rates: r }) => {
    const { b } = await ownerBiz(ctx);
    const problems = ratesProblems(r as Rates);
    if (problems.length) throw new ConvexError(problems[0]);
    if (JSON.stringify(r).length > 20_000) throw new ConvexError("That's too many rates.");
    await ctx.db.patch(b._id, { estimateRates: r });
    return null;
  },
});

// ---------- the pipeline ----------

/** D60: an event only ever moves a card forward; a card dragged by hand stays until a later event moves it further. */
async function advanceDeal(ctx: MutationCtx, d: Doc<"deals">, stage: Stage, detail: string) {
  if (d.closedAt || STAGES.indexOf(stage) <= STAGES.indexOf(d.stage)) return false;
  await ctx.db.patch(d._id, { stage, history: [...d.history, { kind: stage, at: Date.now(), detail }].slice(-60), updatedAt: Date.now() });
  return true;
}

/** Called from Sign (sent, signed): the deal whose estimate made this contract. */
export async function crmDocument(ctx: MutationCtx, documentId: Id<"wsDocuments">, stage: Stage, detail: string) {
  // Review (Oct 31): hooks can run without a business in scope (Stripe's webhook, a signer), so only this
  // document's own business's cards move; another business can't hang a card on it.
  const doc = await ctx.db.get(documentId);
  if (!doc) return;
  const mine = <T extends { businessId?: Id<"businesses"> }>(x: T) => x.businessId === doc.businessId;
  let deals = (await ctx.db.query("deals").withIndex("by_document", (q) => q.eq("documentId", documentId)).collect()).filter(mine);
  if (!deals.length) {
    // A contract drafted from an estimate: its build becomes this document when it goes to signing.
    const build = (await ctx.db.query("wsBuilds").withIndex("by_document", (q) => q.eq("documentId", documentId)).collect()).find(mine);
    const est = build ? (await ctx.db.query("estimates").collect()).find((e) => e.buildId === build._id && mine(e)) : null;
    const d = est?.dealId ? await ctx.db.get(est.dealId) : null;
    if (d && mine(d)) { await ctx.db.patch(d._id, { documentId }); if (est) await ctx.db.patch(est._id, { documentId }); deals = [{ ...d, documentId }]; }
  }
  for (const d of deals) await advanceDeal(ctx, d, stage, detail);
}

/** Called from projects (stage, final files) and invoices (the final invoice paid). */
export async function crmProject(ctx: MutationCtx, projectId: Id<"projects">, stage: Stage, detail: string) {
  const p = await ctx.db.get(projectId);
  if (!p) return;
  for (const d of await ctx.db.query("deals").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect()) if (d.businessId === p.businessId) await advanceDeal(ctx, d, stage, detail);
}

export const board = query({
  args: {},
  handler: async (ctx) => {
    await ownerBiz(ctx);
    const deals = (await ctx.db.query("deals").collect()).filter((d) => !d.closedAt);
    const fus = (await ctx.db.query("followUps").collect()).filter((f) => !f.doneAt && !f.draft);
    const names = new Map<string, string>();
    const out: Array<{ _id: Id<"deals">; title: string; stage: Stage; company: string | null; project: string | null; valueCents: number | null; website: boolean; followUp: string | null; updatedAt: number }> = [];
    for (const d of deals.sort((a, b) => b.updatedAt - a.updatedAt)) {
      if (d.clientId && !names.has(d.clientId)) names.set(d.clientId, (await ctx.db.get(d.clientId))?.name ?? "");
      const next = fus.filter((f) => f.dealId === d._id).sort((a, b) => a.due.localeCompare(b.due))[0];
      const p = d.projectId ? await ctx.db.get(d.projectId) : null;
      out.push({ _id: d._id, title: d.title, stage: d.stage, company: d.clientId ? names.get(d.clientId) ?? null : d.lead?.company ?? d.lead?.name ?? null,
        project: p ? label(p) : null, valueCents: d.valueCents ?? null, website: d.source === "website", followUp: next?.due ?? null, updatedAt: d.updatedAt });
    }
    return { deals: out, stages: STAGES.map((s) => ({ key: s, name: STAGE_NAME[s], n: out.filter((d) => d.stage === s).length, cents: out.filter((d) => d.stage === s).reduce((t, d) => t + (d.valueCents ?? 0), 0) })) };
  },
});

export const addDeal = mutation({
  args: { title: v.string(), clientId: v.optional(v.id("clients")), contactEmail: v.optional(v.string()), valueCents: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const { me } = await ownerBiz(ctx);
    const title = a.title.trim();
    if (!title) throw new ConvexError("Give it a name.");
    if (a.clientId && !(await ctx.db.get(a.clientId))) throw new ConvexError("That company isn't here.");
    const now = Date.now();
    return await ctx.db.insert("deals", { title: title.slice(0, 160), ...(a.clientId ? { clientId: a.clientId } : {}), ...(a.contactEmail ? { contactEmail: a.contactEmail.trim().toLowerCase() } : {}),
      ...(a.valueCents ? { valueCents: Math.max(0, Math.round(a.valueCents)) } : {}), stage: "lead", source: "hand", history: [{ kind: "created", at: now, by: me.name ?? me.email }], createdAt: now, updatedAt: now });
  },
});

/** Dragging a card (D60: it stays where you put it until an event moves it further). */
export const moveDeal = mutation({
  args: { dealId: v.id("deals"), stage: stageV },
  handler: async (ctx, { dealId, stage }) => {
    const { me } = await ownerBiz(ctx);
    const d = await ctx.db.get(dealId);
    if (!d) throw new ConvexError("That card isn't here.");
    if (d.stage === stage) return null;
    await ctx.db.patch(dealId, { stage: stage as Stage, history: [...d.history, { kind: "moved", at: Date.now(), by: me.name ?? me.email, detail: `${STAGE_NAME[d.stage]} → ${STAGE_NAME[stage as Stage]}` }].slice(-60), updatedAt: Date.now() });
    return null;
  },
});

/** Link a card to its project, so the project's stage, delivery and final invoice move the card (D60). */
export const linkProject = mutation({
  args: { dealId: v.id("deals"), projectId: v.union(v.id("projects"), v.null()) },
  handler: async (ctx, { dealId, projectId }) => {
    await ownerBiz(ctx);
    const d = await ctx.db.get(dealId);
    if (!d) throw new ConvexError("That card isn't here.");
    const p = projectId ? await ctx.db.get(projectId) : null;
    if (projectId && !p) throw new ConvexError("That project isn't here.");
    await ctx.db.patch(dealId, { projectId: p?._id, ...(p?.clientId && !d.clientId ? { clientId: p.clientId } : {}), updatedAt: Date.now() });
    if (d.estimateId && p) { const e = await ctx.db.get(d.estimateId); if (e && !e.projectId) await ctx.db.patch(e._id, { projectId: p._id }); }
    return null;
  },
});

/** "Not a lead", or take a card off the board (it isn't deleted). */
export const closeDeal = mutation({
  args: { dealId: v.id("deals"), reason: v.optional(v.string()) },
  handler: async (ctx, { dealId, reason }) => {
    const { me } = await ownerBiz(ctx);
    const d = await ctx.db.get(dealId);
    if (!d) throw new ConvexError("That card isn't here.");
    await ctx.db.patch(dealId, { closedAt: Date.now(), history: [...d.history, { kind: "closed", at: Date.now(), by: me.name ?? me.email, ...(reason ? { detail: reason.slice(0, 200) } : {}) }], updatedAt: Date.now() });
    return null;
  },
});

export const deal = query({
  args: { dealId: v.string() },
  handler: async (ctx, { dealId }) => {
    await ownerBiz(ctx);
    const id = ctx.db.normalizeId("deals", dealId);
    const d = id ? await ctx.db.get(id) : null;
    if (!d) return null;
    const client = d.clientId ? await ctx.db.get(d.clientId) : null;
    const project = d.projectId ? await ctx.db.get(d.projectId) : null;
    const estimates = (await ctx.db.query("estimates").withIndex("by_deal", (q) => q.eq("dealId", d._id)).collect()).map((e) => ({ _id: e._id, title: e.title, priceCents: (e.result as { priceCents: number }).priceCents, updatedAt: e.updatedAt }));
    const followUps = (await ctx.db.query("followUps").withIndex("by_deal", (q) => q.eq("dealId", d._id)).collect()).filter((f) => !f.doneAt);
    const projects = (await ctx.db.query("projects").collect()).filter((x) => !d.clientId || x.clientId === d.clientId).sort((a, b) => b.createdAt - a.createdAt).slice(0, 50).map((x) => ({ _id: x._id, label: label(x) }));
    return { ...d, projects, stageName: STAGE_NAME[d.stage], company: client ? { _id: client._id, name: client.name } : null, project: project ? { _id: project._id, label: label(project) } : null, estimates, followUps };
  },
});

// ---------- companies and contacts ----------

async function moneyFor(ctx: QueryCtx, invoices: Doc<"invoices">[]) {
  const sent = invoices.filter((i) => !["draft", "sending", "void"].includes(i.status));
  return { billedCents: sent.reduce((t, i) => t + i.totalCents, 0), paidCents: sent.reduce((t, i) => t + i.amountPaidCents - (i.refundedCents ?? 0), 0), outstandingCents: sent.filter((i) => i.status === "open").reduce((t, i) => t + i.amountRemainingCents, 0) };
}

/** Clients › Companies: every client record, with money from the portal's copy of Stripe and open deals. */
export const companies = query({
  args: {},
  handler: async (ctx) => {
    await ownerBiz(ctx);
    const clients = await ctx.db.query("clients").collect();
    const deals = (await ctx.db.query("deals").collect()).filter((d) => !d.closedAt);
    const out = [];
    for (const c of clients.sort((a, b) => a.name.localeCompare(b.name))) {
      const people = (await ctx.db.query("clientPeople").withIndex("by_client", (q) => q.eq("clientId", c._id)).collect()).filter((p) => !p.removedAt).length;
      const m = await moneyFor(ctx, await ctx.db.query("invoices").withIndex("by_client", (q) => q.eq("clientId", c._id)).collect());
      out.push({ _id: c._id, name: c.name, people, deals: deals.filter((d) => d.clientId === c._id).length, ...m });
    }
    return out;
  },
});

export const company = query({
  args: { clientId: v.string() },
  handler: async (ctx, { clientId }) => {
    await ownerBiz(ctx);
    const id = ctx.db.normalizeId("clients", clientId);
    const c = id ? await ctx.db.get(id) : null;
    if (!c) return null;
    const m = await moneyFor(ctx, await ctx.db.query("invoices").withIndex("by_client", (q) => q.eq("clientId", c._id)).collect());
    const deals = (await ctx.db.query("deals").withIndex("by_client", (q) => q.eq("clientId", c._id)).collect()).filter((d) => !d.closedAt).map((d) => ({ _id: d._id, title: d.title, stage: d.stage, stageName: STAGE_NAME[d.stage], valueCents: d.valueCents ?? null }));
    const followUps = (await ctx.db.query("followUps").withIndex("by_client", (q) => q.eq("clientId", c._id)).collect()).filter((f) => !f.doneAt).sort((a, b) => a.due.localeCompare(b.due));
    return { _id: c._id, name: c.name, ...m, deals, followUps };
  },
});

export const contact = query({
  args: { personId: v.string() },
  handler: async (ctx, { personId }) => {
    await ownerBiz(ctx);
    const id = ctx.db.normalizeId("clientPeople", personId);
    const p = id ? await ctx.db.get(id) : null;
    if (!p) return null;
    const c = await ctx.db.get(p.clientId);
    const m = await moneyFor(ctx, await ctx.db.query("invoices").withIndex("by_client", (q) => q.eq("clientId", p.clientId)).collect());
    const followUps = (await ctx.db.query("followUps").withIndex("by_client", (q) => q.eq("clientId", p.clientId)).collect()).filter((f) => !f.doneAt && (!f.email || f.email === p.email));
    const deals = (await ctx.db.query("deals").withIndex("by_client", (q) => q.eq("clientId", p.clientId)).collect()).filter((d) => !d.closedAt && (!d.contactEmail || d.contactEmail === p.email)).map((d) => ({ _id: d._id, title: d.title, stageName: STAGE_NAME[d.stage] }));
    const items = (await ctx.db.query("inboxItems").collect()).filter((i) => i.email === p.email).sort((a, b) => b.createdAt - a.createdAt).slice(0, 8).map((i) => ({ title: i.title, at: i.createdAt, read: !!i.readAt }));
    return { _id: p._id, name: p.name ?? p.email, email: p.email, role: p.role, access: await accessOf(ctx, p.email), company: c ? { _id: c._id, name: c.name } : null, ...m, followUps, deals, activity: items };
  },
});

// ---------- follow-ups ----------

export const followUps = query({
  args: {},
  handler: async (ctx) => {
    await ownerBiz(ctx);
    const all = (await ctx.db.query("followUps").collect()).filter((f) => !f.doneAt);
    const names = new Map<string, string>();
    const out = [];
    for (const f of all.sort((a, b) => a.due.localeCompare(b.due))) {
      if (f.clientId && !names.has(f.clientId)) names.set(f.clientId, (await ctx.db.get(f.clientId))?.name ?? "");
      out.push({ ...f, company: f.clientId ? names.get(f.clientId) ?? null : null });
    }
    return { today: todayIso(), rows: out };
  },
});

export const addFollowUp = mutation({
  args: { who: v.string(), about: v.string(), due: v.string(), clientId: v.optional(v.id("clients")), dealId: v.optional(v.id("deals")), email: v.optional(v.string()), note: v.optional(v.string()),
    remind: v.optional(v.union(v.literal("morning_of"), v.literal("day_before"))) },
  handler: async (ctx, a) => {
    const { me } = await ownerBiz(ctx);
    if (!a.who.trim()) throw new ConvexError("Who to follow up with, please.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.due)) throw new ConvexError("Pick a due date.");
    if (a.clientId && !(await ctx.db.get(a.clientId))) throw new ConvexError("That company isn't here.");
    const d = a.dealId ? await ctx.db.get(a.dealId) : null;
    if (a.dealId && !d) throw new ConvexError("That card isn't here.");
    return await ctx.db.insert("followUps", { who: a.who.trim().slice(0, 120), about: a.about.trim().slice(0, 300), due: a.due, ...(a.note?.trim() ? { note: a.note.trim().slice(0, 1000) } : {}), ...(a.remind ? { remind: a.remind } : {}),
      ...((a.clientId ?? d?.clientId) ? { clientId: a.clientId ?? d!.clientId } : {}), ...(a.dealId ? { dealId: a.dealId } : {}), ...(a.email ? { email: a.email.trim().toLowerCase() } : {}),
      createdBy: me.name ?? me.email, createdAt: Date.now() });
  },
});

export const doneFollowUp = mutation({
  args: { followUpId: v.id("followUps"), confirm: v.optional(v.boolean()), remove: v.optional(v.boolean()) },
  handler: async (ctx, { followUpId, confirm, remove }) => {
    await ownerBiz(ctx);
    const f = await ctx.db.get(followUpId);
    if (!f) throw new ConvexError("That follow-up isn't here.");
    if (remove) await ctx.db.delete(followUpId);
    else if (confirm) await ctx.db.patch(followUpId, { draft: undefined });
    else await ctx.db.patch(followUpId, { doneAt: Date.now() });
    return null;
  },
});

// ---------- estimates ----------

const inputV = v.object({
  unit: v.union(v.literal("days"), v.literal("hours")), amount: v.number(), levels: v.optional(v.any()), extra: v.optional(v.any()),
  travelOver: v.optional(v.boolean()), travelDays: v.optional(v.number()), travelWaived: v.optional(v.boolean()),
});

export function toInput(r: Rates, i: { unit: "days" | "hours"; amount: number; levels?: Record<string, string>; extra?: Record<string, number>; travelOver?: boolean; travelDays?: number; travelWaived?: boolean }): EstimateInput {
  const k = primaryKind(r);
  const hours = i.unit === "days" ? Math.max(0, i.amount) * r.fullDayHours : Math.max(0, i.amount);
  return { base: k ? { [k.id]: hours } : {}, levels: i.levels ?? {}, extra: i.extra ?? {}, travelOver: !!i.travelOver, travelDays: i.travelDays ?? 1, travelWaived: !!i.travelWaived };
}

export const getEstimate = query({
  args: { estimateId: v.string() },
  handler: async (ctx, { estimateId }) => {
    await ownerBiz(ctx);
    const id = ctx.db.normalizeId("estimates", estimateId);
    const e = id ? await ctx.db.get(id) : null;
    if (!e) return null;
    const d = e.dealId ? await ctx.db.get(e.dealId) : null;
    const c = e.clientId ? await ctx.db.get(e.clientId) : null;
    return { ...e, deal: d ? { _id: d._id, title: d.title, stage: d.stage } : null, company: c?.name ?? d?.lead?.company ?? d?.lead?.name ?? null };
  },
});

/** Save estimate: the 12 lines from the business's rates; the card moves to Quoted (D60: forward only). A website
 *  lead's company and contact are made now, at its first estimate (D56). */
export const saveEstimate = mutation({
  args: { estimateId: v.optional(v.id("estimates")), dealId: v.optional(v.id("deals")), clientId: v.optional(v.id("clients")), projectId: v.optional(v.id("projects")), title: v.string(), scope: v.string(), input: inputV },
  handler: async (ctx, a) => {
    const { me, b } = await ownerBiz(ctx);
    const r = await ratesOf(ctx, b);
    if (ratesProblems(r).length || !primaryKind(r)) throw new ConvexError("Set your rates first (Settings › Estimate rates).");
    const title = a.title.trim() || "Estimate";
    const result = estimate(r, toInput(r, a.input as never));
    const now = Date.now();
    const by = me.name ?? me.email;
    // Review (Oct 31): every id from the call is read through the guard first, so another business's company,
    // project or estimate is refused rather than stored.
    if (a.clientId && !(await ctx.db.get(a.clientId))) throw new ConvexError("That company isn't here.");
    if (a.projectId && !(await ctx.db.get(a.projectId))) throw new ConvexError("That project isn't here.");
    const old = a.estimateId ? await ctx.db.get(a.estimateId) : null;
    if (a.estimateId && !old) throw new ConvexError("That estimate isn't here.");
    let dealId = a.dealId ?? old?.dealId ?? null;
    let clientId = a.clientId ?? old?.clientId ?? null;
    const projectId = a.projectId ?? old?.projectId ?? null;
    // One card per job: an estimate for a project that already has a card goes on that card.
    if (!dealId && projectId) dealId = (await ctx.db.query("deals").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect()).find((x) => !x.closedAt)?._id ?? null;
    if (dealId) {
      const d = await ctx.db.get(dealId);
      if (!d) throw new ConvexError("That card isn't here.");
      clientId = clientId ?? d.clientId ?? null;
      if (!clientId && d.lead) {
        // D56: the website lead's company and contact, made at the first estimate. Review (Oct 31): an existing
        // client is reused (the person's email, then the company's name), so nothing is doubled.
        const email = d.lead.email.toLowerCase();
        const byEmail = (await ctx.db.query("clientPeople").collect()).find((x) => !x.removedAt && x.email.toLowerCase() === email);
        const wanted = (d.lead.company || d.lead.name).trim().toLowerCase();
        const byName = (await ctx.db.query("clients").collect()).find((x) => x.name.trim().toLowerCase() === wanted);
        clientId = byEmail?.clientId ?? byName?._id ?? await ctx.db.insert("clients", { name: (d.lead.company || d.lead.name).slice(0, 120), createdAt: now });
        const there = (await ctx.db.query("clientPeople").withIndex("by_client", (q) => q.eq("clientId", clientId!)).collect()).some((x) => !x.removedAt && x.email.toLowerCase() === email);
        if (!there) await ctx.db.insert("clientPeople", { clientId, email, name: d.lead.name, role: "signer", createdAt: now });
        await ctx.db.patch(dealId, { clientId, contactEmail: email });
      }
    } else {
      dealId = await ctx.db.insert("deals", { title, ...(clientId ? { clientId } : {}), ...(projectId ? { projectId } : {}), stage: "quoted", source: "estimate", history: [{ kind: "created", at: now, by, detail: "from an estimate" }], createdAt: now, updatedAt: now });
    }
    const fields = { title, scope: a.scope.trim().slice(0, 2000), input: a.input, rates: r, result, ...(clientId ? { clientId } : {}), ...(projectId ? { projectId } : {}), dealId, updatedAt: now };
    let estimateId = a.estimateId ?? null;
    if (estimateId) await ctx.db.patch(estimateId, fields);
    else estimateId = await ctx.db.insert("estimates", { ...fields, createdAt: now });
    const d = (await ctx.db.get(dealId))!;
    await ctx.db.patch(dealId, { estimateId, valueCents: result.priceCents, ...(projectId && !d.projectId ? { projectId } : {}), updatedAt: now });
    await advanceDeal(ctx, (await ctx.db.get(dealId))!, "quoted", "estimate saved");
    return estimateId;
  },
});

export const contractTarget = internalQuery({
  args: { estimateId: v.id("estimates") },
  handler: async (ctx, { estimateId }) => {
    await ownerBiz(ctx);
    const e = await ctx.db.get(estimateId);
    if (!e) throw new ConvexError("That estimate isn't here.");
    const c = e.clientId ? await ctx.db.get(e.clientId) : null;
    const people = c ? (await ctx.db.query("clientPeople").withIndex("by_client", (q) => q.eq("clientId", c._id)).collect()).filter((p) => !p.removedAt) : [];
    const d = e.dealId ? await ctx.db.get(e.dealId) : null;
    const signer = people.find((p) => d?.contactEmail && p.email === d.contactEmail) ?? people.find((p) => p.role === "signer") ?? people[0];
    const project = e.projectId ? await ctx.db.get(e.projectId) : null;
    return { e, company: c?.name ?? "", signer: signer ? { name: signer.name ?? signer.email, email: signer.email } : null, project: project ? label(project) : e.title };
  },
});

export const linkBuild = internalMutation({
  args: { estimateId: v.id("estimates"), buildId: v.id("wsBuilds") },
  handler: async (ctx, { estimateId, buildId }) => { await ctx.db.patch(estimateId, { buildId, contractAt: Date.now(), contractClaimAt: undefined }); },
});

/** One Make contract draft at a time per estimate (a double click makes one draft). */
export const claimContract = internalMutation({
  args: { estimateId: v.id("estimates"), release: v.optional(v.boolean()) },
  handler: async (ctx, { estimateId, release }) => {
    await ownerBiz(ctx);
    const e = await ctx.db.get(estimateId);
    if (!e) throw new ConvexError("That estimate isn't here.");
    if (release) { await ctx.db.patch(estimateId, { contractClaimAt: undefined }); return null; }
    if (e.contractClaimAt && Date.now() - e.contractClaimAt < 60_000) throw new ConvexError("The contract draft is already being made. Give it a moment.");
    await ctx.db.patch(estimateId, { contractClaimAt: Date.now() });
    return null;
  },
});

/** Make contract draft in Sign: a builder draft from the Service Agreement template with the estimate's client-facing
 *  lines and the deposit. Nothing is sent; it goes to signing and out as every contract does (approve, then send). */
export const makeContract = action({
  args: { estimateId: v.id("estimates"), depositPercent: v.optional(v.number()) },
  handler: async (ctx, { estimateId, depositPercent = 25 }): Promise<{ buildId: Id<"wsBuilds">; kept?: "signing" }> => {
    const t = await ctx.runQuery(internal.crm.contractTarget, { estimateId });
    // Review (Oct 31): the draft carries the estimate's latest numbers. A draft that has already gone to signing is
    // never changed (it opens as it is); a draft still being edited gets the new lines and deposit; a deleted one is
    // made again.
    const existing = t.e.buildId ? await ctx.runQuery(internal.builder.buildInternal, { buildId: t.e.buildId }) : null;
    if (existing?.documentId) return { buildId: existing._id, kept: "signing" };
    if (existing && t.e.contractAt && t.e.contractAt >= t.e.updatedAt) return { buildId: existing._id };
    await ctx.runMutation(internal.crm.claimContract, { estimateId });
    try {
      const result = t.e.result as { lines: Array<{ name: string; unit: "hour" | "day"; qty: number; clientCents: number }>; discounts?: Array<{ name: string; cents: number }> };
      let buildId: Id<"wsBuilds">;
      if (existing) buildId = existing._id;
      else {
        const templates = await ctx.runQuery(internal.builder.templatesInternal, {});
        const tpl = templates.find((x) => /service agreement/i.test(x.name)) ?? null;
        if (!tpl) throw new ConvexError("There's no template named \"Service Agreement\" yet (Docs › Templates).");
        buildId = await ctx.runMutation(internal.builder.createBuildFor, { title: `${tpl.name} · ${t.company || t.e.title}`.slice(0, 120), page: tpl.page, templateId: tpl._id as Id<"wsTemplates"> });
      }
      await fillContract(ctx, buildId, t, result, depositPercent);
      await ctx.runMutation(internal.crm.linkBuild, { estimateId, buildId });
      return { buildId };
    } catch (err) {
      await ctx.runMutation(internal.crm.claimContract, { estimateId, release: true }).catch(() => null);
      throw err;
    }
  },
});

type Target = { e: Doc<"estimates">; company: string; signer: { name: string; email: string } | null; project: string };
async function fillContract(ctx: ActionCtx, buildId: Id<"wsBuilds">, t: Target, result: { lines: Array<{ name: string; unit: "hour" | "day"; qty: number; clientCents: number }>; discounts?: Array<{ name: string; cents: number }> }, depositPercent: number) {
    const b = (await ctx.runQuery(internal.builder.buildInternal, { buildId }))!;
    const r = applyArgs(b.fields as Fields, (b.signers as never) ?? [], b.page, {
      client: { name: t.signer?.name ?? "", email: t.signer?.email ?? "", company: t.company },
      project: t.project, date: todayIso(),
      // D88: a discount is its own line, so the contract's total is the estimate's price.
      line_items: [...result.lines.map((l) => ({ description: `${l.name}${l.unit === "hour" ? " (hours)" : " (days)"}`, qty: l.qty, rate: Math.round(l.clientCents / l.qty) / 100 })),
        ...(result.discounts ?? []).map((d) => ({ description: `Discount: ${d.name}`, qty: 1, rate: -d.cents / 100 }))],
      deposit_percent: Math.max(0, Math.min(100, depositPercent)),
    });
    await ctx.runMutation(internal.builder.patchBuild, { buildId, page: r.page, fields: r.fields, signers: r.signers });
}

// ---------- the job ledger ----------

type EstResult = { priceCents: number; expenseCents: number; netCents: number; lines: Array<{ kindId: string; name: string; qty: number; unit: "hour" | "day"; costCents: number }> };

/** Estimate vs actual for one job. The estimate's figures come from the rates saved with it; hours (or days) logged
 *  cost what the business's current rates say (the subcontractor cost picked, or every cost for that kind of work;
 *  the estimate's rates when the current ones no longer have it), the same rates the Log dialog checks against.
 *  Money logged as a cost counts as it is. The actual price is what was billed, less refunds, once the final invoice
 *  has gone out; until then the estimate's price, so a paid deposit doesn't read as a loss (build reading). */
async function ledgerCalc(ctx: QueryCtx, p: Doc<"projects">, current: Rates) {
  const deal = await ctx.db.query("deals").withIndex("by_project", (q) => q.eq("projectId", p._id)).first();
  const est = (await ctx.db.query("estimates").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()).sort((a, c) => c.updatedAt - a.updatedAt)[0]
    ?? (deal?.estimateId ? await ctx.db.get(deal.estimateId) : null);
  const er = est?.rates as Rates | undefined;
  const r = er ?? current; // the split the estimate was made with
  const e = est?.result as EstResult | undefined;
  const entries = (await ctx.db.query("ledgerEntries").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()).sort((a, c) => c.date.localeCompare(a.date) || c.createdAt - a.createdAt);
  const rate = (x: Doc<"ledgerEntries">) => {
    for (const rs of [current, er]) {
      if (!rs) continue;
      const c = x.costId ? rs.costs.find((y) => y.id === x.costId) : null;
      if (c) return c.cents;
      const all = rs.costs.filter((y) => y.kindId === x.workId);
      if (!x.costId && all.length) return all.reduce((t, y) => t + y.cents, 0);
    }
    return 0;
  };
  const entryCents = (x: Doc<"ledgerEntries">) => (x.kind === "cost" ? x.cents ?? 0 : Math.round((x.hours ?? 0) * rate(x)));
  const unpriced = (x: Doc<"ledgerEntries">) => x.kind === "hours" && rate(x) === 0;
  const real = entries.filter((x) => !x.draft);
  const allKinds = [...current.kinds, ...(er?.kinds ?? []).filter((k) => !current.kinds.some((c) => c.id === k.id))];
  const kinds = allKinds.map((k) => {
    const mine = real.filter((x) => x.kind === "hours" && x.workId === k.id);
    const line = e?.lines.find((l) => l.kindId === k.id);
    return { id: k.id, name: k.name, unit: k.unit, estQty: line?.qty ?? 0, actQty: Math.round(mine.reduce((t, x) => t + (x.hours ?? 0), 0) * 100) / 100,
      estCents: line?.costCents ?? 0, actCents: mine.reduce((t, x) => t + entryCents(x), 0) };
  });
  const otherCents = real.filter((x) => x.kind === "cost").reduce((t, x) => t + (x.cents ?? 0), 0);
  const invoices = (await ctx.db.query("invoices").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()).filter((i) => !["draft", "sending", "void"].includes(i.status));
  const billedCents = invoices.reduce((t, i) => t + i.totalCents - (i.refundedCents ?? 0), 0);
  const paidCents = invoices.reduce((t, i) => t + i.amountPaidCents - (i.refundedCents ?? 0), 0);
  const finalSent = invoices.some((i) => i.kind === "final");
  const estPrice = e?.priceCents ?? 0;
  const price = finalSent || !e ? billedCents : estPrice;
  const expense = kinds.reduce((t, k) => t + k.actCents, 0) + otherCents;
  const net = price - expense;
  const reserve = Math.round((net * r.reservePct) / 100);
  const estReserve = e ? Math.round((e.netCents * r.reservePct) / 100) : 0;
  return {
    r, current, est, entries, entryCents, unpriced, kinds, otherCents, billedCents, paidCents, finalSent,
    estimate: est && e ? { _id: est._id, title: est.title, priceCents: estPrice, expenseCents: e.expenseCents, netCents: e.netCents, reserveCents: estReserve, ownerCents: e.netCents - estReserve } : null,
    actual: { priceCents: price, billed: finalSent || !e, expenseCents: expense, netCents: net, reserveCents: reserve, ownerCents: net - reserve },
  };
}

export const ledger = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const { b } = await ownerBiz(ctx);
    const id = ctx.db.normalizeId("projects", projectId);
    const p = id ? await ctx.db.get(id) : null;
    if (!p) return null;
    const L = await ledgerCalc(ctx, p, await ratesOf(ctx, b));
    const exported = (await ctx.db.query("projects").collect()).filter((x) => x.ledgerExportedAt).length;
    return {
      project: { _id: p._id, label: label(p), clientId: p.clientId ?? null }, exportedAt: p.ledgerExportedAt ?? null, exportedJobs: exported,
      reservePct: L.r.reservePct, kinds: L.kinds, otherCents: L.otherCents, billedCents: L.billedCents, paidCents: L.paidCents, finalSent: L.finalSent,
      estimate: L.estimate, actual: L.actual,
      logKinds: L.current.kinds.map((k) => ({ id: k.id, name: k.name, unit: k.unit })),
      costs: L.current.costs.map((c) => ({ id: c.id, name: c.name, kindId: c.kindId, cents: c.cents })),
      entries: L.entries.map((x) => ({ _id: x._id, kind: x.kind, workId: x.workId ?? null, work: L.kinds.find((k) => k.id === x.workId)?.name ?? null,
        unit: L.kinds.find((k) => k.id === x.workId)?.unit ?? "hour", cost: [...L.current.costs, ...((L.est?.rates as Rates | undefined)?.costs ?? [])].find((c) => c.id === x.costId)?.name ?? null,
        unpriced: L.unpriced(x), hours: x.hours ?? null, cents: L.entryCents(x), who: x.who ?? null, note: x.note ?? null, date: x.date, draft: !!x.draft, createdBy: x.createdBy ?? null })),
    };
  },
});

export const logEntry = mutation({
  args: { projectId: v.id("projects"), kind: v.union(v.literal("hours"), v.literal("cost")), workId: v.optional(v.string()), costId: v.optional(v.string()), hours: v.optional(v.number()), cents: v.optional(v.number()), who: v.optional(v.string()), note: v.optional(v.string()), date: v.string() },
  handler: async (ctx, a) => {
    const { me } = await ownerBiz(ctx);
    if (!(await ctx.db.get(a.projectId))) throw new ConvexError("That project isn't here.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date)) throw new ConvexError("Pick a date.");
    if (a.kind === "hours" && !(Number(a.hours) > 0 && Number(a.hours) <= 500)) throw new ConvexError("Hours must be more than 0.");
    const { b } = await ownerBiz(ctx);
    const rr = await ratesOf(ctx, b);
    if (a.kind === "hours" && !rr.kinds.some((k) => k.id === a.workId)) throw new ConvexError("Pick a kind of work.");
    if (a.workId && !rr.kinds.some((k) => k.id === a.workId)) throw new ConvexError("That kind of work isn't in your rates.");
    if (a.costId && !rr.costs.some((c) => c.id === a.costId && c.kindId === a.workId)) throw new ConvexError("Pick a cost for that kind of work.");
    if (a.kind === "cost" && !(Number.isInteger(a.cents) && a.cents! > 0)) throw new ConvexError("The cost must be more than $0.");
    return await ctx.db.insert("ledgerEntries", { projectId: a.projectId, kind: a.kind, ...(a.workId ? { workId: a.workId } : {}), ...(a.kind === "hours" && a.costId ? { costId: a.costId } : {}), ...(a.kind === "hours" ? { hours: a.hours } : { cents: a.cents }),
      ...(a.who?.trim() ? { who: a.who.trim().slice(0, 80) } : {}), ...(a.note?.trim() ? { note: a.note.trim().slice(0, 300) } : {}), date: a.date, createdBy: me.name ?? me.email, createdAt: Date.now() });
  },
});

export const entryAction = mutation({
  args: { entryId: v.id("ledgerEntries"), action: v.union(v.literal("confirm"), v.literal("remove")) },
  handler: async (ctx, { entryId, action: what }) => {
    await ownerBiz(ctx);
    if (!(await ctx.db.get(entryId))) throw new ConvexError("That entry isn't here.");
    if (what === "remove") await ctx.db.delete(entryId); else await ctx.db.patch(entryId, { draft: undefined });
    return null;
  },
});

/** Export to Google Sheet (D58): include this project's ledger in the Settings Sheet's "Job ledger" tab. */
export const setLedgerExport = mutation({
  args: { projectId: v.id("projects"), on: v.boolean() },
  handler: async (ctx, { projectId, on }) => {
    await ownerBiz(ctx);
    if (!(await ctx.db.get(projectId))) throw new ConvexError("That project isn't here.");
    await ctx.db.patch(projectId, { ledgerExportedAt: on ? Date.now() : undefined });
    return null;
  },
});

/** Export every job with an estimate (the Export dialog without "Only this job"). */
export const setLedgerExportAll = mutation({
  args: {},
  handler: async (ctx) => {
    await ownerBiz(ctx);
    const ids = new Set((await ctx.db.query("estimates").collect()).flatMap((e) => (e.projectId ? [e.projectId] : [])));
    for (const d of await ctx.db.query("deals").collect()) if (d.projectId && d.estimateId) ids.add(d.projectId);
    const now = Date.now();
    let n = 0;
    for (const id of ids) { if (await ctx.db.get(id)) { await ctx.db.patch(id, { ledgerExportedAt: now }); n++; } }
    return n;
  },
});

/** The "Job ledger" tab: one row per exported project (read by the Sheet feed with the business's sheet key). */
export const ledgerRows = internalQuery({
  args: {},
  handler: async (ctx) => {
    const out = [];
    const biz = businessInScope(ctx);
    const b = biz ? await ctx.db.get(biz) : null;
    const fallback = b ? await ratesOf(ctx, b) : WRANGLER_RATES;
    for (const p of (await ctx.db.query("projects").collect()).filter((x) => x.ledgerExportedAt)) {
      const L = await ledgerCalc(ctx, p, fallback);
      const usd = (c: number) => Math.round(c) / 100;
      out.push({ "Project": label(p), "Estimate price": usd(L.estimate?.priceCents ?? 0), "Estimated expenses": usd(L.estimate?.expenseCents ?? 0), "Estimated profit": usd(L.estimate?.netCents ?? 0),
        ...Object.fromEntries(L.kinds.map((k) => [`${k.name} ${k.unit === "day" ? "days" : "hours"}`, k.actQty])),
        "Billed": usd(L.billedCents), "Paid": usd(L.paidCents),
        "Actual expenses": usd(L.actual.expenseCents), "Actual profit": usd(L.actual.netCents), [`Reserve ${L.r.reservePct}%`]: usd(L.actual.reserveCents), [`Owner ${100 - L.r.reservePct}%`]: usd(L.actual.ownerCents),
        "Exported": new Date(p.ledgerExportedAt!).toISOString().slice(0, 10) });
    }
    return out;
  },
});

// ---------- Home: follow-ups due ----------

export const due = query({
  args: {},
  handler: async (ctx) => {
    await ownerBiz(ctx);
    const today = todayIso();
    const tomorrow = new Date(Date.parse(today + "T12:00:00Z") + 86_400_000).toISOString().slice(0, 10);
    return (await ctx.db.query("followUps").collect()).filter((f) => !f.doneAt && !f.draft && (f.due <= today || (f.remind === "day_before" && f.due === tomorrow))).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 6).map((f) => ({ _id: f._id, who: f.who, about: f.about, due: f.due, overdue: f.due < today }));
  },
});

// ---------- the Claude connector (D67): reads, and drafts that do nothing until Heston confirms on the site ----------

export const followUpsAs = internalQuery({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days = 7 }) => {
    const today = todayIso();
    const until = new Date(Date.parse(`${today}T12:00:00Z`) + Math.max(0, Math.min(60, days)) * 86_400_000).toISOString().slice(0, 10);
    const out = [];
    for (const f of (await ctx.db.query("followUps").collect()).filter((x) => !x.doneAt && x.due <= until).sort((a, b) => a.due.localeCompare(b.due))) {
      const c = f.clientId ? await ctx.db.get(f.clientId) : null;
      out.push({ who: f.who, company: c?.name ?? null, about: f.about, due: f.due, overdue: f.due < today, draft: !!f.draft, note: f.note ?? null });
    }
    return { today, followUps: out };
  },
});

export const findProjectAs = internalQuery({
  args: { project: v.string() },
  handler: async (ctx, { project }) => {
    const q = project.trim().toLowerCase();
    const all = await ctx.db.query("projects").collect();
    const hits = all.filter((p) => (p.jobNumber && p.jobNumber.toLowerCase() === q) || label(p).toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
    if (hits.length === 1) return { projectId: hits[0]._id, label: label(hits[0]) };
    return { error: hits.length ? `${hits.length} projects match: ${hits.slice(0, 8).map(label).join(", ")}.` : `No project matches "${project}".` };
  },
});

export const draftLedgerAs = internalMutation({
  args: { projectId: v.id("projects"), kind: v.union(v.literal("hours"), v.literal("cost")), work: v.optional(v.string()), hours: v.optional(v.number()), cents: v.optional(v.number()), who: v.optional(v.string()), note: v.optional(v.string()), date: v.string() },
  handler: async (ctx, a) => {
    const p = await ctx.db.get(a.projectId);
    if (!p) throw new ConvexError("That project isn't here.");
    const b = p.businessId ? await ctx.db.get(p.businessId) : await defaultBusiness(ctx);
    const r = b ? await ratesOf(ctx, b) : WRANGLER_RATES;
    const work = a.work ? r.kinds.find((k) => k.name.toLowerCase() === a.work!.trim().toLowerCase() || k.id === a.work) : null;
    if (a.work && !work) throw new ConvexError(`No kind of work called "${a.work}". Kinds: ${r.kinds.map((k) => k.name).join(", ")}.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date)) throw new ConvexError("date must be yyyy-mm-dd.");
    if (a.kind === "hours" && !(Number(a.hours) > 0 && Number(a.hours) <= 500)) throw new ConvexError("hours must be more than 0.");
    if (a.kind === "hours" && !work) throw new ConvexError(`Hours need a kind of work (work). Kinds: ${r.kinds.map((k) => k.name).join(", ")}.`);
    if (a.kind === "cost" && !(Number.isInteger(a.cents) && a.cents! > 0)) throw new ConvexError("cost must be more than $0.");
    const id = await ctx.db.insert("ledgerEntries", { projectId: a.projectId, kind: a.kind, ...(work ? { workId: work.id } : {}), ...(a.kind === "hours" ? { hours: a.hours } : { cents: a.cents }),
      ...(a.who ? { who: a.who.slice(0, 80) } : {}), ...(a.note ? { note: a.note.slice(0, 300) } : {}), date: a.date, draft: true, createdBy: "Claude", createdAt: Date.now() });
    return { entryId: id, project: label(p) };
  },
});

export const draftFollowUpAs = internalMutation({
  args: { who: v.string(), about: v.string(), due: v.string(), company: v.optional(v.string()), note: v.optional(v.string()) },
  handler: async (ctx, a) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.due)) throw new ConvexError("due must be yyyy-mm-dd.");
    const c = a.company ? (await ctx.db.query("clients").collect()).find((x) => x.name.toLowerCase() === a.company!.trim().toLowerCase()) : null;
    const id = await ctx.db.insert("followUps", { who: a.who.slice(0, 120), about: a.about.slice(0, 300), due: a.due, ...(c ? { clientId: c._id } : {}), ...(a.note ? { note: a.note.slice(0, 1000) } : {}), draft: true, createdBy: "Claude", createdAt: Date.now() });
    return { followUpId: id, company: c?.name ?? null };
  },
});
