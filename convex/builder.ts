// Wrangler Sign doc builder, backend (B2–B3, Oct 27). Owner-only throughout.
//   builds     the editable source of a built document (blocks, fields, signers, style)
//   templates  saved starting points; the Service Agreement starter is added once
//   clauses    the reusable clause library
//   styles     saved looks (with the built-in presets in lib/wsBuilder.ts) and which one new docs start with
//   fonts      font files for documents: uploaded, picked from the computer, or fetched from Google Fonts
//   profile    the business details new documents start with
// "Continue to signing" takes the PDF the page rendered and turns the build into a Wrangler Sign document (or rebuilds
// its draft), with boxes placed from the markers the renderer wrote and the signers and deposit from the build.
import { action, type ActionCtx, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireMe } from "./lib/access";
import {
  DEFAULT_BUSINESS, DEFAULT_STYLE, MAX_BUILD_JSON, PRESET_STYLES, buildProblems, emptyFields, newId, totals,
  line, pageOf, textOf, type Business, type BuildDoc, type ExtraSigner, type Fields, type ItemRow, type Page, type PNode, type Style,
} from "./lib/wsBuilder";
import { serviceAgreementBlocks, serviceAgreementPage } from "./lib/wsStarter";
import { pdfLinesToPage, type ImportResult } from "./lib/wsPdfImport";
import { applyScan } from "./lib/wsMarkers";
import { OWNER_KEY, docLabel, type LayoutBox, type LayoutSigner } from "./lib/wsLayout";
import { safeFileName } from "./lib/wsFinal";
import { withoutPrices } from "./lib/wsProposal";

const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^.*ConvexError: /, "").split("\n")[0].slice(0, 300);
function tooBig(...xs: unknown[]) { if (JSON.stringify(xs).length > MAX_BUILD_JSON) throw new ConvexError("That's too much content for one document."); }
const clean = (s: string, n = 120) => s.trim().slice(0, n);
// Phase 3b: proposals live in the builder too (kind "proposal"), but never in Docs' lists, never go to signing, and
// can't change once sent (the client is reading the PDF that was sent).
const isProposal = (x: { kind?: string } | null | undefined) => x?.kind === "proposal";
async function assertEditable(ctx: QueryCtx, b: { _id: Id<"wsBuilds">; kind?: string }) {
  if (!isProposal(b)) return;
  const p = await ctx.db.query("proposals").withIndex("by_build", (q) => q.eq("buildId", b._id)).first();
  if (p && p.status !== "draft" && p.status !== "ready" && p.status !== "waiting") throw new ConvexError(`Proposal ${p.number} has been sent, so it can't change. Make a copy to change it.`);
}

// ---------- profile and default style ----------

async function profile(ctx: QueryCtx): Promise<Business> {
  const row = await ctx.db.query("wsProfile").first();
  return { ...DEFAULT_BUSINESS, ...((row?.business as Partial<Business>) ?? {}) };
}
export async function defaultStyle(ctx: QueryCtx): Promise<Style> {
  const rows = await ctx.db.query("wsStyles").collect();
  const def = rows.find((r) => r.isDefault);
  if (def) return def.style as Style;
  const preset = (await ctx.db.query("counters").withIndex("by_key", (q) => q.eq("key", "wsDefaultPreset")).first())?.value ?? 0;
  return PRESET_STYLES[preset] ?? DEFAULT_STYLE;
}

export const getProfile = query({ args: {}, handler: async (ctx) => { await requireMe(ctx); return profile(ctx); } });
export const saveProfile = mutation({
  args: { business: v.object({ name: v.string(), legalName: v.string(), contact: v.string(), title: v.string(), email: v.string(), phone: v.string(), address: v.string() }) },
  handler: async (ctx, { business }) => {
    await requireMe(ctx);
    const b = Object.fromEntries(Object.entries(business).map(([k, x]) => [k, clean(x, 200)]));
    const row = await ctx.db.query("wsProfile").first();
    if (row) await ctx.db.patch(row._id, { business: b, updatedAt: Date.now() }); else await ctx.db.insert("wsProfile", { business: b, updatedAt: Date.now() });
    return null;
  },
});

// ---------- builds ----------

export const listBuilds = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const rows = (await ctx.db.query("wsBuilds").withIndex("by_updated").order("desc").take(300)).filter((b) => !isProposal(b));
    return rows.map((b) => ({ _id: b._id, title: b.title, updatedAt: b.updatedAt, createdAt: b.createdAt, documentId: b.documentId ?? null, client: ((b.fields as Fields)?.client?.name) || "" }));
  },
});

export const getBuild = query({
  args: { buildId: v.id("wsBuilds") },
  handler: async (ctx, { buildId }) => {
    await requireMe(ctx);
    const b = await ctx.db.get(buildId);
    if (!b) return null;
    const doc = b.documentId ? await ctx.db.get(b.documentId) : null;
    return { ...b, document: doc ? { _id: doc._id, label: docLabel(doc.number), status: doc.status } : null };
  },
});

