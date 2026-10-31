// Phase 3b (Oct 31) · Quick quotes (Payments › Quotes; S5 · Phase 3b 719:6320 list, 719:7567 new, 720:7076–8867 detail,
// 722:7998–9209 the client's page, 721:7878 PDF). Quick prices for small jobs that look like the invoices. Numbers are
// {prefix}-Q-0001 (D74), valid 30 days by default. The person needs no account (D81): the quote email's link opens
// /q/<token>, where they accept or decline (D80) with their typed name, recorded with the time, IP and device (the
// same way signing records a signer). Nothing converts or moves on its own (D84): the owner is asked to move the card
// to Quoted, and, once accepted, whether to draft a contract, an invoice (deposit or full total, D87), both or neither.
import { action, httpAction } from "./_generated/server";
import { internalAction, internalMutation, internalQuery, mutation, query, focusBusiness } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe } from "./lib/access";
import { businessContact, businessInScope } from "./lib/business";
import { invoicePrefix } from "./lib/invoiceNumber";
import { randomToken } from "./lib/hash";
import { SITE } from "./lib/site";
import { mailBrandOf } from "./lib/mail";
import { ownerQuoteAnsweredMail, quoteMail } from "./lib/mails";
import { deliverOnce } from "./invoiceReminders";
import { callerIp } from "./lib/wsSigning";
import { corsHeaders } from "./signing";
import { fillAgreement, moveCardFor, newAgreementDraft } from "./crm";

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const DAY = 86_400_000;
export const quoteLink = (token: string) => `${SITE()}/q/${token}`;
const todayIso = () => {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
  catch { return new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10); }
};
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const when = (t: number) => new Date(t).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Subtotal, discount, tax and total, then the deposit (a % of the total, or a fixed amount up to it). */
export function quoteTotals(q: { lines: Array<{ qty: number; unitCents: number }>; discountCents?: number; taxPercent?: number; deposit: { kind: "percent" | "amount"; value: number } }) {
  const subtotal = q.lines.reduce((t, l) => t + Math.round(l.qty * l.unitCents), 0);
  const discount = Math.min(Math.max(0, q.discountCents ?? 0), subtotal);
  const tax = Math.round(((subtotal - discount) * Math.max(0, q.taxPercent ?? 0)) / 100);
  const total = subtotal - discount + tax;
  const deposit = q.deposit.kind === "percent" ? Math.round((total * Math.max(0, Math.min(100, q.deposit.value))) / 100) : Math.min(Math.max(0, Math.round(q.deposit.value)), total);
  return { subtotal, discount, tax, total, deposit };
}

export type QuoteStatus = "draft" | "sent" | "accepted" | "declined" | "expired" | "void";
export function displayStatus(q: Doc<"quotes">, today = todayIso()): QuoteStatus {
  if (q.status === "sent" && q.validUntil < today) return "expired";
  return q.status;
}

async function ownerBiz(ctx: QueryCtx | MutationCtx) {
  const me = await requireMe(ctx);
  const id = businessInScope(ctx);
  const b = id ? await ctx.db.get(id) : null;
  if (!b) throw new ConvexError("Not allowed.");
  return { me, b };
}
const by = (me: { name?: string | null; email: string }) => me.name ?? me.email;

async function getQuote(ctx: QueryCtx | MutationCtx, quoteId: string) {
  const id = ctx.db.normalizeId("quotes", quoteId);
  const q = id ? await ctx.db.get(id) : null;
  if (!q) throw new ConvexError("That quote isn't here.");
  return q;
}

/** The business details the quote paper shows (the same footer as invoices). */
async function paperBusiness(ctx: QueryCtx, b: Doc<"businesses"> | null) {
  return b ? {
    name: b.name, legalName: b.legalName ?? null, email: b.replyTo ?? null, address: b.address ?? null, privacyUrl: b.privacyUrl ?? null,
    logoUrl: b.logoFileId ? await ctx.storage.getUrl(b.logoFileId) : null, logoLightUrl: b.logoLightFileId ? await ctx.storage.getUrl(b.logoLightFileId) : null,
  } : { name: "", legalName: null, email: null, address: null, privacyUrl: null, logoUrl: null, logoLightUrl: null };
}

// ---------- the owner: list, get, options ----------

