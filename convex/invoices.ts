// Phase 2 Part B, step 2 (D45, D46): invoices, owner side. A draft lives only in the portal. Send is the owner's
// confirm (D46: nothing sends without it): the portal then makes the invoice in the business's own Stripe account
// (its connected account), gives it the business's next number (D52) and finalizes it. Stripe holds the money from
// then on; the Connect webhook keeps this copy in step. The client's page, Pay and the email: invoicePay.ts.
import { action } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe } from "./lib/access";
import { businessInScope } from "./lib/business";
import { invoicePrefix } from "./lib/invoiceNumber";
import { stripeCall, StripeError, type StripeResult } from "./lib/stripeApi";
import { clientDocs, openDelivery } from "./projects";
import { pageOf, totals as builderTotals } from "./lib/wsBuilder";
import { announceSent } from "./invoicePay";
import { nextReminder } from "./invoiceReminders";
import { crmProject } from "./crm";

const DAY = 86_400_000;
const MIN_CENTS = 50; // Stripe's smallest card charge in USD
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const label = (p: { name: string; jobNumber?: string }) => (p.jobNumber ? `${p.jobNumber} ${p.name}` : p.name);

function ownBusiness(ctx: unknown): Id<"businesses"> {
  const id = businessInScope(ctx);
  if (!id) throw new ConvexError("Not allowed.");
  return id;
}

/** Subtotal, discount, tax and total, in cents. Tax applies after the discount. */
export function totals(i: { lines: Array<{ qty: number; unitCents: number }>; discountCents?: number; taxPercent?: number }) {
  const subtotal = i.lines.reduce((s, l) => s + Math.round(l.qty * l.unitCents), 0);
  const discount = Math.min(Math.max(0, i.discountCents ?? 0), subtotal);
  // Stripe works tax out on each line (the discount is its own negative line) and rounds each, so the portal does too.
  const pct = Math.max(0, i.taxPercent ?? 0) / 100;
  const tax = pct ? i.lines.reduce((t, l) => t + Math.round(Math.round(l.qty * l.unitCents) * pct), 0) - (discount ? Math.round(discount * pct) : 0) : 0;
  return { subtotal, discount, tax, total: subtotal - discount + tax };
}

/** What the lists and chips show: Draft, Due, Overdue, Partly paid, Processing, Payment failed, Paid, Void… */
export function displayStatus(i: Doc<"invoices">, now = Date.now()) {
  if (i.status === "draft") return "draft" as const;
  if (i.status === "sending") return "sending" as const;
  if (i.status === "paid") return "paid" as const;
  if (i.status === "void") return "void" as const;
  if (i.status === "uncollectible") return "uncollectible" as const;
  if (i.processing) return "processing" as const;
  if (i.lastFailure && (!i.paidAt || i.lastFailure.at > i.paidAt)) return "failed" as const;
  if (i.amountPaidCents > 0) return "partly_paid" as const;
  return new Date(`${i.dueDate}T23:59:59`).getTime() < now ? ("overdue" as const) : ("due" as const);
}

async function rowOf(ctx: QueryCtx, i: Doc<"invoices">) {
  const client = i.clientId ? await ctx.db.get(i.clientId) : null;
  const project = i.projectId ? await ctx.db.get(i.projectId) : null;
  return {
    _id: i._id, kind: i.kind, title: i.title, number: i.number ?? i.stripe?.number ?? null, status: displayStatus(i),
    client: client ? { _id: client._id, name: client.name } : null, project: project ? { _id: project._id, label: label(project) } : null,
    billTo: i.billTo, dueDate: i.dueDate, totalCents: i.totalCents, amountPaidCents: i.amountPaidCents, amountRemainingCents: i.amountRemainingCents,
    sentAt: i.sentAt ?? null, viewedAt: i.viewedAt ?? null, paidAt: i.paidAt ?? null, createdAt: i.createdAt, updatedAt: i.updatedAt,
    lastFailure: i.lastFailure ?? null, sendError: i.sendError ?? null,
  };
}

// ---------- reading ----------

/** Payments › Invoices: every invoice in the business, newest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const rows = await ctx.db.query("invoices").withIndex("by_updated").order("desc").take(500);
    return Promise.all(rows.map((i) => rowOf(ctx, i)));
  },
});

/** Payments › Overview (frames 281:8360 …): the four numbers, what needs the owner, paid totals and recent activity.
 *  Amounts are what Stripe reported (the portal's copy); refunds are taken off what was paid. */