export const createBuild = mutation({
  args: { templateId: v.optional(v.id("wsTemplates")), blank: v.optional(v.boolean()) },
  handler: async (ctx, { templateId }) => {
    await requireMe(ctx);
    const now = Date.now();
    const business = await profile(ctx);
    const t = templateId ? await ctx.db.get(templateId) : null;
    if (templateId && !t) throw new ConvexError("That template doesn't exist.");
    if (isProposal(t)) throw new ConvexError("That's a proposal template. Use it from Proposals.");
    const fields: Fields = t ? { ...emptyFields(business), ...(t.fields as Partial<Fields>), business, client: emptyFields(business).client, date: emptyFields(business).date } : emptyFields(business);
    const blocks: Page = t ? freshIds(pageOf(t.blocks)) : { type: "doc", content: [
      line("Untitled document", { size: "title" }),
      line("Parties", { size: "heading" }), { type: "parties", attrs: {} },
      line(""),
      line("Signatures", { size: "heading" }), { type: "signatures", attrs: { signers: ["heston", "client"], showTitle: true, showDate: true } },
    ] };
    const style = t ? (t.style as Style) : await defaultStyle(ctx);
    return ctx.db.insert("wsBuilds", { title: t ? t.name : "Untitled document", blocks, fields, signers: [], style, ...(t ? { templateId: t._id } : {}), createdAt: now, updatedAt: now });
  },
});
// A copy of a template gets fresh line-item ids, so two documents never share row ids.
function freshIds(page: Page): Page {
  const fix = (n: PNode): PNode => n.type === "items" ? { ...n, attrs: { ...n.attrs, rows: ((n.attrs?.rows as ItemRow[]) ?? []).map((r) => ({ ...r, id: newId() })) } } : n.content ? { ...n, content: n.content.map(fix) } : n;
  return fix(page as PNode) as Page;
}
// The page as sent: a ProseMirror document (E1), or B2's list of blocks from an older page still open somewhere.
const isPage = (x: unknown) => Array.isArray(x) || (!!x && typeof x === "object" && (x as Page).type === "doc" && Array.isArray((x as Page).content));

const docArgs = { title: v.string(), blocks: v.any(), fields: v.any(), signers: v.any(), style: v.any() };

export const saveBuild = mutation({
  args: { buildId: v.id("wsBuilds"), ...docArgs },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const b = await ctx.db.get(a.buildId);
    if (!b) throw new ConvexError("That document doesn't exist.");
    await assertEditable(ctx, b);
    tooBig(a.blocks, a.fields, a.signers, a.style);
    if (!isPage(a.blocks) || !Array.isArray(a.signers)) throw new ConvexError("That document isn't in the right shape.");
    await ctx.db.patch(a.buildId, { title: clean(a.title) || "Untitled document", blocks: a.blocks, fields: a.fields, signers: a.signers, style: a.style, updatedAt: Date.now() });
    return null;
  },
});

export const deleteBuild = mutation({
  args: { buildId: v.id("wsBuilds") },
  handler: async (ctx, { buildId }) => {
    await requireMe(ctx);
    const b = await ctx.db.get(buildId);
    if (!b) return null;
    if (isProposal(b)) throw new ConvexError("This is a proposal. Delete it from Proposals.");
    if (b.documentId && (await ctx.db.get(b.documentId))) throw new ConvexError("This one has gone to signing; it stays with its document.");
    await ctx.db.delete(buildId);
    return null;
  },
});

export const buildForSigning = internalQuery({
  args: { buildId: v.id("wsBuilds") },
  handler: async (ctx, { buildId }) => {
    const b = await ctx.db.get(buildId);
    if (!b) return null;
    const doc = b.documentId ? await ctx.db.get(b.documentId) : null;
    return { build: b, doc };
  },
});