export const list = query({
  args: {},
  handler: async (ctx) => {
    await ownerBiz(ctx);
    const today = todayIso();
    const rows = (await ctx.db.query("quotes").withIndex("by_updated").order("desc").take(500)).map((q) => ({
      _id: q._id, number: q.number, company: q.contact.company || q.contact.name, title: q.title, status: displayStatus(q, today), totalCents: q.totalCents,
      sentAt: q.sentAt ?? null, viewedAt: q.viewedAt ?? null, validUntil: q.validUntil, response: q.response ?? null, updatedAt: q.updatedAt,
    }));
    return rows;
  },
});

export const get = query({
  args: { quoteId: v.string() },
  handler: async (ctx, { quoteId }) => {
    const { b } = await ownerBiz(ctx);
    const q = await getQuote(ctx, quoteId);
    const build = q.made?.buildId ? await ctx.db.get(q.made.buildId) : null;
    const invoice = q.made?.invoiceId ? await ctx.db.get(q.made.invoiceId) : null;
    const deal = q.dealId ? await ctx.db.get(q.dealId) : null;
    return {
      ...q, display: displayStatus(q), totals: quoteTotals(q), link: q.token ? quoteLink(q.token) : null, business: await paperBusiness(ctx, b),
      deal: deal ? { _id: deal._id, stage: deal.stage } : null,
      made: { build: build ? { _id: build._id, title: build.title } : null, invoice: invoice ? { _id: invoice._id, title: invoice.title, totalCents: invoice.totalCents, status: invoice.status } : null },
    };
  },
});

/** Who a quote can be for: the business's companies and their people, and open website leads with no company yet. */
export const options = query({
  args: {},
  handler: async (ctx) => {
    const { b } = await ownerBiz(ctx);
    const people = (await ctx.db.query("clientPeople").collect()).filter((p) => !p.removedAt);
    const clients = (await ctx.db.query("clients").collect()).sort((a, c) => a.name.localeCompare(c.name));
    const leads = (await ctx.db.query("deals").collect()).filter((d) => !d.closedAt && !d.clientId && d.lead).map((d) => ({ dealId: d._id, name: d.lead!.name, email: d.lead!.email, company: d.lead!.company ?? null }));
    return {
      next: `${invoicePrefix(b.name)}-Q-${String((b.quoteSeq ?? 0) + 1).padStart(4, "0")}`,
      who: [
        ...clients.flatMap((c) => people.filter((p) => p.clientId === c._id).sort((x, y) => (x.role === "signer" ? -1 : 1) - (y.role === "signer" ? -1 : 1)).map((p) => ({ key: `p:${p._id}`, clientId: c._id, dealId: null, name: p.name ?? p.email, email: p.email, company: c.name }))),
        ...leads.map((l) => ({ key: `d:${l.dealId}`, clientId: null, dealId: l.dealId, name: l.name, email: l.email, company: l.company, lead: true })),
      ],
    };
  },
});

// ---------- the owner: make, send, void ----------

const lineV = v.object({ id: v.string(), description: v.string(), qty: v.number(), unitCents: v.number(), suggestedCents: v.optional(v.number()), note: v.optional(v.string()) });
const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

