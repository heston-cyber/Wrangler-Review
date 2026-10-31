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
import { WRANGLER_QUESTIONNAIRE, answerList, bound, cleanQuestionnaire, linesTotal, outlineFromAnswers, type Answers, type ClientAnswer, type FileAnswer, type PLine, type Questionnaire } from "./lib/questionnaire";
import { EMPTY_KIT, MAX_FILE_BYTES, MAX_FILES, linkLabel, type Kit } from "./brandKit";
import { pageToMarkdown } from "./lib/wsPageMd";

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
        filling: !!p.filling, totalCents: p.filling ? linesTotal((p.answers as Answers | undefined)?.__lines, undefined).total : money(p, build).totalCents, sentAt: p.sentAt ?? null, viewedAt: p.viewedAt ?? null, response: p.response ? { kind: p.response.kind, name: p.response.name, at: p.response.at } : null,
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
      source: p.source ?? null, filling: !!p.filling, answers: (p.answers ?? null) as Answers | null, qStep: p.qStep ?? 0, deck: p.deck ?? null, title: build?.title ?? "Proposal",
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

/** New proposal: from a proposal template, or blank (the standard sections). */
export const create = mutation({
  args: { templateId: v.optional(v.id("wsTemplates")), clientId: v.optional(v.id("clients")), dealId: v.optional(v.id("deals")) },
  handler: async (ctx, a) => {
    const { me, b } = await ownerBiz(ctx);
    return makeProposal(ctx, me, b, a);
  },
});
async function makeProposal(ctx: MutationCtx, me: { name?: string | null; email: string }, b: Doc<"businesses">, a: { templateId?: Id<"wsTemplates">; clientId?: Id<"clients">; dealId?: Id<"deals">; questionnaire?: boolean }) {
  {
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
    const answers: Answers | undefined = a.questionnaire ? { client: client.email || client.company ? {
      mode: "existing", ...(clientId ? { clientId } : {}), ...(a.dealId ? { dealId: a.dealId } : {}), company: client.company ?? "", name: client.name ?? "", email: client.email ?? "",
    } satisfies ClientAnswer : undefined, ...(deal?.title ? { title: deal.title } : {}) } : undefined;
    return ctx.db.insert("proposals", {
      buildId, number, seq, status: "draft", source: a.questionnaire ? "questionnaire" : t ? "template" : "blank", ...(t ? { templateId: t._id } : {}), ...(clientId ? { clientId } : {}), ...(a.dealId ? { dealId: a.dealId } : {}),
      ...(a.questionnaire ? { filling: true, answers: JSON.parse(JSON.stringify(answers ?? {})), qStep: 0 } : {}),
      history: [{ kind: "created", at: now, by: by(me), ...(t ? { detail: `from the template "${t.name}"` } : a.questionnaire ? { detail: "from the questionnaire" } : {}) }], createdBy: by(me), createdAt: now, updatedAt: now,
    });
  }
}

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

// ---------- the questionnaire (D70, D82, D90): its editor, answering it, and finishing ----------

const questionnaireOf = (b: Doc<"businesses"> | null): Questionnaire => (b?.questionnaire as Questionnaire | undefined) ?? WRANGLER_QUESTIONNAIRE;

export const questionnaire = query({
  args: {},
  handler: async (ctx) => {
    const { b } = await ownerBiz(ctx);
    return { questionnaire: questionnaireOf(b), custom: !!b.questionnaire, wrangler: WRANGLER_QUESTIONNAIRE };
  },
});
export const saveQuestionnaire = mutation({
  args: { questionnaire: v.any() },
  handler: async (ctx, a) => {
    const { b } = await ownerBiz(ctx);
    if (JSON.stringify(a.questionnaire ?? null).length > 60_000) throw new ConvexError("That questionnaire is too long.");
    let q: Questionnaire;
    try { q = cleanQuestionnaire(a.questionnaire); } catch (e) { throw new ConvexError((e as Error).message); }
    await ctx.db.patch(b._id, { questionnaire: q });
    return null;
  },
});
export const resetQuestionnaire = mutation({
  args: {},
  handler: async (ctx) => {
    const { b } = await ownerBiz(ctx);
    await ctx.db.patch(b._id, { questionnaire: undefined });
    return null;
  },
});