export const linkBuild = internalMutation({
  args: { buildId: v.id("wsBuilds"), documentId: v.id("wsDocuments") },
  handler: async (ctx, { buildId, documentId }) => {
    const b = (await ctx.db.get(buildId))!;
    const st = b.style as Style;
    const img = st.backdropImage?.fileId ? (st.backdropImage.fileId as Id<"_storage">) : null;
    await ctx.db.patch(buildId, { documentId, renderedAt: Date.now() });
    // The signing page's background comes from the document's style (its backdrop colour or image).
    await ctx.db.patch(documentId, { buildId, look: { backdrop: /^#[0-9a-f]{3,8}$/i.test(st.backdrop) ? st.backdrop : "#e9e7e2", ...(img ? { backdropImageId: img } : {}) } });
    return null;
  },
});

/** The page rendered the build to a PDF and uploaded it; make or rebuild its document. */
export const toSigning = action({
  args: { buildId: v.id("wsBuilds"), storageId: v.id("_storage") },
  handler: async (ctx, { buildId, storageId }): Promise<{ documentId: Id<"wsDocuments">; label: string; rebuilt: boolean }> => {
    await ctx.runQuery(internal.users.assertAllowed, { ids: [buildId] });
    try { return await toSigningCore(ctx, buildId, storageId); }
    catch (e) { throw new ConvexError(errText(e)); }
  },
});

export async function toSigningCore(ctx: ActionCtx, buildId: Id<"wsBuilds">, storageId: Id<"_storage">, actor = OWNER_KEY) {
  const r = await ctx.runQuery(internal.builder.buildForSigning, { buildId });
  if (!r) { await ctx.storage.delete(storageId); throw new Error("That document doesn't exist."); }
  if (isProposal(r.build)) { await ctx.storage.delete(storageId); throw new Error("Proposals aren't signed. Send it from Proposals; once it's accepted, Start the contract makes the agreement."); }
  const d: BuildDoc = { title: r.build.title, page: pageOf(r.build.blocks), fields: r.build.fields as Fields, signers: (r.build.signers as ExtraSigner[]) ?? [], style: r.build.style as Style };
  const problems = buildProblems(d);
  if (problems.length) { await ctx.storage.delete(storageId); throw new Error(problems[0]); }
  const fileName = `${safeFileName(d.title)}.pdf`;
  let documentId: Id<"wsDocuments">, label: string, rebuilt = false;
  if (!r.doc) {
    const made = await ctx.runAction(internal.sign.createAs, { storageId, fileName, title: d.title, actor });
    documentId = made.documentId; label = made.label;
    await ctx.runMutation(internal.builder.linkBuild, { buildId, documentId });
  } else {
    const doc = r.doc;
    if (doc.status === "sent") { await ctx.storage.delete(storageId); throw new Error(`${docLabel(doc.number)} is out for signature. Cancel it first, then rebuild.`); }
    if (doc.status === "completed") { await ctx.storage.delete(storageId); throw new Error(`${docLabel(doc.number)} is signed and can't change. Duplicate it as a new document instead.`); }
    const info = await ctx.runAction(internal.sign.inspectUpload, { storageId });
    if (doc.status === "draft") await ctx.runMutation(internal.sign.replaceDraftFile, { documentId: doc._id, storageId, fileName, title: d.title, ...info });
    else await ctx.runMutation(internal.sign.insertReplacement, { documentId: doc._id, storageId, fileName, ...info });
    documentId = doc._id; label = docLabel(doc.number); rebuilt = true;
    await ctx.runMutation(internal.builder.linkBuild, { buildId, documentId });
  }
  // Boxes from the markers the renderer wrote (they're invisible, so no white covers are needed), and the signers and
  // deposit from the build.
  const got = await ctx.runQuery(internal.sign.getAs, { documentId });
  const scan = await ctx.runAction(internal.wsNode.findMarkers, { storageId: got!.version.fileId });
  const layout = applyScan({ signers: [] as LayoutSigner[], boxes: [] as LayoutBox[] }, scan, true);
  const boxes = layout.boxes.map(({ cover: _c, ...b }) => b);
  const keys = new Set(boxes.map((b) => b.signer));
  const signers: LayoutSigner[] = [];
  if (keys.has(OWNER_KEY)) signers.push({ key: OWNER_KEY, name: "", email: "", order: 1 });
  if (keys.has("client")) signers.push({ key: "client", name: d.fields.client.name.trim(), email: d.fields.client.email.trim().toLowerCase(), order: 1 });
  for (const k of [...keys].filter((k) => k !== OWNER_KEY && k !== "client").sort()) {
    const s = d.signers.find((x) => x.key === k);
    signers.push({ key: k, name: s?.name.trim() ?? "", email: s?.email.trim().toLowerCase() ?? "", ...(s?.title.trim() ? { title: s.title.trim() } : {}), order: 1 });
  }
  const t = totals(d.page);
  const payment = t.invoiceDeposit ? { amountCents: Math.round(t.deposit * 100), description: `Deposit (${t.depositPct}%)${d.fields.project ? `: ${d.fields.project}` : ""}`.slice(0, 200) } : null;
  await ctx.runMutation(internal.sign.saveLayoutAs, { versionId: got!.version._id, title: d.title, signers, boxes, signingOrder: "any", payment, hasTextLayer: true });
  return { documentId, label, rebuilt };
}

// ---------- templates ----------

export const listTemplates = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const rows = (await ctx.db.query("wsTemplates").withIndex("by_updated").order("desc").collect()).filter((t) => !isProposal(t));
    return rows.map((t) => ({ _id: t._id, name: t.name, description: t.description ?? "", updatedAt: t.updatedAt, blocks: pageOf(t.blocks).content.length, styleName: (t.style as Style)?.name ?? "" }));
  },
});

export const getTemplate = query({
  args: { templateId: v.id("wsTemplates") },
  handler: async (ctx, { templateId }) => { await requireMe(ctx); return ctx.db.get(templateId); },
});