export const save = mutation({
  args: {
    quoteId: v.optional(v.id("quotes")),
    who: v.object({ clientId: v.optional(v.id("clients")), dealId: v.optional(v.id("deals")), name: v.string(), email: v.string(), company: v.optional(v.string()) }),
    projectId: v.optional(v.id("projects")),
    title: v.string(), lines: v.array(lineV), discountCents: v.optional(v.number()), taxPercent: v.optional(v.number()),
    deposit: v.object({ kind: v.union(v.literal("percent"), v.literal("amount")), value: v.number() }),
    validUntil: v.optional(v.string()), terms: v.optional(v.string()), questions: v.optional(v.any()),
  },
  handler: async (ctx, a) => {
    const { me, b } = await ownerBiz(ctx);
    // Every id is read through the guard first, so another business's company, card or project is refused.
    if (a.who.clientId && !(await ctx.db.get(a.who.clientId))) throw new ConvexError("That company isn't here.");
    if (a.who.dealId && !(await ctx.db.get(a.who.dealId))) throw new ConvexError("That lead isn't here.");
    if (a.projectId && !(await ctx.db.get(a.projectId))) throw new ConvexError("That project isn't here.");
    const email = a.who.email.trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) throw new ConvexError("Add the email the quote goes to.");
    if (!a.who.name.trim()) throw new ConvexError("Add the name of the person it's for.");
    if (a.lines.length > 50) throw new ConvexError("That's too many lines for a quick quote.");
    for (const l of a.lines) {
      if (!l.description.trim()) throw new ConvexError("Every line needs a description.");
      if (!(l.qty > 0 && l.qty <= 10_000) || !Number.isInteger(l.unitCents) || l.unitCents < 0 || l.unitCents > 100_000_000) throw new ConvexError(`Check the amounts on "${l.description.trim()}".`);
    }
    if (a.taxPercent !== undefined && !(a.taxPercent >= 0 && a.taxPercent <= 50)) throw new ConvexError("Tax must be between 0% and 50%.");
    if (a.deposit.kind === "percent" ? !(a.deposit.value >= 0 && a.deposit.value <= 100) : !(Number.isInteger(a.deposit.value) && a.deposit.value >= 0)) throw new ConvexError("Check the deposit.");
    const today = todayIso();
    const validUntil = a.validUntil && /^\d{4}-\d{2}-\d{2}$/.test(a.validUntil) ? a.validUntil : plusDays(today, 30); // D74: 30 days
    if (validUntil < today) throw new ConvexError("Valid until can't be in the past.");
    const lines = a.lines.map((l) => ({ id: l.id.slice(0, 40), description: l.description.trim().slice(0, 300), qty: l.qty, unitCents: l.unitCents, ...(l.suggestedCents !== undefined ? { suggestedCents: l.suggestedCents } : {}), ...(l.note ? { note: l.note.slice(0, 200) } : {}) }));
    const fields = {
      ...(a.who.clientId ? { clientId: a.who.clientId } : { clientId: undefined }), ...(a.who.dealId ? { dealId: a.who.dealId } : {}), ...(a.projectId ? { projectId: a.projectId } : {}),
      contact: { name: a.who.name.trim().slice(0, 120), email, ...(a.who.company?.trim() ? { company: a.who.company.trim().slice(0, 120) } : {}) },
      title: a.title.trim().slice(0, 160) || "Quote", lines, discountCents: a.discountCents ? Math.max(0, Math.round(a.discountCents)) : undefined, taxPercent: a.taxPercent || undefined,
      deposit: a.deposit, validUntil, terms: a.terms?.trim().slice(0, 2000) || undefined, ...(a.questions !== undefined ? { questions: a.questions } : {}),
      updatedAt: Date.now(),
    };
    const totalCents = quoteTotals({ ...fields, lines }).total;
    if (a.quoteId) {
      const q = await ctx.db.get(a.quoteId);
      if (!q) throw new ConvexError("That quote isn't here.");
      if (q.status !== "draft") throw new ConvexError("Only drafts can change. Void this one and make a new quote.");
      await ctx.db.patch(q._id, { ...fields, totalCents });
      return q._id;
    }
    const seq = (b.quoteSeq ?? 0) + 1; // D74: one running count per business; numbers never repeat
    await ctx.db.patch(b._id, { quoteSeq: seq });
    const now = Date.now();
    return await ctx.db.insert("quotes", { ...fields, number: `${invoicePrefix(b.name)}-Q-${String(seq).padStart(4, "0")}`, seq, status: "draft", totalCents,
      history: [{ kind: "created", at: now, by: by(me) }], createdBy: by(me), createdAt: now });
  },
});

export const deleteDraft = mutation({
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, { quoteId }) => {
    await ownerBiz(ctx);
    const q = await ctx.db.get(quoteId);
    if (!q) throw new ConvexError("That quote isn't here.");
    if (q.status !== "draft") throw new ConvexError("Only drafts can be deleted. Void a sent quote instead.");
    await ctx.db.delete(quoteId);
    return null;
  },
});

