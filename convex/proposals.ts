// Phase 3b (Oct 31) · Proposals (S5 · Phase 3b: 710:1588 All proposals, 710:2955 New proposal, 718:4840 Templates,
// 716:4980 / 718:4495 the builder, 717:4509 Send, 717:4588 Start the contract, 723:7952 / 723:8151 the client's page).
// A proposal is a builder draft marked "proposal" (no signature boxes) with its own row here: a number {prefix}-P-0001
// (D85), a status, and once sent the PDF, contact and totals as they were sent. The client needs no account (D73): the
// email's link opens /p/<token>, where they accept or decline (D86) with their typed name, recorded with the time, IP
// and device, the same way quotes and signing record it. Nothing moves or converts on its own (D84): the Send dialog's
// "Also move to Quoted" box is unticked by default, and an accepted proposal asks "Start the contract?" (D75).
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
import { ownerProposalAnsweredMail, proposalMail } from "./lib/mails";
import { deliverOnce } from "./invoiceReminders";
import { callerIp } from "./lib/wsSigning";
import { corsHeaders } from "./signing";
import { fillAgreement, moveCardFor, newAgreementDraft } from "./crm";
import { defaultStyle, insertBuild } from "./builder";
import { nodesOf, pageOf, totals, type BuildDoc, type ExtraSigner, type Fields, type ItemRow, type Page, type Style } from "./lib/wsBuilder";
import { proposalProblems, proposalStarterPage, sectionCount } from "./lib/wsProposal";

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
export const proposalLink = (token: string) => `${SITE()}/p/${token}`;
const when = (t: number) => new Date(t).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const OPEN = new Set(["draft", "waiting", "ready"]);

async function ownerBiz(ctx: QueryCtx | MutationCtx) {
  const me = await requireMe(ctx);
  const id = businessInScope(ctx);
  const b = id ? await ctx.db.get(id) : null;
  if (!b) throw new ConvexError("Not allowed.");
  return { me, b };
}
const by = (me: { name?: string | null; email: string }) => me.name ?? me.email;
const cents = (dollars: number) => Math.round(dollars * 100);

const docOf = (b: Doc<"wsBuilds">): BuildDoc => ({ title: b.title, page: pageOf(b.blocks), fields: b.fields as Fields, signers: (b.signers as ExtraSigner[]) ?? [], style: b.style as Style });
/** The proposal's money: as sent once it's out, else live from its line items and payment block. */
function money(p: Doc<"proposals">, build: Doc<"wsBuilds"> | null) {
  if (p.totalCents !== undefined && !OPEN.has(p.status)) return { totalCents: p.totalCents, depositCents: p.depositCents ?? 0, depositPct: p.depositPct ?? 0, lines: p.lineCount ?? 0 };
  const page = build ? pageOf(build.blocks) : null;
  const t = page ? totals(page) : { total: 0, deposit: 0, depositPct: 0 };
  return { totalCents: cents(t.total), depositCents: cents(t.deposit), depositPct: t.depositPct, lines: page ? itemRows(page).length : 0 };
}
const itemRows = (page: Page) => nodesOf(page, "items").flatMap((n) => (n.attrs?.rows as ItemRow[] | undefined) ?? []).filter((r) => r.description.trim() || r.rate);
const whoOf = (p: Doc<"proposals">, build: Doc<"wsBuilds"> | null) => {
  const c = p.contact ?? (build ? { name: (build.fields as Fields)?.client?.name ?? "", email: (build.fields as Fields)?.client?.email ?? "", company: (build.fields as Fields)?.client?.company || undefined } : { name: "", email: "" });
  return { name: c.name, email: c.email, company: c.company ?? "" };
};

// ---------- the owner: list, get ----------