export const saveAsTemplate = mutation({
  args: { name: v.string(), description: v.optional(v.string()), kind: v.optional(v.literal("proposal")), ...docArgs },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    tooBig(a.blocks, a.fields, a.style);
    const name = clean(a.name);
    if (!name) throw new ConvexError("Name the template.");
    const f = a.fields as Fields;
    // A template keeps the project and custom field names, never a client's details.
    const fields = { project: f?.project ?? "", custom: (f?.custom ?? []).map((c) => ({ key: c.key, label: c.label, value: "" })) };
    const now = Date.now();
    // A proposal template keeps the wording and lines, never the prices (they come from Settings › Pricing each time).
    const blocks = a.kind === "proposal" && isPage(a.blocks) && !Array.isArray(a.blocks) ? withoutPrices(a.blocks as Page) : a.blocks;
    return ctx.db.insert("wsTemplates", { name, description: clean(a.description ?? "", 300) || undefined, ...(a.kind ? { kind: a.kind } : {}), blocks, fields, style: a.style, createdAt: now, updatedAt: now });
  },
});

export const updateTemplate = mutation({
  args: { templateId: v.id("wsTemplates"), name: v.string(), description: v.optional(v.string()), blocks: v.any(), fields: v.any(), style: v.any() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const t0 = await ctx.db.get(a.templateId);
    if (!t0) throw new ConvexError("That template doesn't exist.");
    tooBig(a.blocks, a.fields, a.style);
    // A proposal template never keeps prices (review fix): they come from Settings › Pricing each time.
    const blocks = isProposal(t0) && isPage(a.blocks) && !Array.isArray(a.blocks) ? withoutPrices(a.blocks as Page) : a.blocks;
    await ctx.db.patch(a.templateId, { name: clean(a.name) || "Untitled template", description: clean(a.description ?? "", 300) || undefined, blocks, fields: a.fields, style: a.style, updatedAt: Date.now() });
    return null;
  },
});

export const duplicateTemplate = mutation({
  args: { templateId: v.id("wsTemplates") },
  handler: async (ctx, { templateId }) => {
    await requireMe(ctx);
    const t = await ctx.db.get(templateId);
    if (!t) throw new ConvexError("That template doesn't exist.");
    const now = Date.now();
    return ctx.db.insert("wsTemplates", { name: `${t.name} (copy)`.slice(0, 120), description: t.description, ...(t.kind ? { kind: t.kind } : {}), blocks: freshIds(pageOf(t.blocks)), fields: t.fields, style: t.style, createdAt: now, updatedAt: now });
  },
});

export const deleteTemplate = mutation({
  args: { templateId: v.id("wsTemplates") },
  handler: async (ctx, { templateId }) => {
    await requireMe(ctx);
    await ctx.db.delete(templateId); // documents made from it keep their own copy
    return null;
  },
});

/** The Service Agreement starter and its clauses, added once (deleting them later is Heston's call; they don't return). */
export const ensureStarter = mutation({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const done = await ctx.db.query("counters").withIndex("by_key", (q) => q.eq("key", "wsStarterMade")).first();
    if (done) return { added: false };
    await ctx.db.insert("counters", { key: "wsStarterMade", value: 1 });
    const now = Date.now();
    await ctx.db.insert("wsTemplates", { name: "Service Agreement", description: "Your service agreement (from CONTRACT.md). Pick one revisions clause before sending.", blocks: serviceAgreementPage(), fields: { project: "", custom: [] }, style: await defaultStyle(ctx), createdAt: now, updatedAt: now });
    for (const b of serviceAgreementBlocks()) if (b.type === "clause") await ctx.db.insert("wsClauses", { title: b.title, body: b.rich, initials: b.initials, createdAt: now, updatedAt: now });
    return { added: true };
  },
});

// ---------- clauses ----------

export const listClauses = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    return (await ctx.db.query("wsClauses").withIndex("by_updated").order("desc").collect()).sort((a, b) => a.title.localeCompare(b.title));
  },
});

export const saveClause = mutation({
  args: { clauseId: v.optional(v.id("wsClauses")), title: v.string(), body: v.any(), initials: v.boolean() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    tooBig(a.body);
    const title = clean(a.title);
    if (!title) throw new ConvexError("Give the clause a title.");
    const now = Date.now();
    if (a.clauseId) { await ctx.db.patch(a.clauseId, { title, body: a.body, initials: a.initials, updatedAt: now }); return a.clauseId; }
    return ctx.db.insert("wsClauses", { title, body: a.body, initials: a.initials, createdAt: now, updatedAt: now });
  },
});

export const duplicateClause = mutation({
  args: { clauseId: v.id("wsClauses") },
  handler: async (ctx, { clauseId }) => {
    await requireMe(ctx);
    const c = await ctx.db.get(clauseId);
    if (!c) throw new ConvexError("That clause doesn't exist.");
    const now = Date.now();
    return ctx.db.insert("wsClauses", { title: `${c.title} (copy)`.slice(0, 120), body: c.body, initials: c.initials, createdAt: now, updatedAt: now });
  },
});