/** New proposal › Questionnaire: the proposal (and its number) is made now, so the answers save as you go. */
export const startQuestionnaire = mutation({
  args: { clientId: v.optional(v.id("clients")), dealId: v.optional(v.id("deals")) },
  handler: async (ctx, a) => {
    const { me, b } = await ownerBiz(ctx);
    return makeProposal(ctx, me, b, { ...a, questionnaire: true });
  },
});

const MAX_ANSWERS = 100_000;
const cleanLines = (x: unknown): PLine[] => (Array.isArray(x) ? x : []).slice(0, 40).map((l) => ({
  id: String(l?.id ?? newIdLite()).slice(0, 40), description: String(l?.description ?? "").trim().slice(0, 300), qty: Math.min(10_000, Math.max(0, Number(l?.qty) || 0)),
  unitCents: Math.max(-100_000_000, Math.min(100_000_000, Math.round(Number(l?.unitCents) || 0))),
  ...(typeof l?.suggestedCents === "number" ? { suggestedCents: Math.round(l.suggestedCents) } : {}), ...(l?.note ? { note: String(l.note).slice(0, 200) } : {}), ...(l?.auto ? { auto: String(l.auto).slice(0, 80) } : {}),
}));
const newIdLite = () => Math.random().toString(36).slice(2, 10);

/** Answers save as they're typed (and "Save and finish later" keeps the step). Sent proposals don't change. */
export const saveAnswers = mutation({
  args: { proposalId: v.id("proposals"), answers: v.any(), step: v.optional(v.number()) },
  handler: async (ctx, a) => {
    await ownerBiz(ctx);
    const p = await ctx.db.get(a.proposalId);
    if (!p) throw new ConvexError("That proposal isn't here.");
    if (!OPEN.has(p.status)) throw new ConvexError("This proposal has been sent; its answers can't change.");
    if (!a.answers || typeof a.answers !== "object" || JSON.stringify(a.answers).length > MAX_ANSWERS) throw new ConvexError("Those answers are too long.");
    const answers = { ...(a.answers as Answers), __lines: cleanLines((a.answers as Answers).__lines) };
    await ctx.db.patch(p._id, { answers, ...(a.step !== undefined ? { qStep: Math.max(0, Math.min(20, Math.round(a.step))) } : {}), updatedAt: Date.now() });
    return null;
  },
});

export const answerUploadUrl = mutation({ args: {}, handler: async (ctx) => { await ownerBiz(ctx); return ctx.storage.generateUploadUrl(); } });

/** A file for a questionnaire answer (logo, references): 25 MB a file and 20 files a proposal (D90). A refused file is
 *  deleted and the reason returned (a throw would roll the delete back). */
export const addAnswerFile = mutation({
  args: { proposalId: v.id("proposals"), storageId: v.id("_storage"), name: v.string() },
  handler: async (ctx, a): Promise<FileAnswer | { error: string }> => {
    await ownerBiz(ctx);
    const p = await ctx.db.get(a.proposalId);
    const meta = await ctx.db.system.get(a.storageId);
    const refuse = async (error: string) => { await ctx.storage.delete(a.storageId).catch(() => null); return { error }; };
    if (!p || !OPEN.has(p.status)) return refuse("This proposal can't take files now.");
    if (!meta) return { error: "The file didn't upload. Try again." };
    if (meta.size > MAX_FILE_BYTES) return refuse("That file is over 25 MB. Link to it instead (videos especially).");
    if (filesIn(p.answers as Answers | undefined).length >= MAX_FILES) return refuse(`Up to ${MAX_FILES} files a proposal. Link to the rest instead.`);
    return { fileId: a.storageId, name: a.name.trim().slice(0, 160) || "File", size: meta.size, type: meta.contentType ?? "" };
  },
});
const filesIn = (a: Answers | undefined): FileAnswer[] => Object.values(a ?? {}).flatMap((x) => (Array.isArray(x) ? x.filter((f) => f && typeof f === "object" && "fileId" in f) as FileAnswer[] : []));
export const fileUrls = query({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, { proposalId }) => {
    await ownerBiz(ctx);
    const p = await ctx.db.get(proposalId);
    const out: Record<string, string | null> = {};
    for (const f of filesIn(p?.answers as Answers | undefined)) out[f.fileId] = await ctx.storage.getUrl(f.fileId as Id<"_storage">);
    return out;
  },
});