export const list = query({
  args: {},
  handler: async (ctx) => {
    await ownerBiz(ctx);
    const out = [];
    for (const p of await ctx.db.query("proposals").withIndex("by_updated").order("desc").take(500)) {
      const build = await ctx.db.get(p.buildId);
      const who = whoOf(p, build);
      out.push({
        _id: p._id, number: p.number, title: build?.title ?? "Proposal", status: p.status, company: who.company, contact: who.name, lead: !p.clientId && !!p.dealId,
        totalCents: money(p, build).totalCents, sentAt: p.sentAt ?? null, viewedAt: p.viewedAt ?? null, response: p.response ? { kind: p.response.kind, name: p.response.name, at: p.response.at } : null,
        createdAt: p.createdAt, updatedAt: Math.max(p.updatedAt, build?.updatedAt ?? 0),
      });
    }
    return out;
  },
});

/** One proposal for the builder: its state, money, prompts and what was made from it. */
export const get = query({
  args: { proposalId: v.string() },
  handler: async (ctx, { proposalId }) => {
    await ownerBiz(ctx);
    const id = ctx.db.normalizeId("proposals", proposalId);
    const p = id ? await ctx.db.get(id) : null;
    if (!p) return null;
    const build = await ctx.db.get(p.buildId);
    const contract = p.made?.buildId ? await ctx.db.get(p.made.buildId) : null;
    const deal = p.dealId ? await ctx.db.get(p.dealId) : null;
    const client = p.clientId ? await ctx.db.get(p.clientId) : null;
    return {
      _id: p._id, buildId: p.buildId, number: p.number, status: p.status, drafted: p.drafted ?? null, who: whoOf(p, build), money: money(p, build),
      link: p.token && p.status !== "draft" ? proposalLink(p.token) : null, sentAt: p.sentAt ?? null, viewedAt: p.viewedAt ?? null, message: p.message ?? null,
      response: p.response ? { kind: p.response.kind, name: p.response.name, at: p.response.at, reason: p.response.reason ?? null } : null, asked: p.asked ?? {}, voidedAt: p.voidedAt ?? null,
      deal: deal ? { _id: deal._id, stage: deal.stage, title: deal.title } : null, client: client ? { _id: client._id, name: client.name } : null,
      contract: contract ? { _id: contract._id, title: contract.title } : null, history: p.history,
    };
  },
});

// ---------- the owner: make ----------

/** Fill the client details from a company (its signer first) or a website lead. */
async function clientFields(ctx: MutationCtx, clientId?: Id<"clients"> | null, dealId?: Id<"deals"> | null): Promise<Partial<Fields["client"]>> {
  if (clientId) {
    const c = await ctx.db.get(clientId);
    if (!c) throw new ConvexError("That company isn't here.");
    const people = (await ctx.db.query("clientPeople").withIndex("by_client", (q) => q.eq("clientId", clientId)).collect()).filter((x) => !x.removedAt).sort((a, b) => (a.role === "signer" ? -1 : 1) - (b.role === "signer" ? -1 : 1));
    return { company: c.name, name: people[0]?.name ?? "", email: people[0]?.email ?? "" };
  }
  if (dealId) {
    const d = await ctx.db.get(dealId);
    if (!d) throw new ConvexError("That lead isn't here.");
    if (d.clientId) return clientFields(ctx, d.clientId, null);
    return { company: d.lead?.company ?? "", name: d.lead?.name ?? "", email: d.lead?.email ?? "" };
  }
  return {};
}

async function nextNumber(ctx: MutationCtx, b: Doc<"businesses">) {
  const seq = (b.proposalSeq ?? 0) + 1; // D85: one running count per business; numbers never repeat
  await ctx.db.patch(b._id, { proposalSeq: seq });
  return { seq, number: `${invoicePrefix(b.name)}-P-${String(seq).padStart(4, "0")}` };
}