export const deleteClause = mutation({
  args: { clauseId: v.id("wsClauses") },
  handler: async (ctx, { clauseId }) => { await requireMe(ctx); await ctx.db.delete(clauseId); return null; },
});

// ---------- styles ----------

export const listStyles = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const saved = await ctx.db.query("wsStyles").withIndex("by_updated").order("desc").collect();
    const preset = (await ctx.db.query("counters").withIndex("by_key", (q) => q.eq("key", "wsDefaultPreset")).first())?.value ?? 0;
    const anySaved = saved.some((s) => s.isDefault);
    return {
      presets: PRESET_STYLES.map((s, i) => ({ index: i, style: s, isDefault: !anySaved && i === preset })),
      saved: saved.map((s) => ({ _id: s._id, name: s.name, style: s.style as Style, isDefault: s.isDefault })),
    };
  },
});

export const saveStyle = mutation({
  args: { styleId: v.optional(v.id("wsStyles")), name: v.string(), style: v.any() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    tooBig(a.style);
    const name = clean(a.name, 60);
    if (!name) throw new ConvexError("Name the style.");
    const style = { ...(a.style as Style), name };
    const now = Date.now();
    if (a.styleId) { await ctx.db.patch(a.styleId, { name, style, updatedAt: now }); return a.styleId; }
    return ctx.db.insert("wsStyles", { name, style, isDefault: false, createdAt: now, updatedAt: now });
  },
});

export const setDefaultStyle = mutation({
  args: { styleId: v.optional(v.id("wsStyles")), preset: v.optional(v.number()) },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    for (const s of await ctx.db.query("wsStyles").collect()) if (s.isDefault && s._id !== a.styleId) await ctx.db.patch(s._id, { isDefault: false });
    if (a.styleId) { await ctx.db.patch(a.styleId, { isDefault: true }); return null; }
    const i = Math.max(0, Math.min(PRESET_STYLES.length - 1, a.preset ?? 0));
    const row = await ctx.db.query("counters").withIndex("by_key", (q) => q.eq("key", "wsDefaultPreset")).first();
    if (row) await ctx.db.patch(row._id, { value: i }); else await ctx.db.insert("counters", { key: "wsDefaultPreset", value: i });
    return null;
  },
});

export const deleteStyle = mutation({
  args: { styleId: v.id("wsStyles") },
  handler: async (ctx, { styleId }) => { await requireMe(ctx); await ctx.db.delete(styleId); return null; },
});

// ---------- files: images (logo, cover) and fonts ----------

export const uploadUrl = mutation({ args: {}, handler: async (ctx) => { await requireMe(ctx); return ctx.storage.generateUploadUrl(); } });

/** Links for files a style uses (logo, cover image). */
export const fileUrls = query({
  args: { ids: v.array(v.id("_storage")) },
  handler: async (ctx, { ids }) => {
    await requireMe(ctx);
    const out: Record<string, string | null> = {};
    for (const id of ids.slice(0, 20)) out[id] = await ctx.storage.getUrl(id);
    return out;
  },
});

export const checkImage = action({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }): Promise<{ ok: true }> => {
    await ctx.runQuery(internal.users.assertAllowed, {});
    const b = await ctx.storage.get(storageId);
    const bad = async (m: string) => { await ctx.storage.delete(storageId); throw new ConvexError(m); };
    if (!b) return bad("The upload didn't arrive.");
    if (b.size > 5 * 1024 * 1024) return bad("That image is over 5 MB.");
    const h = new Uint8Array(await b.slice(0, 4).arrayBuffer());
    const png = h[0] === 0x89 && h[1] === 0x50, jpg = h[0] === 0xff && h[1] === 0xd8;
    if (!png && !jpg) return bad("Use a PNG or JPEG image.");
    return { ok: true };
  },
});

export const listFonts = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const rows = await ctx.db.query("wsFonts").collect();
    return Promise.all(rows.map(async (f) => ({ _id: f._id, family: f.family, weight: f.weight, italic: f.italic, source: f.source, fileName: f.fileName, url: await ctx.storage.getUrl(f.fileId) })));
  },
});

// TTF and OTF only: the PDF renderer can't use WOFF2 or font collections (.ttc).
function fontKind(h: Uint8Array): "ttf" | "otf" | "ttc" | "woff" | "woff2" | null {
  const s = String.fromCharCode(...h.subarray(0, 4));
  if (h[0] === 0 && h[1] === 1 && h[2] === 0 && h[3] === 0) return "ttf";
  if (s === "true") return "ttf";
  if (s === "OTTO") return "otf";
  if (s === "ttcf") return "ttc";
  if (s === "wOFF") return "woff";
  if (s === "wOF2") return "woff2";
  return null;
}