/** The client the answers name: an existing company or lead, or a new one saved as the owner chose in step 1
 *  (a new lead card, or a new company with its person). */
async function resolveClient(ctx: MutationCtx, me: { name?: string | null; email: string }, c: ClientAnswer | undefined, title: string): Promise<{ clientId?: Id<"clients">; dealId?: Id<"deals">; name: string; email: string; company: string }> {
  if (!c) throw new ConvexError("Answer Client first: who it's for.");
  const email = (c.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email) || email.length > 254) throw new ConvexError("Add the client's email (step 1).");
  if (!(c.name ?? "").trim()) throw new ConvexError("Add the client's name (step 1).");
  const out = { name: c.name.trim().slice(0, 120), email, company: (c.company ?? "").trim().slice(0, 120) };
  if (c.mode === "existing") {
    const clientId = c.clientId ? ctx.db.normalizeId("clients", c.clientId) : null;
    const dealId = c.dealId ? ctx.db.normalizeId("deals", c.dealId) : null;
    if (clientId && !(await ctx.db.get(clientId))) throw new ConvexError("That company isn't here.");
    if (dealId && !(await ctx.db.get(dealId))) throw new ConvexError("That lead isn't here.");
    return { ...out, ...(clientId ? { clientId } : {}), ...(dealId ? { dealId } : {}) };
  }
  const now = Date.now();
  if (c.saveAs === "company") {
    if (!out.company) throw new ConvexError("Add the company name (step 1).");
    const clientId = await ctx.db.insert("clients", { name: out.company, createdAt: now });
    await ctx.db.insert("clientPeople", { clientId, email, name: out.name, role: "signer", createdAt: now });
    return { ...out, clientId };
  }
  const dealId = await ctx.db.insert("deals", {
    title: (title || out.company || out.name).slice(0, 160), contactEmail: email, stage: "lead", source: "hand",
    lead: { name: out.name, email, ...(out.company ? { company: out.company } : {}), ...(c.phone?.trim() ? { phone: c.phone.trim().slice(0, 40) } : {}), fields: c.website?.trim() ? [{ label: "Website", value: c.website.trim().slice(0, 200) }] : [], at: now },
    history: [{ kind: "created", at: now, by: by(me), detail: "from the proposal questionnaire" }], createdAt: now, updatedAt: now,
  });
  return { ...out, dealId };
}