/** New proposal: from a proposal template, or blank (the standard sections). The questionnaire comes in Step 4. */
export const create = mutation({
  args: { templateId: v.optional(v.id("wsTemplates")), clientId: v.optional(v.id("clients")), dealId: v.optional(v.id("deals")) },
  handler: async (ctx, a) => {
    const { me, b } = await ownerBiz(ctx);
    const t = a.templateId ? await ctx.db.get(a.templateId) : null;
    if (a.templateId && (!t || t.kind !== "proposal")) throw new ConvexError("That proposal template isn't here.");
    const client = await clientFields(ctx, a.clientId, a.dealId);
    const deal = a.dealId ? await ctx.db.get(a.dealId) : null;
    const clientId = a.clientId ?? deal?.clientId ?? undefined;
    const tf = (t?.fields as Partial<Fields> | undefined) ?? {};
    const project = deal?.title || tf.project || "";
    const buildId = await insertBuild(ctx, {
      title: project || client.company || (t ? t.name : "New proposal"), page: t ? pageOf(t.blocks) : proposalStarterPage(),
      fields: { project, custom: tf.custom ?? [], client: { name: "", company: "", email: "", phone: "", address: "", ...client } },
      ...(t ? { style: t.style as Style, templateId: t._id } : {}),
    });
    await ctx.db.patch(buildId, { kind: "proposal" });
    const { seq, number } = await nextNumber(ctx, b);
    const now = Date.now();
    return ctx.db.insert("proposals", {
      buildId, number, seq, status: "draft", ...(t ? { templateId: t._id } : {}), ...(clientId ? { clientId } : {}), ...(a.dealId ? { dealId: a.dealId } : {}),
      history: [{ kind: "created", at: now, by: by(me), ...(t ? { detail: `from the template "${t.name}"` } : {}) }], createdBy: by(me), createdAt: now, updatedAt: now,
    });
  },
});

/** A copy of a sent, declined or withdrawn proposal as a new draft (new number) to change and send again. */
export const copy = mutation({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, { proposalId }) => {
    const { me, b } = await ownerBiz(ctx);
    const p = await ctx.db.get(proposalId);
    const src = p ? await ctx.db.get(p.buildId) : null;
    if (!p || !src) throw new ConvexError("That proposal isn't here.");
    const now = Date.now();
    const buildId = await ctx.db.insert("wsBuilds", { title: src.title, blocks: src.blocks, fields: src.fields, signers: [], style: src.style, kind: "proposal", ...(src.templateId ? { templateId: src.templateId } : {}), createdAt: now, updatedAt: now });
    const { seq, number } = await nextNumber(ctx, b);
    return ctx.db.insert("proposals", {
      buildId, number, seq, status: "draft", ...(p.templateId ? { templateId: p.templateId } : {}), ...(p.clientId ? { clientId: p.clientId } : {}), ...(p.dealId ? { dealId: p.dealId } : {}),
      history: [{ kind: "created", at: now, by: by(me), detail: `a copy of ${p.number}` }], createdBy: by(me), createdAt: now, updatedAt: now,
    });
  },
});

export const deleteDraft = mutation({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, { proposalId }) => {
    await ownerBiz(ctx);
    const p = await ctx.db.get(proposalId);
    if (!p) throw new ConvexError("That proposal isn't here.");
    if (!OPEN.has(p.status)) throw new ConvexError("Only drafts can be deleted. Withdraw a sent proposal instead.");
    if (await ctx.db.get(p.buildId)) await ctx.db.delete(p.buildId);
    await ctx.db.delete(proposalId);
    return null;
  },
});

// ---------- templates (kept apart from contract templates) ----------

export const templates = query({
  args: {},
  handler: async (ctx) => {
    await ownerBiz(ctx);
    const used = new Map<string, number>();
    for (const p of await ctx.db.query("proposals").collect()) if (p.templateId) used.set(p.templateId, (used.get(p.templateId) ?? 0) + 1);
    return (await ctx.db.query("wsTemplates").withIndex("by_updated").order("desc").collect()).filter((t) => t.kind === "proposal").map((t) => ({
      _id: t._id, name: t.name, description: t.description ?? "", sections: sectionCount(pageOf(t.blocks)), used: used.get(t._id) ?? 0, createdAt: t.createdAt, updatedAt: t.updatedAt,
    }));
  },
});