export const overview = query({
  args: { tzOffsetMin: v.optional(v.number()) },
  handler: async (ctx, { tzOffsetMin = 0 }) => {
    await requireMe(ctx);
    const biz = await ctx.db.get(ownBusiness(ctx));
    const all = await ctx.db.query("invoices").withIndex("by_updated").order("desc").take(1000);
    const now = Date.now();
    // Month and year boundaries in the owner's own time zone (the page passes its offset).
    const local = new Date(now - tzOffsetMin * 60_000);
    const startOf = (y: number, m: number) => Date.UTC(y, m, 1) + tzOffsetMin * 60_000;
    const thisMonth = startOf(local.getUTCFullYear(), local.getUTCMonth());
    const lastMonth = startOf(local.getUTCFullYear(), local.getUTCMonth() - 1);
    const thisYear = startOf(local.getUTCFullYear(), 0);
    const sum = { due: 0, dueN: 0, overdue: 0, overdueN: 0, way: 0, wayN: 0, month: 0, year: 0, last: 0 };
    const needs: Array<{ _id: string; kind: "draft" | "failed"; title: string; client: string | null; at: number; cents: number; detail: string }> = [];
    const activity: Array<{ invoiceId: string; kind: string; at: number; title: string; meta: string }> = [];
    const clientName = new Map<string, string | null>();
    const nameOf = async (i: Doc<"invoices">) => {
      if (!i.clientId) return i.billTo.company ?? i.billTo.name ?? null;
      if (!clientName.has(i.clientId)) clientName.set(i.clientId, (await ctx.db.get(i.clientId))?.name ?? null);
      return clientName.get(i.clientId) ?? null;
    };
    const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    for (const i of all) {
      const st = displayStatus(i, now);
      const client = await nameOf(i);
      if (st === "due" || st === "partly_paid" || st === "failed") { sum.due += i.amountRemainingCents; sum.dueN++; }
      if (st === "overdue") { sum.overdue += i.amountRemainingCents; sum.overdueN++; }
      if (st === "processing") { sum.way += (i.payments ?? []).filter((p) => p.status === "processing").reduce((t, p) => t + p.cents, 0) || i.amountRemainingCents; sum.wayN++; }
      // Paid: each payment on the day it was paid, less what was refunded; an invoice paid before the portal kept
      // payments counts its amount paid on the day it was paid.
      const paid = (i.payments ?? []).filter((p) => p.status === "paid");
      const parts = paid.length ? paid.map((p) => ({ at: p.at, cents: p.cents - (p.refundedCents ?? 0) })) : i.amountPaidCents > 0 ? [{ at: i.paidAt ?? i.updatedAt, cents: i.amountPaidCents - (i.refundedCents ?? 0) }] : [];
      for (const p of parts) {
        if (p.at >= thisMonth) sum.month += p.cents;
        if (p.at >= thisYear) sum.year += p.cents;
        if (p.at >= lastMonth && p.at < thisMonth) sum.last += p.cents;
      }
      if (st === "draft") needs.push({ _id: i._id, kind: "draft", title: i.title, client, at: i.createdAt, cents: i.totalCents, detail: "Draft" });
      if (st === "failed") needs.push({ _id: i._id, kind: "failed", title: i.title, client, at: i.lastFailure?.at ?? i.updatedAt, cents: i.amountRemainingCents, detail: /declin/i.test(i.lastFailure?.message ?? "") ? "Card declined" : "Payment failed" });
      const number = i.number ?? i.stripe?.number ?? "";
      for (const h of i.history) {
        const meta = (extra?: string | null) => [client, number || null, extra ?? null].filter(Boolean).join(" · ");
        if (h.kind === "paid" || h.kind === "part_paid") {
          const p = [...paid].reverse().find((x) => Math.abs(x.at - h.at) < 3 * 86_400_000);
          activity.push({ invoiceId: i._id, kind: "paid", at: h.at, title: `Payment received · ${usd(p?.cents ?? (h.kind === "paid" ? i.totalCents : i.amountPaidCents))}`, meta: meta(p?.method) });
        } else if (h.kind === "viewed") activity.push({ invoiceId: i._id, kind: "viewed", at: h.at, title: "Invoice viewed", meta: meta() });
        else if (h.kind === "sent") activity.push({ invoiceId: i._id, kind: "sent", at: h.at, title: "Invoice sent", meta: meta() });
        else if (h.kind === "processing") activity.push({ invoiceId: i._id, kind: "processing", at: h.at, title: "Bank payment started", meta: meta() });
        else if (h.kind === "failed") activity.push({ invoiceId: i._id, kind: "failed", at: h.at, title: "Payment failed", meta: meta() });
        else if (h.kind === "refunded") activity.push({ invoiceId: i._id, kind: "refunded", at: h.at, title: h.detail ?? "Refunded", meta: meta() });
      }
    }
    activity.sort((a, b) => b.at - a.at);
    needs.sort((a, b) => (a.kind === b.kind ? b.at - a.at : a.kind === "draft" ? -1 : 1));
    return {
      stripe: biz?.stripe ? biz.stripe.status : null, invoices: all.length,
      due: { cents: sum.due, n: sum.dueN }, overdue: { cents: sum.overdue, n: sum.overdueN }, onItsWay: { cents: sum.way, n: sum.wayN },
      paid: { month: sum.month, year: sum.year, lastMonth: sum.last },
      needs: needs.slice(0, 8), activity: activity.slice(0, 6),
    };
  },
});

/** A project's Invoices tab. */
export const forProject = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    await requireMe(ctx);
    const id = ctx.db.normalizeId("projects", projectId);
    if (!id) return [];
    const rows = await ctx.db.query("invoices").withIndex("by_project", (q) => q.eq("projectId", id)).collect();
    return Promise.all(rows.sort((a, b) => a.createdAt - b.createdAt).map((i) => rowOf(ctx, i)));
  },
});