export const addFont = action({
  args: { storageId: v.id("_storage"), family: v.string(), weight: v.number(), italic: v.boolean(), fileName: v.string(), source: v.union(v.literal("upload"), v.literal("local")) },
  handler: async (ctx, a): Promise<{ ok: true }> => {
    await ctx.runQuery(internal.users.assertAllowed, {});
    const b = await ctx.storage.get(a.storageId);
    const bad = async (m: string) => { await ctx.storage.delete(a.storageId); throw new ConvexError(m); };
    if (!b) return bad("The font didn't arrive.");
    if (b.size > 15 * 1024 * 1024) return bad("That font file is over 15 MB.");
    const k = fontKind(new Uint8Array(await b.slice(0, 4).arrayBuffer()));
    if (k === "ttc") return bad("That font is a collection (.ttc), which PDFs can't embed. Use its .ttf or .otf version, or pick it from Google Fonts.");
    if (k === "woff2" || k === "woff") return bad("Use the .ttf or .otf version of this font (web fonts can't be embedded here).");
    if (!k) return bad("That isn't a font file (.ttf or .otf).");
    const family = clean(a.family, 80);
    if (!family) return bad("Name the font.");
    await ctx.runMutation(internal.builder.insertFont, { family, weight: Math.round(a.weight) || 400, italic: a.italic, fileId: a.storageId, fileName: clean(a.fileName, 120), source: a.source });
    return { ok: true };
  },
});

export const insertFont = internalMutation({
  args: { family: v.string(), weight: v.number(), italic: v.boolean(), fileId: v.id("_storage"), fileName: v.string(), source: v.union(v.literal("upload"), v.literal("local"), v.literal("google")) },
  handler: async (ctx, a) => {
    const same = (await ctx.db.query("wsFonts").withIndex("by_family", (q) => q.eq("family", a.family)).collect()).find((f) => f.weight === a.weight && f.italic === a.italic);
    if (same) { await ctx.storage.delete(same.fileId); await ctx.db.delete(same._id); }
    await ctx.db.insert("wsFonts", { ...a, createdAt: Date.now() });
    return null;
  },
});

export const deleteFont = mutation({
  args: { family: v.string() },
  handler: async (ctx, { family }) => {
    await requireMe(ctx);
    for (const f of await ctx.db.query("wsFonts").withIndex("by_family", (q) => q.eq("family", family)).collect()) { await ctx.storage.delete(f.fileId); await ctx.db.delete(f._id); }
    return null;
  },
});

export const hasFamily = internalQuery({
  args: { family: v.string() },
  handler: async (ctx, { family }) => (await ctx.db.query("wsFonts").withIndex("by_family", (q) => q.eq("family", family)).collect()).length > 0,
});

// Google Fonts answers a browser with WOFF/WOFF2 (which PDFs can't embed) and a plain HTTP client with TTF files.
// Checked Oct 27: an old Firefox user agent gets .woff; "curl/8" gets .ttf.
export const TTF_UA = "curl/8";

/** Fetches a Google font's regular, italic, bold and bold-italic TTFs (once) into storage. */
export const ensureGoogleFont = action({
  args: { family: v.string() },
  handler: async (ctx, { family }): Promise<{ added: number }> => {
    await ctx.runQuery(internal.users.assertAllowed, {});
    return googleFont(ctx, family);
  },
});
// The same, for the backend's own PDF rendering (the connector).
export const ensureGoogleFontInternal = internalAction({
  args: { family: v.string() },
  handler: async (ctx, { family }): Promise<{ added: number }> => googleFont(ctx, family),
});
async function googleFont(ctx: ActionCtx, family: string): Promise<{ added: number }> {
  {
    const fam = family.trim().slice(0, 80);
    if (!/^[A-Za-z0-9 ]+$/.test(fam)) throw new ConvexError("That font name doesn't look right.");
    if (await ctx.runQuery(internal.builder.hasFamily, { family: fam })) return { added: 0 };
    const css = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, "+")}:ital,wght@0,400;0,700;1,400;1,700&display=swap`, { headers: { "User-Agent": TTF_UA } });
    if (!css.ok) {
      // Some families have no italic or bold: ask for whatever exists.
      const plain = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, "+")}&display=swap`, { headers: { "User-Agent": TTF_UA } });
      if (!plain.ok) throw new ConvexError(`Google Fonts doesn't have "${fam}".`);
      return addFaces(ctx, fam, await plain.text());
    }
    return addFaces(ctx, fam, await css.text());
  }
}

async function addFaces(ctx: ActionCtx, family: string, css: string): Promise<{ added: number }> {
  let added = 0;
  for (const m of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
    const body = m[1];
    const url = /url\((https:[^)]+\.ttf)\)/.exec(body)?.[1];
    if (!url) continue;
    const weight = Number(/font-weight:\s*(\d+)/.exec(body)?.[1] ?? 400);
    const italic = /font-style:\s*italic/.test(body);
    const r = await fetch(url);
    if (!r.ok) continue;
    const fileId = await ctx.storage.store(new Blob([await r.arrayBuffer()], { type: "font/ttf" }));
    await ctx.runMutation(internal.builder.insertFont, { family, weight, italic, fileId, fileName: `${family}-${weight}${italic ? "i" : ""}.ttf`, source: "google" });
    added++;
  }
  if (!added) throw new ConvexError(`Couldn't get "${family}" from Google Fonts.`);
  return { added };
}