/** New template: the standard sections, opened in the builder to word as you like. */
export const newTemplate = mutation({
  args: {},
  handler: async (ctx) => {
    await ownerBiz(ctx);
    const now = Date.now();
    return ctx.db.insert("wsTemplates", { name: "New proposal template", kind: "proposal", blocks: proposalStarterPage(), fields: { project: "", custom: [] }, style: await defaultStyle(ctx), createdAt: now, updatedAt: now });
  },
});

// ---------- send, withdraw ----------

/** Send (or resend): checks the proposal, keeps the PDF the page rendered, freezes the contact and totals, gives it its
 *  link, and moves the card to Quoted only when the owner ticked the box (D84). Then email 19 goes out. */
export const markSent = internalMutation({
  args: { proposalId: v.id("proposals"), storageId: v.optional(v.id("_storage")), message: v.optional(v.string()), move: v.optional(v.boolean()), resend: v.boolean() },
  handler: async (ctx, a) => {
    const { me } = await ownerBiz(ctx);
    const p = await ctx.db.get(a.proposalId);
    const build = p ? await ctx.db.get(p.buildId) : null;
    if (!p || !build) throw new ConvexError("That proposal isn't here.");
    const now = Date.now();
    if (a.resend) {
      if (p.status !== "sent") throw new ConvexError("Only an open proposal can be sent again.");
      await ctx.db.patch(p._id, { updatedAt: now, history: [...p.history, { kind: "resent", at: now, by: by(me), detail: p.contact?.email }].slice(-60) });
      return { key: `proposal-sent:${p._id}:${now}` };
    }
    if (p.status === "waiting") throw new ConvexError("Claude is still drafting this one.");
    if (!OPEN.has(p.status)) throw new ConvexError("This proposal has already been sent.");
    const d = docOf(build);
    const problems = proposalProblems(d);
    if (problems.length) throw new ConvexError(problems[0]);
    if (!a.storageId) throw new ConvexError("The PDF didn't upload. Try again.");
    const file = await ctx.db.system.get(a.storageId);
    if (!file || file.size > MAX_PDF_BYTES) throw new ConvexError("The PDF didn't upload. Try again.");
    const t = totals(d.page);
    const contact = { name: d.fields.client.name.trim().slice(0, 120), email: d.fields.client.email.trim().toLowerCase().slice(0, 254), ...(d.fields.client.company.trim() ? { company: d.fields.client.company.trim().slice(0, 120) } : {}) };
    let dealId = p.dealId ?? null;
    if (a.move) dealId = await moveCardFor(ctx, { dealId, clientId: p.clientId ?? null, title: d.fields.project || d.title, contactEmail: contact.email, valueCents: cents(t.total), stage: "quoted", detail: `proposal ${p.number} sent`, by: by(me) });
    const token = p.token ?? randomToken(18);
    await ctx.db.patch(p._id, {
      status: "sent", token, pdfId: a.storageId, contact, fromName: d.fields.business.contact?.trim().slice(0, 120) || undefined,
      totalCents: cents(t.total), depositCents: cents(t.deposit), depositPct: t.depositPct, lineCount: itemRows(d.page).length,
      message: a.message?.trim().slice(0, 2000) || undefined, sentAt: now, updatedAt: now, ...(dealId ? { dealId } : {}),
      asked: { ...(p.asked ?? {}), move: a.move ? "yes" : "no" },
      history: [...p.history, { kind: "sent", at: now, by: by(me), detail: contact.email }, ...(a.move ? [{ kind: "moved", at: now, by: by(me), detail: "Quoted" }] : [])].slice(-60),
    });
    await ctx.db.patch(build._id, { renderedAt: now });
    return { key: `proposal-sent:${p._id}:first` };
  },
});