/** One invoice, with everything its page and the live preview need. */
export const get = query({
  args: { invoiceId: v.string() },
  handler: async (ctx, { invoiceId }) => {
    await requireMe(ctx);
    const id = ctx.db.normalizeId("invoices", invoiceId);
    const i = id ? await ctx.db.get(id) : null;
    if (!i) return null;
    const biz = await ctx.db.get(ownBusiness(ctx));
    return {
      ...(await rowOf(ctx, i)),
      lines: i.lines, discountCents: i.discountCents ?? 0, taxPercent: i.taxPercent ?? 0, memo: i.memo ?? "", totals: totals(i),
      clientId: i.clientId ?? null, projectId: i.projectId ?? null, history: i.history, refundedCents: i.refundedCents ?? 0, disputed: i.disputed ?? null,
      stripe: i.stripe ? { invoiceId: i.stripe.invoiceId, hostedUrl: i.stripe.hostedUrl ?? null, pdfUrl: i.stripe.pdfUrl ?? null, livemode: i.stripe.livemode } : null,
      business: biz ? {
        name: biz.name, legalName: biz.legalName ?? null, prefix: invoicePrefix(biz.name), email: biz.replyTo ?? null, address: biz.address ?? null, privacyUrl: biz.privacyUrl ?? null,
        logoUrl: biz.logoFileId ? await ctx.storage.getUrl(biz.logoFileId) : null, logoLightUrl: biz.logoLightFileId ? await ctx.storage.getUrl(biz.logoLightFileId) : null,
      } : null,
      payToken: i.payToken ?? null, payments: (i.payments ?? []).filter((p) => p.status !== "failed"),
      // Step 4: "Last reminder: … · next: … (automatic)" under the actions.
      reminders: {
        last: (i.reminders ?? []).length ? Math.max(...(i.reminders ?? []).map((r) => r.at)) : null,
        next: biz?.stripe?.status === "connected" && i.payToken ? nextReminder(i, biz.reminders)?.at ?? null : null,
        auto: !!biz?.reminders?.on,
        canSend: i.status === "open" && !i.processing && i.amountRemainingCents > 0,
      },
    };
  },
});

/** The New invoice form: clients with their people and projects, and whether Stripe is ready. */
export const options = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const biz = await ctx.db.get(ownBusiness(ctx));
    const clients = await ctx.db.query("clients").collect();
    const projects = await ctx.db.query("projects").collect();
    const out = [];
    for (const c of clients.sort((a, b) => a.name.localeCompare(b.name))) {
      const people = (await ctx.db.query("clientPeople").withIndex("by_client", (q) => q.eq("clientId", c._id)).collect()).filter((p) => !p.removedAt);
      out.push({
        _id: c._id, name: c.name,
        people: people.map((p) => ({ name: p.name ?? p.email, email: p.email, role: p.role })),
        projects: projects.filter((p) => p.clientId === c._id).sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)).map((p) => ({ _id: p._id, label: label(p) })),
      });
    }
    return {
      clients: out,
      business: biz ? { name: biz.name, legalName: biz.legalName ?? null, prefix: invoicePrefix(biz.name), logoUrl: biz.logoFileId ? await ctx.storage.getUrl(biz.logoFileId) : null } : null,
      nextNumber: biz ? `${invoicePrefix(biz.name)}-${String(((await ctx.db.query("counters").withIndex("by_key", (q) => q.eq("key", "invoiceSeq")).first())?.value ?? 0) + 1).padStart(4, "0")}` : null,
      stripeReady: biz?.stripe?.status === "connected",
    };
  },
});

// ---------- drafts ----------

const lineArg = v.object({ id: v.string(), description: v.string(), qty: v.number(), unitCents: v.number() });
const draftArgs = {
  clientId: v.optional(v.string()), projectId: v.optional(v.string()),
  kind: v.union(v.literal("deposit"), v.literal("final"), v.literal("other")), title: v.string(),
  billTo: v.object({ name: v.string(), email: v.string(), company: v.optional(v.string()) }),
  lines: v.array(lineArg), discountCents: v.optional(v.number()), taxPercent: v.optional(v.number()),
  dueDate: v.string(), memo: v.optional(v.string()),
};

function cleanDraft(a: { title: string; billTo: { name: string; email: string; company?: string }; lines: Array<{ id: string; description: string; qty: number; unitCents: number }>; discountCents?: number; taxPercent?: number; dueDate: string; memo?: string }) {
  const lines = a.lines.slice(0, 50).map((l) => ({
    id: l.id.slice(0, 40) || Math.random().toString(36).slice(2, 10),
    description: l.description.trim().slice(0, 300),
    qty: Math.max(0, Math.min(10_000, Math.round(l.qty * 100) / 100)),
    unitCents: Math.max(0, Math.min(100_000_000, Math.round(l.unitCents))),
  }));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.dueDate)) throw new ConvexError("Pick a due date.");
  return {
    title: a.title.trim().slice(0, 120) || "Invoice",
    billTo: { name: a.billTo.name.trim().slice(0, 120), email: a.billTo.email.trim().toLowerCase().slice(0, 200), ...(a.billTo.company ? { company: a.billTo.company.trim().slice(0, 120) } : {}) },
    lines,
    discountCents: a.discountCents ? Math.max(0, Math.round(a.discountCents)) : undefined,
    taxPercent: a.taxPercent ? Math.max(0, Math.min(30, Math.round(a.taxPercent * 1000) / 1000)) : undefined,
    dueDate: a.dueDate,
    memo: a.memo?.trim().slice(0, 1000) || undefined,
  };
}