/** Send (or resend): the quote gets its link, then email 18 goes to the person. */
export const markSent = internalMutation({
  args: { quoteId: v.id("quotes"), resend: v.boolean() },
  handler: async (ctx, { quoteId, resend }) => {
    const { me } = await ownerBiz(ctx);
    const q = await ctx.db.get(quoteId);
    if (!q) throw new ConvexError("That quote isn't here.");
    if (resend ? q.status !== "sent" : q.status !== "draft") throw new ConvexError(resend ? "Only an open quote can be resent." : "This quote has already been sent.");
    if (!q.lines.length || q.totalCents <= 0) throw new ConvexError("Add at least one line with a price.");
    if (q.validUntil < todayIso()) throw new ConvexError("Its Valid until date has passed. Change it first.");
    const now = Date.now();
    const token = q.token ?? randomToken(18);
    await ctx.db.patch(quoteId, { status: "sent", token, sentAt: q.sentAt ?? now, updatedAt: now, history: [...q.history, { kind: resend ? "resent" : "sent", at: now, by: by(me), detail: q.contact.email }].slice(-60) });
    return { key: `quote-sent:${quoteId}:${resend ? now : "first"}` };
  },
});

export const mailData = internalQuery({
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, { quoteId }) => {
    const q = await ctx.db.get(quoteId);
    if (!q?.token) return null;
    const c = await businessContact(ctx, q.businessId ?? null);
    return { q, brand: await mailBrandOf(ctx, q.businessId ?? null), owner: c.ownerEmail, link: quoteLink(q.token) };
  },
});

export const send = action({
  args: { quoteId: v.id("quotes"), resend: v.optional(v.boolean()) },
  handler: async (ctx, { quoteId, resend }): Promise<{ held: boolean }> => {
    const { key } = await ctx.runMutation(internal.quotes.markSent, { quoteId, resend: !!resend });
    const d = (await ctx.runQuery(internal.quotes.mailData, { quoteId }))!;
    const r = await deliverOnce(ctx, key, "quote", d.q.contact.email,
      quoteMail(d.brand, { name: d.q.contact.name, number: d.q.number, title: d.q.title, totalCents: d.q.totalCents, validUntil: d.q.validUntil, terms: d.q.terms ?? null, link: d.link }), d.brand.replyTo);
    if (r === "held") await ctx.runMutation(internal.quotes.note, { quoteId, kind: "email_held", detail: d.q.contact.email });
    return { held: r === "held" };
  },
});

export const note = internalMutation({
  args: { quoteId: v.id("quotes"), kind: v.string(), detail: v.optional(v.string()) },
  handler: async (ctx, { quoteId, kind, detail }) => {
    const q = await ctx.db.get(quoteId);
    if (q) await ctx.db.patch(quoteId, { history: [...q.history, { kind, at: Date.now(), ...(detail ? { detail } : {}) }].slice(-60) });
  },
});

export const voidQuote = mutation({
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, { quoteId }) => {
    const { me } = await ownerBiz(ctx);
    const q = await ctx.db.get(quoteId);
    if (!q) throw new ConvexError("That quote isn't here.");
    if (q.status !== "sent") throw new ConvexError(q.status === "draft" ? "Delete a draft instead." : "Only an open quote can be voided.");
    const now = Date.now();
    await ctx.db.patch(quoteId, { status: "void", voidedAt: now, updatedAt: now, history: [...q.history, { kind: "voided", at: now, by: by(me) }].slice(-60) });
    return null;
  },
});

// ---------- the owner's prompts (D84): nothing moves or converts until they say so ----------

/** "Move {company} to Quoted in your pipeline?" Yes moves (or opens) the card; No leaves the pipeline alone. */
export const answerMove = mutation({
  args: { quoteId: v.id("quotes"), yes: v.boolean() },
  handler: async (ctx, { quoteId, yes }) => {
    const { me } = await ownerBiz(ctx);
    const q = await ctx.db.get(quoteId);
    if (!q) throw new ConvexError("That quote isn't here.");
    if (q.status === "draft" || q.status === "void") throw new ConvexError("Send the quote first.");
    let dealId = q.dealId ?? null;
    if (yes) dealId = await moveCardFor(ctx, { dealId, clientId: q.clientId ?? null, title: q.title, contactEmail: q.contact.email, projectId: q.projectId ?? null, valueCents: q.totalCents, stage: "quoted", detail: `quote ${q.number} sent`, by: by(me) });
    await ctx.db.patch(quoteId, { ...(dealId ? { dealId } : {}), asked: { ...(q.asked ?? {}), move: yes ? "yes" : "no" }, updatedAt: Date.now() });
    return dealId;
  },
});