export const mailData = internalQuery({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, { proposalId }) => {
    const p = await ctx.db.get(proposalId);
    const build = p ? await ctx.db.get(p.buildId) : null;
    if (!p?.token || !p.contact || !build) return null;
    const c = await businessContact(ctx, p.businessId ?? null);
    return { p, contact: p.contact, title: build.title, brand: await mailBrandOf(ctx, p.businessId ?? null), owner: c.ownerEmail, link: proposalLink(p.token) };
  },
});

export const send = action({
  args: { proposalId: v.id("proposals"), storageId: v.optional(v.id("_storage")), message: v.optional(v.string()), move: v.optional(v.boolean()), resend: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<{ held: boolean }> => {
    let key: string;
    try { ({ key } = await ctx.runMutation(internal.proposals.markSent, { proposalId: a.proposalId, storageId: a.storageId, message: a.message, move: a.move, resend: !!a.resend })); }
    catch (e) { if (a.storageId && !a.resend) await ctx.storage.delete(a.storageId).catch(() => null); throw e; }
    const d = (await ctx.runQuery(internal.proposals.mailData, { proposalId: a.proposalId }))!;
    const r = await deliverOnce(ctx, key, "proposal", d.contact.email,
      proposalMail(d.brand, { name: d.contact.name, number: d.p.number, title: d.title, totalCents: d.p.totalCents ?? 0, sentAt: d.p.sentAt ?? Date.now(), message: d.p.message ?? null, link: d.link }), d.brand.replyTo);
    if (r === "held") await ctx.runMutation(internal.proposals.note, { proposalId: a.proposalId, kind: "email_held", detail: d.contact.email });
    return { held: r === "held" };
  },
});

export const note = internalMutation({
  args: { proposalId: v.id("proposals"), kind: v.string(), detail: v.optional(v.string()) },
  handler: async (ctx, { proposalId, kind, detail }) => {
    const p = await ctx.db.get(proposalId);
    if (p) await ctx.db.patch(proposalId, { history: [...p.history, { kind, at: Date.now(), ...(detail ? { detail } : {}) }].slice(-60) });
  },
});

export const withdraw = mutation({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, { proposalId }) => {
    const { me } = await ownerBiz(ctx);
    const p = await ctx.db.get(proposalId);
    if (!p) throw new ConvexError("That proposal isn't here.");
    if (p.status !== "sent") throw new ConvexError(OPEN.has(p.status) ? "It hasn't been sent; delete the draft instead." : "Only an open proposal can be withdrawn.");
    const now = Date.now();
    await ctx.db.patch(proposalId, { status: "void", voidedAt: now, updatedAt: now, history: [...p.history, { kind: "withdrawn", at: now, by: by(me) }].slice(-60) });
    return null;
  },
});

// ---------- the owner's prompts (D84) ----------

/** "Not now" on Start the contract (accepted), or "Seen" on a decline: off Home, nothing else changes. */
export const later = mutation({
  args: { proposalId: v.id("proposals"), what: v.union(v.literal("contract"), v.literal("seen")) },
  handler: async (ctx, { proposalId, what }) => {
    await ownerBiz(ctx);
    const p = await ctx.db.get(proposalId);
    if (!p) throw new ConvexError("That proposal isn't here.");
    await ctx.db.patch(proposalId, { asked: { ...(p.asked ?? {}), ...(what === "contract" ? { contract: "later" as const } : { seen: true }) } });
    return null;
  },
});