/** Save draft: makes or updates a draft. Only drafts change; once sent, Stripe holds it. */
export const saveDraft = mutation({
  args: { invoiceId: v.optional(v.string()), ...draftArgs },
  handler: async (ctx, a) => {
    const me = await requireMe(ctx);
    const clientId = a.clientId ? ctx.db.normalizeId("clients", a.clientId) : null;
    const projectId = a.projectId ? ctx.db.normalizeId("projects", a.projectId) : null;
    if (a.clientId && !(clientId && (await ctx.db.get(clientId)))) throw new ConvexError("That client isn't here.");
    if (a.projectId && !(projectId && (await ctx.db.get(projectId)))) throw new ConvexError("That project isn't here.");
    const d = cleanDraft(a);
    const t = totals(d);
    const now = Date.now();
    const fields = { ...d, kind: a.kind, clientId: clientId ?? undefined, projectId: projectId ?? undefined, totalCents: t.total, amountRemainingCents: t.total, updatedAt: now };
    if (a.invoiceId) {
      const id = ctx.db.normalizeId("invoices", a.invoiceId);
      const i = id ? await ctx.db.get(id) : null;
      if (!i) throw new ConvexError("That invoice isn't here.");
      if (i.status !== "draft") throw new ConvexError("Only drafts can change. This one has been sent.");
      await ctx.db.patch(i._id, { ...fields, sendError: undefined });
      return i._id;
    }
    return await ctx.db.insert("invoices", {
      ...fields, status: "draft", amountPaidCents: 0, createdAt: now, createdBy: me.name ?? me.email,
      history: [{ kind: "created", at: now, by: me.name ?? me.email }],
    });
  },
});

export const deleteDraft = mutation({
  args: { invoiceId: v.string() },
  handler: async (ctx, { invoiceId }) => {
    await requireMe(ctx);
    const id = ctx.db.normalizeId("invoices", invoiceId);
    const i = id ? await ctx.db.get(id) : null;
    if (!i) return null;
    if (i.status !== "draft") throw new ConvexError("Only a draft can be deleted. Void a sent invoice instead.");
    await ctx.db.delete(i._id);
    return null;
  },
});

// ---------- sending (D46: the owner's confirm) ----------

/** Checks a draft can go out, marks it as sending (so a double press can't send twice) and gives it its number. */
export const claimForSend = internalMutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    const me = await requireMe(ctx);
    const i = await ctx.db.get(invoiceId);
    if (!i) throw new ConvexError("That invoice isn't here.");
    // A send that stopped partway (more than 5 minutes in "sending") can be tried again; send() then checks what's in Stripe.
    const stuck = i.status === "sending" && Date.now() - i.updatedAt > 5 * 60_000;
    if (i.status !== "draft" && !stuck) throw new ConvexError(i.status === "sending" ? "It's already being sent." : "This invoice has already been sent.");
    const biz = await ctx.db.get(ownBusiness(ctx));
    if (!biz?.stripe || biz.stripe.status !== "connected") throw new ConvexError("Connect Stripe first (Settings › Payments).");
    if (!i.lines.length || i.lines.some((l) => !l.description)) throw new ConvexError("Every line needs a description.");
    if (!EMAIL.test(i.billTo.email)) throw new ConvexError("The bill-to email doesn't look right.");
    const t = totals(i);
    if (t.total < MIN_CENTS) throw new ConvexError("The total must be at least $0.50.");
    if (dueMoment(i.dueDate) < Date.now() + 10 * 60_000) throw new ConvexError("The due date has passed. Pick a later one.");
    // D52: the business's next number, kept if a send fails and is tried again.
    let number = i.number;
    if (!number) {
      const key = "invoiceSeq";
      const row = await ctx.db.query("counters").withIndex("by_key", (q) => q.eq("key", key)).first();
      const next = (row?.value ?? 0) + 1;
      if (row) await ctx.db.patch(row._id, { value: next }); else await ctx.db.insert("counters", { key, value: next });
      number = `${invoicePrefix(biz.name)}-${String(next).padStart(4, "0")}`;
    }
    const attempt = (i.sendAttempt ?? 0) + 1;
    await ctx.db.patch(i._id, { status: "sending", number, totalCents: t.total, amountRemainingCents: t.total, sendError: undefined, sendAttempt: attempt, updatedAt: Date.now() });
    const earlier = (await ctx.db.query("invoices").withIndex("by_bill_email", (q) => q.eq("billTo.email", i.billTo.email)).collect()).find((x) => x.stripe?.accountId === biz.stripe!.accountId && x.stripe?.customerId);
    return { invoice: { ...i, number }, totals: t, accountId: biz.stripe.accountId, customerId: i.pending?.customerId ?? earlier?.stripe?.customerId ?? null, pending: i.pending ?? null, attempt, by: me.name ?? me.email, business: biz.name };
  },
});