export const later = mutation({
  args: { quoteId: v.id("quotes"), what: v.union(v.literal("draft"), v.literal("seen")) },
  handler: async (ctx, { quoteId, what }) => {
    await ownerBiz(ctx);
    const q = await ctx.db.get(quoteId);
    if (!q) throw new ConvexError("That quote isn't here.");
    await ctx.db.patch(quoteId, { asked: { ...(q.asked ?? {}), ...(what === "draft" ? { draft: "later" as const } : { seen: true }) } });
    return null;
  },
});

export const draftTarget = internalQuery({
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, { quoteId }) => {
    await ownerBiz(ctx);
    const q = await ctx.db.get(quoteId);
    if (!q) throw new ConvexError("That quote isn't here.");
    if (q.status !== "accepted") throw new ConvexError("Drafts come from an accepted quote.");
    const project = q.projectId ? await ctx.db.get(q.projectId) : null;
    return { q, totals: quoteTotals(q), project: project ? (project.jobNumber ? `${project.jobNumber} ${project.name}` : project.name) : q.title };
  },
});

/** The invoice draft from an accepted quote: the deposit, or the full total (D87). Nothing is sent. */
export const makeInvoice = internalMutation({
  args: { quoteId: v.id("quotes"), what: v.union(v.literal("deposit"), v.literal("full")) },
  handler: async (ctx, { quoteId, what }) => {
    const { me } = await ownerBiz(ctx);
    const q = await ctx.db.get(quoteId);
    if (!q) throw new ConvexError("That quote isn't here.");
    if (q.made?.invoiceId && (await ctx.db.get(q.made.invoiceId))) return q.made.invoiceId;
    const t = quoteTotals(q);
    const now = Date.now();
    const due = plusDays(todayIso(), Math.max(0, Number(process.env.WS_INVOICE_DUE_DAYS ?? 3) || 0));
    const lines = what === "deposit"
      ? [{ id: "deposit", description: `Deposit (${q.deposit.kind === "percent" ? `${q.deposit.value}%` : "to book"}) · ${q.title} · ${q.number}`.slice(0, 300), qty: 1, unitCents: t.deposit }]
      : q.lines.map((l) => ({ id: l.id, description: l.description, qty: l.qty, unitCents: l.unitCents }));
    const total = what === "deposit" ? t.deposit : t.total;
    if (total <= 0) throw new ConvexError(what === "deposit" ? "This quote has no deposit. Draft the full total instead." : "This quote has no total.");
    const id = await ctx.db.insert("invoices", {
      ...(q.clientId ? { clientId: q.clientId } : {}), ...(q.projectId ? { projectId: q.projectId } : {}),
      kind: what === "deposit" ? "deposit" : "other", title: `${what === "deposit" ? "Deposit" : "Invoice"} · ${q.title}`.slice(0, 120),
      billTo: { name: q.contact.name, email: q.contact.email, ...(q.contact.company ? { company: q.contact.company } : {}) }, lines,
      ...(what === "full" && t.discount ? { discountCents: t.discount } : {}), ...(what === "full" && q.taxPercent ? { taxPercent: q.taxPercent } : {}),
      dueDate: due, status: "draft", totalCents: total, amountPaidCents: 0, amountRemainingCents: total,
      history: [{ kind: "created", at: now, by: by(me), detail: `from quote ${q.number}` }], createdAt: now, updatedAt: now, createdBy: by(me),
    });
    await ctx.db.patch(quoteId, { made: { ...(q.made ?? {}), invoiceId: id }, history: [...q.history, { kind: "invoice_drafted", at: now, by: by(me), detail: what }].slice(-60) });
    return id;
  },
});

export const linkContract = internalMutation({
  args: { quoteId: v.id("quotes"), buildId: v.id("wsBuilds") },
  handler: async (ctx, { quoteId, buildId }) => {
    const { me } = await ownerBiz(ctx);
    const q = await ctx.db.get(quoteId);
    if (!q) return;
    await ctx.db.patch(quoteId, { made: { ...(q.made ?? {}), buildId }, history: [...q.history, { kind: "contract_drafted", at: Date.now(), by: by(me) }].slice(-60) });
  },
});
export const doneAsking = internalMutation({
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, { quoteId }) => {
    await ownerBiz(ctx);
    const q = await ctx.db.get(quoteId);
    if (q) await ctx.db.patch(quoteId, { asked: { ...(q.asked ?? {}), draft: "done" }, updatedAt: Date.now() });
  },
});