/** The brand answers go into the company's brand kit (D71), added to what's there; a lead keeps them on the proposal. */
async function fillKit(ctx: MutationCtx, clientId: Id<"clients">, qn: Questionnaire, a: Answers) {
  const c = await ctx.db.get(clientId);
  if (!c) return;
  const kit: Kit = { ...EMPTY_KIT, ...((c.brandKit as Partial<Kit> | undefined) ?? {}) };
  const colors = (bound(qn, a, "brand.colors") as string[] | undefined) ?? [];
  for (const hex of colors) if (/^#[0-9a-f]{6}$/i.test(hex) && !kit.colors.some((x) => x.hex.toLowerCase() === hex.toLowerCase())) kit.colors.push({ hex: hex.toUpperCase() });
  const font = (b: string) => { const f = bound(qn, a, b); return typeof f === "string" && f.trim() && f !== "Not sure" ? f.trim().slice(0, 80) : undefined; };
  kit.fonts = { ...kit.fonts, ...(font("brand.heading") ? { heading: font("brand.heading") } : {}), ...(font("brand.body") ? { body: font("brand.body") } : {}) };
  const links = (bound(qn, a, "brand.links") as string[] | string | undefined) ?? [];
  for (const u of (Array.isArray(links) ? links : [links]).map((x) => String(x).trim()).filter((x) => /^https?:\/\//i.test(x))) if (!kit.links.some((l) => l.url === u)) kit.links.push({ url: u.slice(0, 500), label: linkLabel(u) });
  for (const w of ((bound(qn, a, "brand.tone") as string[] | undefined) ?? [])) if (w && !kit.tone.includes(w)) kit.tone.push(String(w).slice(0, 40));
  const logo = ((bound(qn, a, "brand.logo") as FileAnswer[] | undefined) ?? []);
  const now = Date.now();
  logo.forEach((f, i) => {
    if (i === 0 && !kit.logoFileId && /image\//.test(f.type)) kit.logoFileId = f.fileId as Id<"_storage">;
    else if (!kit.files.some((x) => x.fileId === f.fileId) && kit.files.length < MAX_FILES) kit.files.push({ fileId: f.fileId as Id<"_storage">, name: f.name, size: f.size, type: f.type, addedAt: now, source: "questionnaire" });
  });
  kit.colors = kit.colors.slice(0, 24); kit.links = kit.links.slice(0, 40); kit.tone = kit.tone.slice(0, 30);
  await ctx.db.patch(clientId, { brandKit: kit });
}

/** Review's choice: "Draft with Claude" (waits for Claude through the connector) or "Fill in myself" (the answers in a
 *  plain outline). Either way the builder gets the outline, the client, title and project; nothing is sent. */
export const finish = mutation({
  args: { proposalId: v.id("proposals"), how: v.union(v.literal("claude"), v.literal("self")) },
  handler: async (ctx, a) => {
    const { me, b } = await ownerBiz(ctx);
    const p = await ctx.db.get(a.proposalId);
    const build = p ? await ctx.db.get(p.buildId) : null;
    if (!p || !build) throw new ConvexError("That proposal isn't here.");
    if (!OPEN.has(p.status)) throw new ConvexError("This proposal has been sent.");
    const qn = questionnaireOf(b);
    const ans = (p.answers ?? {}) as Answers;
    for (const s of qn.steps) for (const qq of s.questions) {
      const v0 = ans[qq.id];
      if (qq.required && (v0 === undefined || v0 === null || v0 === "" || (Array.isArray(v0) && !v0.length))) throw new ConvexError(`Answer "${qq.label}" (${s.title}).`);
    }
    const title = String(bound(qn, ans, "project.title") ?? "").trim().slice(0, 120);
    const who = await resolveClient(ctx, me, bound(qn, ans, "client") as ClientAnswer | undefined, title);
    const clientId = who.clientId ?? p.clientId;
    if (clientId) await fillKit(ctx, clientId, qn, ans);
    const f = build.fields as Fields;
    const fields: Fields = { ...f, project: title || f.project, client: { ...f.client, name: who.name, email: who.email, company: who.company } };
    const fresh = !!p.filling || p.status === "waiting"; // never overwrite a page Claude or the owner already wrote
    await ctx.db.patch(build._id, { title: title || build.title, fields, ...(fresh ? { blocks: outlineFromAnswers(qn, ans) } : {}), updatedAt: Date.now() });
    const now = Date.now();
    await ctx.db.patch(p._id, {
      filling: false, status: a.how === "claude" ? "waiting" : p.status === "waiting" ? "draft" : p.status, ...(clientId ? { clientId } : {}), ...(who.dealId ? { dealId: who.dealId } : {}), updatedAt: now,
      history: [...p.history, { kind: a.how === "claude" ? "asked_claude" : "filled_in", at: now, by: by(me) }].slice(-60),
    });
    return null;
  },
});

/** "Fill in myself instead" on the waiting page: the outline is already in the builder. */
export const fillInstead = mutation({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, { proposalId }) => {
    await ownerBiz(ctx);
    const p = await ctx.db.get(proposalId);
    if (!p) throw new ConvexError("That proposal isn't here.");
    if (p.status === "waiting") await ctx.db.patch(proposalId, { status: "draft", updatedAt: Date.now() });
    return null;
  },
});
export const dismissDrafted = mutation({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, { proposalId }) => {
    await ownerBiz(ctx);
    const p = await ctx.db.get(proposalId);
    if (p?.drafted) await ctx.db.patch(proposalId, { drafted: undefined });
    return null;
  },
});

/** "Make a pitch deck" (D72): which brand kit and the owner's note, kept for Claude to read through the connector. */
export const setDeck = mutation({
  args: { proposalId: v.id("proposals"), kit: v.union(v.literal("business"), v.literal("client")), note: v.optional(v.string()), asked: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    await ownerBiz(ctx);
    const p = await ctx.db.get(a.proposalId);
    if (!p) throw new ConvexError("That proposal isn't here.");
    const note = a.note !== undefined ? a.note.trim().slice(0, 1000) : p.deck?.note;
    await ctx.db.patch(p._id, { deck: { kit: a.kit, ...(note ? { note } : {}), ...(a.asked ? { askedAt: Date.now() } : p.deck?.askedAt ? { askedAt: p.deck.askedAt } : {}) } });
    return null;
  },
});

// ---------- the Sign connector's proposal tools (D89): Claude reads the answers, writes the draft, makes the deck ----------

export const connectorFind = internalQuery({
  args: { ref: v.string() },
  handler: async (ctx, { ref }): Promise<{ ok: true; proposalId: Id<"proposals"> } | { ok: false; error: string }> => {
    const r = ref.trim();
    if (!r) return { ok: false, error: "Pass the proposal: its number (e.g. WRNGLR-P-0007), its proposal_id, or words from its title." };
    const id = ctx.db.normalizeId("proposals", r);
    if (id && (await ctx.db.get(id))) return { ok: true, proposalId: id };
    const rows = await ctx.db.query("proposals").withIndex("by_updated").order("desc").take(300);
    const byNum = rows.find((p) => p.number.toLowerCase() === r.toLowerCase());
    if (byNum) return { ok: true, proposalId: byNum._id };
    const words = r.toLowerCase().split(/\s+/);
    const hits = [];
    for (const p of rows) { const b = await ctx.db.get(p.buildId); if (b && words.every((w) => b.title.toLowerCase().includes(w))) hits.push(p); }
    if (hits.length === 1) return { ok: true, proposalId: hits[0]._id };
    return { ok: false, error: hits.length ? `${hits.length} proposals match "${r}"; pass its number.` : `No proposal matches "${r}". list_proposals shows them.` };
  },
});

export const connectorList = internalQuery({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, { status }) => {
    const out = [];
    for (const p of await ctx.db.query("proposals").withIndex("by_updated").order("desc").take(100)) {
      if (status && status !== "all" && p.status !== status) continue;
      const b = await ctx.db.get(p.buildId);
      const c = p.contact ?? { name: (b?.fields as Fields)?.client?.name ?? "", company: (b?.fields as Fields)?.client?.company ?? "" };
      out.push({ proposal: p.number, proposal_id: p._id, title: b?.title ?? "", status: p.filling ? "questionnaire" : p.status, client: [c.company, c.name].filter(Boolean).join(" · ") || null, link: `${SITE()}/proposals/${p._id}`, updated: new Date(p.updatedAt).toISOString() });
    }
    return out;
  },
});

async function kitOut(ctx: QueryCtx, row: { name: string; brandKit?: unknown; logoFileId?: Id<"_storage">; accent?: string; background?: string } | null) {
  if (!row) return null;
  const k: Kit = { ...EMPTY_KIT, ...((row.brandKit as Partial<Kit> | undefined) ?? {}) };
  const url = async (id?: Id<"_storage">) => (id ? await ctx.storage.getUrl(id) : null);
  return {
    name: row.name, logo_url: (await url(k.logoFileId)) ?? (await url(row.logoFileId)), colors: [...[row.accent, row.background].filter(Boolean).map((hex) => ({ hex: hex! })), ...k.colors],
    fonts: k.fonts, links: k.links, tone_words: k.tone, files: await Promise.all(k.files.map(async (f) => ({ name: f.name, type: f.type, url: await url(f.fileId) }))),
  };
}

/** Everything Claude needs for the draft and the deck. */
export const connectorGet = internalQuery({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, { proposalId }) => {
    const p = await ctx.db.get(proposalId);
    const build = p ? await ctx.db.get(p.buildId) : null;
    if (!p || !build) return null;
    const biz = p.businessId ? await ctx.db.get(p.businessId) : null;
    const qn = questionnaireOf(biz);
    const ans = (p.answers ?? {}) as Answers;
    const client = p.clientId ? await ctx.db.get(p.clientId) : null;
    const d = docOf(build);
    const t = totals(d.page);
    const brandAnswers = { colors: bound(qn, ans, "brand.colors") ?? [], fonts: { heading: bound(qn, ans, "brand.heading") ?? null, body: bound(qn, ans, "brand.body") ?? null }, links: bound(qn, ans, "brand.links") ?? [], tone_words: bound(qn, ans, "brand.tone") ?? [] };
    const files = [];
    for (const f of filesIn(ans)) files.push({ name: f.name, type: f.type, url: await ctx.storage.getUrl(f.fileId as Id<"_storage">) });
    return {
      number: p.number, status: p.status, filling: !!p.filling, title: build.title, link: `${SITE()}/proposals/${p._id}`,
      client: { name: d.fields.client.name, email: d.fields.client.email, company: d.fields.client.company }, project: d.fields.project,
      business: { name: d.fields.business.name, contact: d.fields.business.contact },
      answers: answerList(qn, ans), lines: (ans.__lines ?? []).map((l) => ({ description: l.description, qty: l.qty, rate: l.unitCents / 100, ...(l.suggestedCents !== undefined && l.suggestedCents !== l.unitCents ? { suggested_rate: l.suggestedCents / 100, overridden: true } : {}) })),
      investment: { total: t.total, deposit_percent: t.depositPct, deposit: t.deposit }, markdown: pageToMarkdown(d.page),
      deck: { kit: p.deck?.kit ?? (client ? "client" : "business"), note: p.deck?.note ?? null },
      kits: { business: await kitOut(ctx, biz), client: client ? await kitOut(ctx, client) : null, from_answers: { ...brandAnswers, files } },
    };
  },
});