export const recordSent = internalMutation({
  args: { invoiceId: v.id("invoices"), stripe: v.any(), by: v.string() },
  handler: async (ctx, { invoiceId, stripe, by }) => {
    const i = await ctx.db.get(invoiceId);
    if (!i) return;
    const s = stripe as { accountId: string; customerId: string; invoice: StripeResult };
    const now = Date.now();
    await ctx.db.patch(invoiceId, {
      status: s.invoice.status === "paid" ? "paid" : "open",
      stripe: { accountId: s.accountId, invoiceId: s.invoice.id, customerId: s.customerId, number: s.invoice.number ?? i.number, hostedUrl: s.invoice.hosted_invoice_url ?? undefined, pdfUrl: s.invoice.invoice_pdf ?? undefined, livemode: !!s.invoice.livemode },
      totalCents: Number(s.invoice.total ?? i.totalCents), amountPaidCents: Number(s.invoice.amount_paid ?? 0), amountRemainingCents: Number(s.invoice.amount_remaining ?? s.invoice.total ?? i.totalCents),
      sentAt: now, updatedAt: now,
      history: [...i.history, { kind: "sent", at: now, by, detail: i.billTo.email }],
    });
    // Step 3: the client's link, their Inbox item and the invoice email (08).
    const sent = await ctx.db.get(invoiceId);
    if (sent && sent.status === "open") await announceSent(ctx, sent);
  },
});

/** What a send has made in Stripe so far (so a failure can clean up and a retry can pick up). */
export const recordPending = internalMutation({
  args: { invoiceId: v.id("invoices"), pending: v.object({ customerId: v.optional(v.string()), draftId: v.optional(v.string()), taxRateId: v.optional(v.string()) }) },
  handler: async (ctx, { invoiceId, pending }) => {
    const i = await ctx.db.get(invoiceId);
    if (i) await ctx.db.patch(invoiceId, { pending: { ...(i.pending ?? {}), ...pending }, updatedAt: Date.now() });
    return null;
  },
});

export const recordSendFailed = internalMutation({
  args: { invoiceId: v.id("invoices"), message: v.string() },
  handler: async (ctx, { invoiceId, message }) => {
    const i = await ctx.db.get(invoiceId);
    if (i?.status === "sending") await ctx.db.patch(invoiceId, { status: "draft", sendError: message.slice(0, 300), pending: i.pending?.customerId ? { customerId: i.pending.customerId } : undefined, updatedAt: Date.now() });
  },
});

/** Send (after the owner confirms in the dialog): makes the invoice in the business's Stripe account and finalizes it.
 *  Stripe's own emails stay off: the portal sends its own (email 08, from recordSent). */
export const send = action({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }): Promise<{ number: string }> => {
    const c = await ctx.runQuery(internal.invoices.sendGuard, { invoiceId }).then(() => ctx.runMutation(internal.invoices.claimForSend, { invoiceId }));
    const i = c.invoice as Doc<"invoices"> & { number: string };
    const account = c.accountId as string;
    const meta = { portal_invoice: invoiceId, portal_business: i.businessId ?? "" };
    const k = (what: string) => `wp-${what}-${invoiceId}-a${c.attempt}`; // a new attempt never replays an old one
    let finalized: StripeResult | null = null;
    let customerId: string | null = c.customerId as string | null;
    let draftId: string | null = (c.pending as { draftId?: string } | null)?.draftId ?? null;
    try {
      // A send that stopped partway: Stripe may already hold it (even finalized). Pick that up instead of starting over.
      if (draftId) {
        const prev = await stripeCall("GET", `invoices/${draftId}`, { account }).catch(() => null);
        if (prev && prev.status && prev.status !== "draft" && prev.status !== "void") finalized = prev;
        else if (prev?.status === "draft") { await stripeCall("DELETE", `invoices/${draftId}`, { account }).catch(() => null); draftId = null; }
        else draftId = null;
      }
      if (!finalized) {
        customerId = customerId ?? (await stripeCall("POST", "customers", {
          account, idem: k("cust"),
          form: { name: i.billTo.company ? `${i.billTo.name} (${i.billTo.company})` : i.billTo.name, email: i.billTo.email, metadata: meta },
        })).id as string;
        await ctx.runMutation(internal.invoices.recordPending, { invoiceId, pending: { customerId } });
        const due = Math.floor(dueMoment(i.dueDate) / 1000);
        // How the client can pay on the portal's page: card (with Apple Pay and Google Pay), plus US bank account (D25)
        // and Link where the business's Stripe account has them switched on.
        const methods = ["card"];
        try {
          const caps = ((await stripeCall("GET", `accounts/${account}`)).capabilities ?? {}) as Record<string, string>;
          if (caps.us_bank_account_ach_payments === "active") methods.push("us_bank_account");
          if (caps.link_payments === "active") methods.push("link");
        } catch { /* card only */ }
        let taxRate: string | null = null;
        if (i.taxPercent) taxRate = (await stripeCall("POST", "tax_rates", { account, idem: k("tax"), form: { display_name: "Tax", percentage: i.taxPercent, inclusive: false } })).id as string;
        const inv = await stripeCall("POST", "invoices", {
          account, idem: k("inv"),
          form: {
            customer: customerId, collection_method: "send_invoice", due_date: due, auto_advance: false, pending_invoice_items_behavior: "exclude",
            ...(i.memo ? { description: i.memo } : {}), metadata: { ...meta, portal_kind: i.kind, portal_title: i.title },
            ...(taxRate ? { default_tax_rates: [taxRate] } : {}),
            payment_settings: { payment_method_types: methods },
          },
        });
        draftId = inv.id as string;
        await ctx.runMutation(internal.invoices.recordPending, { invoiceId, pending: { draftId } });
        // One invoice item per line (the amount carries the quantity; the portal's own page shows qty and unit price).
        for (const [n, l] of i.lines.entries()) {
          const amount = Math.round(l.qty * l.unitCents);
          const desc = l.qty === 1 ? l.description : `${l.description} (${l.qty} × $${(l.unitCents / 100).toFixed(2)})`;
          await stripeCall("POST", "invoiceitems", { account, idem: k(`item${n}`), form: { customer: customerId, invoice: inv.id, amount, currency: "usd", description: desc } });
        }
        if (i.discountCents) await stripeCall("POST", "invoiceitems", { account, idem: k("disc"), form: { customer: customerId, invoice: inv.id, amount: -Math.min(i.discountCents, c.totals.subtotal), currency: "usd", description: "Discount" } });
        await stripeCall("POST", `invoices/${inv.id}`, { account, form: { number: i.number } });
        const check = await stripeCall("GET", `invoices/${inv.id}`, { account });
        if (Number(check.total) !== c.totals.total) throw new StripeError(`Stripe's total (${check.total}) doesn't match the portal's (${c.totals.total}). Nothing was sent.`, 0, "mismatch");
        finalized = await stripeCall("POST", `invoices/${inv.id}/finalize`, { account, form: { auto_advance: false } });
      }
    } catch (e) {
      // Nothing went out: remove the Stripe draft so a retry starts clean (the number stays the portal's).
      if (draftId) await stripeCall("DELETE", `invoices/${draftId}`, { account }).catch(() => null);
      const message = e instanceof StripeError ? e.message : "Couldn't reach Stripe. Nothing was sent; try again.";
      await ctx.runMutation(internal.invoices.recordSendFailed, { invoiceId, message });
      throw new ConvexError(message);
    }
    // Finalized in Stripe: from here the invoice IS sent, whatever happens next. If saving fails, it stays "sending"
    // and pressing Send again (after a few minutes) picks the finalized invoice up rather than making another.
    await ctx.runMutation(internal.invoices.recordSent, { invoiceId, by: c.by, stripe: { accountId: account, customerId: customerId ?? finalized!.customer, invoice: finalized } });
    return { number: i.number };
  },
});