// For the connector and tests: the build behind a document.
export const forDocument = internalQuery({
  args: { documentId: v.id("wsDocuments") },
  handler: async (ctx, { documentId }) => ctx.db.query("wsBuilds").withIndex("by_document", (q) => q.eq("documentId", documentId)).first(),
});

// ---------- B4 (Oct 27): the connector's builder tools, the backend's own PDF rendering, and PDF → editable draft ----------

/** A new build from a page and fields (the connector, and PDF imports). */
export async function insertBuild(ctx: MutationCtx, a: { title: string; page: Page; fields?: Partial<Fields>; signers?: ExtraSigner[]; style?: Style; templateId?: Id<"wsTemplates"> }) {
  tooBig(a.page, a.fields, a.signers);
  const now = Date.now();
  const business = await profile(ctx);
  const base = emptyFields(business);
  const fields: Fields = { ...base, ...(a.fields ?? {}), business, client: { ...base.client, ...(a.fields?.client ?? {}) }, custom: a.fields?.custom ?? [] };
  return ctx.db.insert("wsBuilds", {
    title: clean(a.title) || "Untitled document", blocks: freshIds(a.page), fields, signers: a.signers ?? [], style: a.style ?? await defaultStyle(ctx),
    ...(a.templateId ? { templateId: a.templateId } : {}), createdAt: now, updatedAt: now,
  });
}
export const createBuildFor = internalMutation({
  args: { title: v.string(), page: v.any(), fields: v.optional(v.any()), signers: v.optional(v.any()), templateId: v.optional(v.id("wsTemplates")) },
  handler: async (ctx, a) => {
    const t = a.templateId ? await ctx.db.get(a.templateId) : null;
    if (a.templateId && (!t || isProposal(t))) throw new ConvexError("That template doesn't exist.");
    const tf = (t?.fields as Partial<Fields> | undefined) ?? {};
    const fields = { project: tf.project ?? "", custom: tf.custom ?? [], ...((a.fields as Partial<Fields>) ?? {}) };
    return insertBuild(ctx, { title: a.title, page: a.page ? pageOf(a.page) : pageOf(t?.blocks), fields, signers: a.signers as ExtraSigner[] | undefined, style: t ? (t.style as Style) : undefined, templateId: t?._id });
  },
});
export const patchBuild = internalMutation({
  args: { buildId: v.id("wsBuilds"), title: v.optional(v.string()), page: v.optional(v.any()), fields: v.optional(v.any()), signers: v.optional(v.any()) },
  handler: async (ctx, a) => {
    const b = await ctx.db.get(a.buildId);
    if (!b) throw new ConvexError("That draft doesn't exist.");
    await assertEditable(ctx, b);
    tooBig(a.page, a.fields, a.signers);
    await ctx.db.patch(a.buildId, {
      ...(a.title !== undefined ? { title: clean(a.title) || "Untitled document" } : {}), ...(a.page !== undefined ? { blocks: pageOf(a.page) } : {}),
      ...(a.fields !== undefined ? { fields: a.fields } : {}), ...(a.signers !== undefined ? { signers: a.signers } : {}), updatedAt: Date.now(),
    });
    return null;
  },
});
export const buildInternal = internalQuery({
  args: { buildId: v.id("wsBuilds") },
  handler: async (ctx, { buildId }) => {
    const b = await ctx.db.get(buildId);
    if (!b) return null;
    const doc = b.documentId ? await ctx.db.get(b.documentId) : null;
    return { ...b, page: pageOf(b.blocks), document: doc ? { _id: doc._id, label: docLabel(doc.number), status: doc.status } : null };
  },
});
/** A draft by its id or words from its title (the connector's "draft" argument). */
export const findBuild = internalQuery({
  args: { ref: v.string() },
  handler: async (ctx, { ref }): Promise<{ ok: true; buildId: Id<"wsBuilds"> } | { ok: false; error: string; candidates?: Array<{ draft_id: string; title: string }> }> => {
    const r = ref.trim();
    if (!r) return { ok: false, error: "Pass the draft: its draft_id or words from its title." };
    const id = ctx.db.normalizeId("wsBuilds", r);
    const got = id ? await ctx.db.get(id) : null;
    if (got && !isProposal(got)) return { ok: true, buildId: got._id };
    const words = r.toLowerCase().split(/\s+/);
    const rows = (await ctx.db.query("wsBuilds").withIndex("by_updated").order("desc").take(300)).filter((b) => !isProposal(b) && words.every((w) => b.title.toLowerCase().includes(w)));
    if (rows.length === 1) return { ok: true, buildId: rows[0]._id };
    if (!rows.length) return { ok: false, error: `No draft matches "${r}". list_drafts shows them.` };
    return { ok: false, error: `${rows.length} drafts match "${r}"; pass a draft_id.`, candidates: rows.slice(0, 10).map((b) => ({ draft_id: b._id, title: b.title })) };
  },
});
export const listBuildsInternal = internalQuery({
  args: { query: v.optional(v.string()) },
  handler: async (ctx, { query: q }) => {
    const words = (q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const rows = await ctx.db.query("wsBuilds").withIndex("by_updated").order("desc").take(300);
    const out = [];
    for (const b of rows.filter((x) => !isProposal(x) && words.every((w) => x.title.toLowerCase().includes(w))).slice(0, 50)) {
      const doc = b.documentId ? await ctx.db.get(b.documentId) : null;
      out.push({ draft_id: b._id, title: b.title, client: (b.fields as Fields)?.client?.name || null, updated: new Date(b.updatedAt).toISOString(), document: doc ? `${docLabel(doc.number)} (${doc.status})` : null });
    }
    return out;
  },
});
export const templatesInternal = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("wsTemplates").withIndex("by_updated").order("desc").collect()).filter((t) => !isProposal(t)).map((t) => ({ _id: t._id, name: t.name, description: t.description ?? "", fields: t.fields, page: pageOf(t.blocks) })),
});
export const saveTemplateFrom = internalMutation({
  args: { buildId: v.id("wsBuilds"), name: v.string(), description: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const b = await ctx.db.get(a.buildId);
    if (!b) throw new ConvexError("That draft doesn't exist.");
    const f = b.fields as Fields;
    const now = Date.now();
    return ctx.db.insert("wsTemplates", { name: clean(a.name) || b.title, description: clean(a.description ?? "", 300) || undefined, blocks: pageOf(b.blocks), fields: { project: f?.project ?? "", custom: (f?.custom ?? []).map((c) => ({ ...c, value: "" })) }, style: b.style, createdAt: now, updatedAt: now });
  },
});