/** write_proposal_draft: Claude's page replaces the outline; the owner sees "Drafted by Claude: review before sending". */
export const connectorWrite = internalMutation({
  args: { proposalId: v.id("proposals"), page: v.any(), title: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const p = await ctx.db.get(a.proposalId);
    const build = p ? await ctx.db.get(p.buildId) : null;
    if (!p || !build) throw new ConvexError("That proposal isn't here.");
    if (!OPEN.has(p.status)) throw new ConvexError(`Proposal ${p.number} has been sent, so it can't change.`);
    if (p.filling) throw new ConvexError(`Heston hasn't finished the questionnaire for ${p.number} yet.`);
    const page = pageOf(a.page);
    if (nodesOf(page, "signatures").length) throw new ConvexError("Proposals aren't signed: leave out the signature block.");
    if (JSON.stringify(page).length > 400_000) throw new ConvexError("That's too much content for one proposal.");
    const now = Date.now();
    await ctx.db.patch(build._id, { blocks: page, ...(a.title?.trim() ? { title: a.title.trim().slice(0, 120) } : {}), updatedAt: now });
    await ctx.db.patch(p._id, { status: "ready", drafted: "claude", updatedAt: now, history: [...p.history, { kind: "drafted", at: now, by: "Claude" }].slice(-60) });
    return null;
  },
});