export const contractTarget = internalQuery({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, { proposalId }) => {
    await ownerBiz(ctx);
    const p = await ctx.db.get(proposalId);
    const build = p ? await ctx.db.get(p.buildId) : null;
    if (!p || !build) throw new ConvexError("That proposal isn't here.");
    if (p.status !== "accepted") throw new ConvexError("The contract starts from an accepted proposal.");
    const existing = p.made?.buildId ? await ctx.db.get(p.made.buildId) : null;
    const d = docOf(build);
    return { p, existing: existing?._id ?? null, project: d.fields.project || d.title, rows: itemRows(d.page), depositPct: p.depositPct ?? totals(d.page).depositPct };
  },
});
export const linkContract = internalMutation({
  args: { proposalId: v.id("proposals"), buildId: v.id("wsBuilds") },
  handler: async (ctx, { proposalId, buildId }) => {
    const { me } = await ownerBiz(ctx);
    const p = await ctx.db.get(proposalId);
    if (!p) return;
    const now = Date.now();
    await ctx.db.patch(proposalId, { made: { buildId }, asked: { ...(p.asked ?? {}), contract: "done" }, updatedAt: now, history: [...p.history, { kind: "contract_drafted", at: now, by: by(me) }].slice(-60) });
  },
});

/** "Start the contract" (D75): a Service Agreement draft in Docs with the client, project, line items and deposit
 *  from the proposal. Nothing is sent; asking twice opens the same draft. */
export const startContract = action({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, { proposalId }): Promise<Id<"wsBuilds">> => {
    const t = await ctx.runQuery(internal.proposals.contractTarget, { proposalId });
    if (t.existing) return t.existing;
    const who = t.p.contact!;
    const buildId = await newAgreementDraft(ctx, who.company || who.name);
    await fillAgreement(ctx, buildId, {
      company: who.company ?? "", signer: { name: who.name, email: who.email }, project: t.project, depositPercent: t.depositPct,
      lines: t.rows.map((r) => ({ description: r.description, qty: Number(r.qty) || 0, rateCents: cents(Number(r.rate) || 0) })),
    });
    await ctx.runMutation(internal.proposals.linkContract, { proposalId, buildId });
    return buildId;
  },
});

// ---------- the client's page: /p/<token> (no account, D73) ----------

async function byToken(ctx: QueryCtx | MutationCtx, token: string) {
  if (!TOKEN.test(token)) return null;
  const p = await ctx.db.query("proposals").withIndex("by_token", (x) => x.eq("token", token)).first();
  return p && !OPEN.has(p.status) && p.contact ? p : null;
}

export const page = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const p = await byToken(ctx, token);
    if (!p) return null;
    focusBusiness(ctx, p.businessId);
    const b = p.businessId ? await ctx.db.get(p.businessId) : null;
    const build = await ctx.db.get(p.buildId);
    return {
      number: p.number, title: build?.title ?? "Proposal", status: p.status as "sent" | "accepted" | "declined" | "void", contact: { name: p.contact!.name, company: p.contact!.company ?? null },
      totalCents: p.totalCents ?? 0, depositCents: p.depositCents ?? 0, depositPct: p.depositPct ?? 0, sentAt: p.sentAt ?? p.createdAt, fromName: p.fromName ?? null,
      pdfUrl: p.pdfId ? await ctx.storage.getUrl(p.pdfId) : null,
      response: p.response ? { kind: p.response.kind, name: p.response.name, at: p.response.at } : null,
      business: { name: b?.name ?? "", logoUrl: b?.logoFileId ? await ctx.storage.getUrl(b.logoFileId) : null },
    };
  },
});

export const markViewed = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const p = await byToken(ctx, token);
    if (!p || p.viewedAt || p.status !== "sent") return null;
    const scope = (ctx as unknown as { scope?: { isOwner: boolean } }).scope;
    if (scope?.isOwner) return null; // the owner checking the page isn't the client reading it
    focusBusiness(ctx, p.businessId);
    const now = Date.now();
    await ctx.db.patch(p._id, { viewedAt: now, history: [...p.history, { kind: "viewed", at: now, detail: p.contact!.name }].slice(-60) });
    return null;
  },
});