/** "Draft from this quote": a contract (the Service Agreement with the lines, deposit and client), an invoice
 *  (deposit or full total), or both. Each opens as a draft; nothing is sent. */
export const draftFrom = action({
  args: { quoteId: v.id("quotes"), contract: v.boolean(), invoice: v.optional(v.union(v.literal("deposit"), v.literal("full"))) },
  handler: async (ctx, a): Promise<{ buildId: Id<"wsBuilds"> | null; invoiceId: Id<"invoices"> | null }> => {
    if (!a.contract && !a.invoice) throw new ConvexError("Pick a contract, an invoice, or both.");
    const t = await ctx.runQuery(internal.quotes.draftTarget, { quoteId: a.quoteId });
    let buildId: Id<"wsBuilds"> | null = t.q.made?.buildId ?? null;
    if (a.contract && !buildId) {
      buildId = await newAgreementDraft(ctx, t.q.contact.company || t.q.contact.name);
      const lines = [
        ...t.q.lines.map((l) => ({ description: l.description, qty: l.qty, rateCents: l.unitCents })),
        ...(t.totals.discount ? [{ description: "Discount", qty: 1, rateCents: -t.totals.discount }] : []),
        ...(t.totals.tax ? [{ description: `Tax (${t.q.taxPercent}%)`, qty: 1, rateCents: t.totals.tax }] : []),
      ];
      const depositPercent = t.totals.total > 0 ? Math.round((t.totals.deposit / t.totals.total) * 10000) / 100 : 0;
      await fillAgreement(ctx, buildId, { company: t.q.contact.company ?? "", signer: { name: t.q.contact.name, email: t.q.contact.email }, project: t.project, depositPercent, lines });
      await ctx.runMutation(internal.quotes.linkContract, { quoteId: a.quoteId, buildId });
    }
    const invoiceId = a.invoice ? await ctx.runMutation(internal.quotes.makeInvoice, { quoteId: a.quoteId, what: a.invoice }) : (t.q.made?.invoiceId ?? null);
    await ctx.runMutation(internal.quotes.doneAsking, { quoteId: a.quoteId });
    return { buildId: a.contract ? buildId : null, invoiceId: a.invoice ? invoiceId : null };
  },
});

// ---------- the person's page: /q/<token> (no account, D81) ----------

async function byToken(ctx: QueryCtx | MutationCtx, token: string) {
  if (!TOKEN.test(token)) return null;
  const q = await ctx.db.query("quotes").withIndex("by_token", (x) => x.eq("token", token)).first();
  return q && q.status !== "draft" ? q : null;
}

export const page = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const q = await byToken(ctx, token);
    if (!q) return null;
    focusBusiness(ctx, q.businessId);
    const b = q.businessId ? await ctx.db.get(q.businessId) : null;
    const project = q.projectId ? await ctx.db.get(q.projectId) : null;
    return {
      number: q.number, title: q.title, status: displayStatus(q), contact: q.contact, lines: q.lines.map((l) => ({ id: l.id, description: l.description, qty: l.qty, unitCents: l.unitCents })),
      discountCents: q.discountCents ?? 0, taxPercent: q.taxPercent ?? 0, deposit: q.deposit, totals: quoteTotals(q), validUntil: q.validUntil, terms: q.terms ?? null,
      issued: q.sentAt ?? q.createdAt, project: project ? (project.jobNumber ? `${project.jobNumber} ${project.name}` : project.name) : q.title,
      response: q.response ? { kind: q.response.kind, name: q.response.name, at: q.response.at } : null, voidedAt: q.voidedAt ?? null,
      business: await paperBusiness(ctx, b),
    };
  },
});

export const markViewed = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const q = await byToken(ctx, token);
    if (!q || q.viewedAt || q.status !== "sent") return null;
    const scope = (ctx as unknown as { scope?: { isOwner: boolean } }).scope;
    if (scope?.isOwner) return null; // the owner checking the page isn't the person viewing it
    focusBusiness(ctx, q.businessId);
    const now = Date.now();
    await ctx.db.patch(q._id, { viewedAt: now, history: [...q.history, { kind: "viewed", at: now, detail: q.contact.name }].slice(-60) });
    return null;
  },
});