/** Owner only, before anything is claimed (so a refused caller never touches the counter). */
export const sendGuard = internalQuery({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx) => { await requireMe(ctx); return null; },
});

/** The moment an invoice falls due: the end of its due date, US Central time (Stripe needs a time in the future). */
export function dueMoment(iso: string) { return Date.parse(`${iso}T23:59:00-06:00`); }

// ---------- the deposit from a signed contract (step 4c) ----------

/** Is this business's Stripe connected to the portal? (Then a signed contract's amount becomes a portal draft.) */
export const connectedFor = internalQuery({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, { businessId }) => {
    const b = businessId ? await ctx.db.get(businessId) : null;
    return !!b?.stripe && b.stripe.status !== "disconnected";
  },
});

/** A contract everyone signed, with an amount set (Wrangler Sign, S3): a DRAFT invoice in the portal, for the owner
 *  to check and send (D46). One per document version, however often it runs. The project is left for the owner to
 *  pick; the client is the one the signer belongs to. */
export const draftFromContract = internalMutation({
  args: { documentId: v.id("wsDocuments"), versionNumber: v.number(), label: v.string(), docTitle: v.string(), amountCents: v.number(), description: v.string(),
    billTo: v.object({ name: v.string(), email: v.string() }), dueDays: v.number() },
  handler: async (ctx, a) => {
    const doc = await ctx.db.get(a.documentId);
    if (!doc) throw new ConvexError("That document isn't here.");
    const key = `contract:${a.documentId}:v${a.versionNumber}`;
    const existing = (await ctx.db.query("invoices").withIndex("by_bill_email", (q) => q.eq("billTo.email", a.billTo.email.trim().toLowerCase())).collect()).find((i) => i.fromContract === key);
    if (existing) return { invoiceId: existing._id, made: false };
    const biz = doc.businessId ?? null;
    const email = a.billTo.email.trim().toLowerCase();
    const person = (await ctx.db.query("clientPeople").withIndex("by_email", (q) => q.eq("email", email)).collect()).find((p) => !p.removedAt && (p.businessId ?? null) === biz);
    const now = Date.now();
    const due = new Date(now + Math.max(0, a.dueDays) * DAY);
    const dueDate = `${due.getUTCFullYear()}-${String(due.getUTCMonth() + 1).padStart(2, "0")}-${String(due.getUTCDate()).padStart(2, "0")}`;
    const lines = [{ id: "deposit", description: `${a.description} · ${a.docTitle}`.slice(0, 300), qty: 1, unitCents: Math.round(a.amountCents) }];
    const invoiceId = await ctx.db.insert("invoices", {
      ...(biz ? { businessId: biz } : {}), ...(person?.clientId ? { clientId: person.clientId } : {}),
      kind: /deposit/i.test(a.description) ? "deposit" : "other", title: `${a.description} · ${a.label}`.slice(0, 120),
      billTo: { name: a.billTo.name.trim() || email, email }, lines, dueDate, status: "draft",
      totalCents: lines[0].unitCents, amountPaidCents: 0, amountRemainingCents: lines[0].unitCents,
      fromContract: key, history: [{ kind: "created", at: now, detail: `from ${a.label} (signed)` }], createdAt: now, updatedAt: now,
    });
    return { invoiceId, made: true };
  },
});

// ---------- the final invoice from a signed contract (Phase 2, the plan's "Final invoice") ----------

/** Signed contracts of this project's client that have a balance left after the deposit (made in the builder, so the
 *  portal knows their total), and whether a final invoice has been drafted from each. */