/** What the backend needs to render a build to a PDF: the document, the stored fonts and the style's images. */
export const renderInputs = internalQuery({
  args: { buildId: v.id("wsBuilds") },
  handler: async (ctx, { buildId }) => {
    const b = await ctx.db.get(buildId);
    if (!b) return null;
    const st = b.style as Style;
    const fonts = await Promise.all((await ctx.db.query("wsFonts").collect()).map(async (f) => ({ _id: f._id as string, family: f.family, weight: f.weight, italic: f.italic, source: f.source, fileName: f.fileName, url: await ctx.storage.getUrl(f.fileId) })));
    const files: Record<string, string | null> = {};
    for (const id of [st.logo?.fileId, st.cover?.fileId].filter(Boolean) as string[]) { try { files[id] = await ctx.storage.getUrl(id as Id<"_storage">); } catch { files[id] = null; } }
    const doc = b.documentId ? await ctx.db.get(b.documentId) : null;
    const d: BuildDoc = { title: b.title, page: pageOf(b.blocks), fields: b.fields as Fields, signers: (b.signers as ExtraSigner[]) ?? [], style: st };
    return { d, fonts, files, label: doc ? docLabel(doc.number) : undefined };
  },
});

/** PDF → editable draft (the New document page's "Import a PDF to edit", and the connector's import_pdf). */
export async function importPdfCore(ctx: ActionCtx, storageId: Id<"_storage">, title?: string, keep = false): Promise<{ buildId: Id<"wsBuilds">; notes: string[]; stats: ImportResult["stats"] }> {
  try {
    const lines = await ctx.runAction(internal.wsNode.extractLines, { storageId });
    const r = pdfLinesToPage(lines);
    if (!r.stats.paragraphs) throw new Error("This PDF has no text to bring in (it may be a scanned image). Claude can read it and write the draft with create_draft instead.");
    const first = r.page.content.find((n) => n.type === "paragraph" && n.attrs?.size === "title");
    const name = clean(title ?? "") || textOf(first).slice(0, 120) || "Imported document";
    const buildId = await ctx.runMutation(internal.builder.createBuildFor, { title: name, page: r.page });
    return { buildId, notes: r.notes, stats: r.stats };
  } finally {
    if (!keep) await ctx.storage.delete(storageId).catch(() => {}); // an upload only; a document's own file stays
  }
}
export const importPdf = action({
  args: { storageId: v.id("_storage"), title: v.optional(v.string()) },
  handler: async (ctx, { storageId, title }): Promise<{ buildId: Id<"wsBuilds">; notes: string[] }> => {
    await ctx.runQuery(internal.users.assertAllowed, {});
    try { const r = await importPdfCore(ctx, storageId, title); return { buildId: r.buildId, notes: r.notes }; }
    catch (e) { throw new ConvexError(errText(e)); }
  },
});

// The connector's live self-test makes a throwaway draft to render, then removes it.
export const dropBuildInternal = internalMutation({
  args: { buildId: v.id("wsBuilds") },
  handler: async (ctx, { buildId }) => { await ctx.db.delete(buildId); return null; },
});