/** Accept or decline, from the HTTP endpoint below (so the IP is known). */
export const respondInternal = internalMutation({
  args: { token: v.string(), kind: v.union(v.literal("accepted"), v.literal("declined")), name: v.string(), reason: v.optional(v.string()), ip: v.optional(v.string()), userAgent: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const q = await byToken(ctx, a.token);
    if (!q) return { error: "This quote isn't here." };
    focusBusiness(ctx, q.businessId);
    const status = displayStatus(q);
    if (status === "accepted" || status === "declined") return { error: `This quote was already ${status}.` };
    if (status === "expired") return { error: "This quote has expired. Ask for a new one." };
    if (status === "void") return { error: "This quote was withdrawn." };
    const name = a.name.trim().replace(/\s+/g, " ");
    if (a.kind === "accepted" && (name.length < 2 || name.length > 120)) return { error: "Type your full name to accept." };
    const now = Date.now();
    const response = { kind: a.kind, name: (name || q.contact.name).slice(0, 120), at: now, ...(a.reason?.trim() ? { reason: a.reason.trim().slice(0, 1000) } : {}), ...(a.ip ? { ip: a.ip } : {}), ...(a.userAgent ? { userAgent: a.userAgent.slice(0, 300) } : {}) };
    await ctx.db.patch(q._id, { status: a.kind, response, updatedAt: now, history: [...q.history, { kind: a.kind, at: now, detail: `${response.name}${a.kind === "accepted" ? " (typed name)" : ""}` }].slice(-60) });
    await ctx.scheduler.runAfter(0, internal.quotes.tellOwner, { quoteId: q._id });
    return { ok: true, status: a.kind };
  },
});

/** Emails 20 and 21 to the owner. */
export const tellOwner = internalAction({
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, { quoteId }) => {
    const d = await ctx.runQuery(internal.quotes.mailData, { quoteId });
    if (!d?.q.response) return;
    const r = d.q.response;
    await deliverOnce(ctx, `quote-${r.kind}:${quoteId}`, `quote-${r.kind}`, d.owner, ownerQuoteAnsweredMail(d.brand, {
      kind: r.kind, who: r.name, number: d.q.number, company: d.q.contact.company || d.q.contact.name, title: d.q.title, totalCents: d.q.totalCents,
      at: when(r.at), reason: r.reason ?? null, link: `${SITE()}/payments/quotes/${quoteId}`,
    }), d.brand.replyTo);
  },
});

/** POST /q-respond { token, action: "accept" | "decline", name, reason }: CORS like the signing endpoints. */
export const respond = httpAction(async (ctx, req) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...corsHeaders(req) } });
  let b: { token?: unknown; action?: unknown; name?: unknown; reason?: unknown };
  try { b = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
  if (typeof b.token !== "string" || (b.action !== "accept" && b.action !== "decline")) return json({ error: "Bad request." }, 400);
  const r = await ctx.runMutation(internal.quotes.respondInternal, {
    token: b.token, kind: b.action === "accept" ? "accepted" : "declined", name: typeof b.name === "string" ? b.name.slice(0, 200) : "",
    reason: typeof b.reason === "string" ? b.reason.slice(0, 1200) : undefined, ip: callerIp(req.headers), userAgent: req.headers.get("user-agent") ?? undefined,
  });
  return json(r, "error" in r && r.error ? 409 : 200);
});

/** Owner Home: answered quotes still waiting on the owner (accepted: draft or not; declined: until seen). */
export async function quoteNeeds(ctx: QueryCtx) {
  const out: Array<{ kind: "quote"; at: number; quoteId: Id<"quotes">; number: string; company: string; title: string; what: "accepted" | "declined"; who: string }> = [];
  for (const q of await ctx.db.query("quotes").withIndex("by_updated").order("desc").take(200)) {
    if (!q.response) continue;
    if (q.response.kind === "accepted" && q.asked?.draft) continue;
    if (q.response.kind === "declined" && q.asked?.seen) continue;
    out.push({ kind: "quote", at: q.response.at, quoteId: q._id, number: q.number, company: q.contact.company || q.contact.name, title: q.title, what: q.response.kind, who: q.response.name });
  }
  return out;
}