async function finalCandidates(ctx: QueryCtx | MutationCtx, projectId: Id<"projects">) {
  const p = await ctx.db.get(projectId);
  if (!p?.clientId) return { project: p, rows: [] as Array<{ documentId: Id<"wsDocuments">; label: string; title: string; totalCents: number; depositCents: number; balanceCents: number; invoiceId: Id<"invoices"> | null; billTo: { name: string; email: string } | null }> };
  const people = (await ctx.db.query("clientPeople").withIndex("by_client", (q) => q.eq("clientId", p.clientId!)).collect()).filter((x) => !x.removedAt);
  const docs = (await clientDocs(ctx, new Set(people.map((x) => x.email)), p.businessId)).filter((d) => d.status === "completed");
  const mine = await ctx.db.query("invoices").withIndex("by_client", (q) => q.eq("clientId", p.clientId!)).collect();
  const rows = [];
  for (const d of docs) {
    const doc = await ctx.db.get(d._id);
    const build = doc?.buildId ? await ctx.db.get(doc.buildId) : await ctx.db.query("wsBuilds").withIndex("by_document", (q) => q.eq("documentId", d._id)).first();
    if (!build) continue; // an uploaded PDF: the portal doesn't know its total
    const t = builderTotals(pageOf(build.blocks));
    const totalCents = Math.round(t.total * 100), depositCents = Math.round(t.deposit * 100), balanceCents = totalCents - depositCents;
    if (balanceCents <= 0) continue;
    const signer = doc?.sentVersion !== undefined ? (await ctx.db.query("wsSignings").withIndex("by_document", (q) => q.eq("documentId", d._id).eq("versionNumber", doc.sentVersion!)).collect()).sort((a, b) => a.order - b.order)[0] : null;
    const existing = mine.find((i) => i.fromContract === `final:${d._id}` && i.status !== "void");
    rows.push({ documentId: d._id, label: d.label, title: d.title, totalCents, depositCents, balanceCents, invoiceId: existing?._id ?? null, billTo: signer ? { name: signer.name, email: signer.email } : null });
  }
  return { project: p, rows };
}

/** Project › Invoices: "Draft final invoice" for each signed contract with a balance. */
export const finalOptions = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    await requireMe(ctx);
    const id = ctx.db.normalizeId("projects", projectId);
    return id ? (await finalCandidates(ctx, id)).rows : [];
  },
});

/** Drafts the final invoice for one signed contract: its balance (the total less the deposit), billed to the person
 *  who signed it. A draft only; the owner checks and sends it (D46). One per contract. */
export const draftFinal = mutation({
  args: { projectId: v.id("projects"), documentId: v.id("wsDocuments") },
  handler: async (ctx, { projectId, documentId }) => {
    await requireMe(ctx);
    const { project, rows } = await finalCandidates(ctx, projectId);
    const r = rows.find((x) => x.documentId === documentId);
    if (!project || !r) throw new ConvexError("That contract has no balance left to invoice on this project.");
    if (r.invoiceId) return r.invoiceId;
    if (!r.billTo) throw new ConvexError("That contract has no client signer to bill.");
    const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const now = Date.now();
    const due = new Date(now + 7 * DAY);
    const dueDate = `${due.getUTCFullYear()}-${String(due.getUTCMonth() + 1).padStart(2, "0")}-${String(due.getUTCDate()).padStart(2, "0")}`;
    return await ctx.db.insert("invoices", {
      ...(project.businessId ? { businessId: project.businessId } : {}), clientId: project.clientId, projectId,
      kind: "final", title: `Final invoice · ${r.label}`, billTo: { name: r.billTo.name, email: r.billTo.email.trim().toLowerCase() },
      lines: [{ id: "balance", description: `Balance · ${r.title}`.slice(0, 300), qty: 1, unitCents: r.balanceCents }],
      memo: `Contract total ${usd(r.totalCents)}, less the ${usd(r.depositCents)} deposit (${r.label}).`,
      dueDate, status: "draft", totalCents: r.balanceCents, amountPaidCents: 0, amountRemainingCents: r.balanceCents,
      fromContract: `final:${documentId}`, history: [{ kind: "created", at: now, detail: `final invoice from ${r.label}` }], createdAt: now, updatedAt: now,
    });
  },
});

// ---------- voiding ----------

export const voidTarget = internalQuery({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    await requireMe(ctx);
    const i = await ctx.db.get(invoiceId);
    if (!i) throw new ConvexError("That invoice isn't here.");
    if (i.status !== "open") throw new ConvexError(i.status === "draft" ? "A draft isn't sent; delete it instead." : "Only an unpaid invoice can be voided.");
    if (i.amountPaidCents > 0) throw new ConvexError("Part of this invoice is paid, so it can't be voided. Refund in Stripe first.");
    if (i.processing) throw new ConvexError("A bank payment is on its way, so it can't be voided now. Wait for it to clear or fail.");
    return { accountId: i.stripe!.accountId, stripeId: i.stripe!.invoiceId };
  },
});

/** Void (after the owner confirms): the client can't pay it any more. Can't be undone. */
export const voidInvoice = action({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }): Promise<null> => {
    const t = await ctx.runQuery(internal.invoices.voidTarget, { invoiceId });
    try {
      const inv = await stripeCall("POST", `invoices/${t.stripeId}/void`, { account: t.accountId });
      await ctx.runMutation(internal.invoices.applyStripeInvoice, { accountId: t.accountId, invoice: inv });
    } catch (e) {
      throw new ConvexError(e instanceof StripeError ? e.message : "Couldn't reach Stripe. Try again.");
    }
    return null;
  },
});