/** Accept or decline, from the HTTP endpoint below (so the IP is known). */
export const respondInternal = internalMutation({
  args: { token: v.string(), kind: v.union(v.literal("accepted"), v.literal("declined")), name: v.string(), reason: v.optional(v.string()), ip: v.optional(v.string()), userAgent: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const p = await byToken(ctx, a.token);
    if (!p) return { error: "This proposal isn't here." };
    focusBusiness(ctx, p.businessId);
    if (p.status === "accepted" || p.status === "declined") return { error: `This proposal was already ${p.status}.` };
    if (p.status === "void") return { error: "This proposal was withdrawn." };
    const name = a.name.trim().replace(/\s+/g, " ");
    if (a.kind === "accepted" && (name.length < 2 || name.length > 120)) return { error: "Type your full name to accept." };
    const now = Date.now();
    const response = { kind: a.kind, name: (name || p.contact!.name).slice(0, 120), at: now, ...(a.reason?.trim() ? { reason: a.reason.trim().slice(0, 1000) } : {}), ...(a.ip ? { ip: a.ip } : {}), ...(a.userAgent ? { userAgent: a.userAgent.slice(0, 300) } : {}) };
    await ctx.db.patch(p._id, { status: a.kind, response, updatedAt: now, history: [...p.history, { kind: a.kind, at: now, detail: `${response.name}${a.kind === "accepted" ? " (typed name)" : ""}` }].slice(-60) });
    await ctx.scheduler.runAfter(0, internal.proposals.tellOwner, { proposalId: p._id });
    return { ok: true, status: a.kind };
  },
});

/** Emails 22 and 23 to the owner. */
export const tellOwner = internalAction({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, { proposalId }) => {
    const d = await ctx.runQuery(internal.proposals.mailData, { proposalId });
    if (!d?.p.response) return;
    const r = d.p.response;
    await deliverOnce(ctx, `proposal-${r.kind}:${proposalId}`, `proposal-${r.kind}`, d.owner, ownerProposalAnsweredMail(d.brand, {
      kind: r.kind, who: r.name, number: d.p.number, company: d.contact.company || d.contact.name, title: d.title, totalCents: d.p.totalCents ?? 0,
      at: when(r.at), reason: r.reason ?? null, link: `${SITE()}/proposals/${proposalId}`,
    }), d.brand.replyTo);
  },
});

/** POST /p-respond { token, action: "accept" | "decline", name, reason }: CORS like the signing endpoints. */
export const respond = httpAction(async (ctx, req) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...corsHeaders(req) } });
  let b: { token?: unknown; action?: unknown; name?: unknown; reason?: unknown };
  try { b = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
  if (typeof b.token !== "string" || (b.action !== "accept" && b.action !== "decline")) return json({ error: "Bad request." }, 400);
  const r = await ctx.runMutation(internal.proposals.respondInternal, {
    token: b.token, kind: b.action === "accept" ? "accepted" : "declined", name: typeof b.name === "string" ? b.name.slice(0, 200) : "",
    reason: typeof b.reason === "string" ? b.reason.slice(0, 1200) : undefined, ip: callerIp(req.headers), userAgent: req.headers.get("user-agent") ?? undefined,
  });
  return json(r, "error" in r && r.error ? 409 : 200);
});

/** Owner Home: answered proposals still waiting on the owner (accepted: until the contract starts or "Not now";
 *  declined: until seen). */
export async function proposalNeeds(ctx: QueryCtx) {
  const out: Array<{ kind: "proposal"; at: number; proposalId: Id<"proposals">; number: string; company: string; title: string; what: "accepted" | "declined"; who: string }> = [];
  for (const p of await ctx.db.query("proposals").withIndex("by_updated").order("desc").take(200)) {
    if (!p.response) continue;
    if (p.response.kind === "accepted" && p.asked?.contract) continue;
    if (p.response.kind === "declined" && p.asked?.seen) continue;
    const build = await ctx.db.get(p.buildId);
    out.push({ kind: "proposal", at: p.response.at, proposalId: p._id, number: p.number, company: p.contact?.company || p.contact?.name || "", title: build?.title ?? "Proposal", what: p.response.kind, who: p.response.name });
  }
  return out;
}