// ---------- the webhook's side ----------

async function byStripe(ctx: QueryCtx | MutationCtx, accountId: string, stripeId: string) {
  const i = await ctx.db.query("invoices").withIndex("by_stripe", (q) => q.eq("stripe.invoiceId", stripeId)).first();
  return i && i.stripe?.accountId === accountId ? i : null;
}

/** An invoice.* event (or the void call): copies Stripe's status and amounts onto the portal's invoice, notes what
 *  changed in its history, and opens the final files when a final invoice is paid in full. */
export const applyStripeInvoice = internalMutation({
  args: { accountId: v.string(), invoice: v.any(), eventType: v.optional(v.string()) },
  handler: async (ctx, { accountId, invoice, eventType }) => {
    const s = invoice as StripeResult;
    const i = await byStripe(ctx, accountId, String(s.id));
    if (!i) return null;
    const now = Date.now();
    // Review fix (Oct 30): never backwards. An old or out-of-order payload (Stripe retries late) can't take a paid,
    // void or uncollectible invoice back to open, and the amount paid never goes down.
    const FINAL = ["paid", "void", "uncollectible"];
    const incoming = (["open", "paid", "void", "uncollectible"].includes(s.status) ? s.status : i.status) as Doc<"invoices">["status"];
    const status = FINAL.includes(i.status) && incoming === "open" ? i.status : incoming;
    const paid = Math.max(i.amountPaidCents, Number(s.amount_paid ?? i.amountPaidCents));
    const stale = status !== incoming || paid !== Number(s.amount_paid ?? paid);
    const history = [...i.history];
    if (status === "paid" && i.status !== "paid") history.push({ kind: "paid", at: now, detail: "Paid in full" });
    else if (status === "open" && paid > i.amountPaidCents) history.push({ kind: "part_paid", at: now, detail: `$${((paid - i.amountPaidCents) / 100).toFixed(2)} paid` });
    if (status === "void" && i.status !== "void") history.push({ kind: "voided", at: now });
    if (status === "uncollectible" && i.status !== "uncollectible") history.push({ kind: "uncollectible", at: now });
    // (A failed attempt goes into the history when its payments are read back, with Stripe's reason: invoicePay.sync.)
    await ctx.db.patch(i._id, {
      status,
      totalCents: Number(s.total ?? i.totalCents), amountPaidCents: paid, amountRemainingCents: stale ? i.amountRemainingCents : Number(s.amount_remaining ?? i.amountRemainingCents),
      ...(status === "paid" || paid > i.amountPaidCents ? { processing: false } : {}),
      // Keep a reason the portal already read from Stripe for this same attempt (within ten minutes).
      ...(eventType === "invoice.payment_failed" ? { lastFailure: i.lastFailure && now - i.lastFailure.at < 10 * 60_000 ? i.lastFailure : { at: now, message: "A payment attempt failed" }, processing: false } : {}),
      ...(status === "paid" && !i.paidAt ? { paidAt: now } : {}),
      ...(status === "void" && !i.voidedAt ? { voidedAt: now } : {}),
      stripe: { ...i.stripe!, number: s.number ?? i.stripe!.number, hostedUrl: s.hosted_invoice_url ?? i.stripe!.hostedUrl, pdfUrl: s.invoice_pdf ?? i.stripe!.pdfUrl },
      history: history.slice(-60), updatedAt: now,
    });
    // Phase 3: the final invoice paid moves the pipeline card to Paid (forward only, D60).
    if (status === "paid" && i.status !== "paid" && i.kind === "final" && i.projectId) await crmProject(ctx, i.projectId, "paid", `${i.number ?? "final invoice"} paid`);
    // A final invoice paid in full opens the project's final files (the Part A lock, now automatic).
    if (status === "paid" && i.status !== "paid" && i.kind === "final" && i.projectId) {
      const p = await ctx.db.get(i.projectId);
      if (p && !p.deliveryUnlockedAt) {
        const told = await openDelivery(ctx, p);
        await ctx.db.patch(i._id, { history: [...history, { kind: told === null ? "delivery_waiting" : "delivery_opened", at: now, detail: told === null ? "No final files added yet; unlock them on the project's Delivery tab when they are" : "Final files opened for the client" }].slice(-60) });
      }
    }
    return i._id;
  },
});

/** Invoice deleted in Stripe (a draft someone removed there): the portal's copy goes back to being a draft. */
export const stripeInvoiceDeleted = internalMutation({
  args: { accountId: v.string(), stripeId: v.string() },
  handler: async (ctx, { accountId, stripeId }) => {
    const i = await byStripe(ctx, accountId, stripeId);
    if (i && i.status === "sending") await ctx.db.patch(i._id, { status: "draft", stripe: undefined, sendError: "The draft was deleted in Stripe. Send again to make a new one.", updatedAt: Date.now() });
  },
});

/** For Settings › Payments: unpaid invoices that a disconnect would hide the Pay button on. */
export async function openCount(ctx: QueryCtx) {
  return (await ctx.db.query("invoices").collect()).filter((i) => i.status === "open").length;
}

export const dayMs = DAY;
