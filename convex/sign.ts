// Wrangler Sign — Heston's side (Phase S1, Oct 27). Every public function here is owner-only.
//
// A document is a finished PDF. Heston (or Claude, S4) uploads it, places boxes (markers find most of them), adds
// signers, then approves. Approval locks that version: its file hash, boxes, signers, signing order and invoice are
// covered by one lock hash. Any change after that is a new version; earlier versions are kept as they were.
// Sending, signing and completion are Phases S2–S3.
import { action, type ActionCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe } from "./lib/access";
import { appendEvent, eventsOf, verifyChain } from "./lib/wsAudit";
import { approvalProblems, docLabel, lockText, OWNER_KEY, shapeProblems, type LayoutBox, type LayoutSigner } from "./lib/wsLayout";
import { inspect, sha256Bytes, stamp, type Stamp } from "./lib/wsPdf";
import { sha256Hex } from "./lib/hash";
import { randomToken } from "./lib/hash";
import { DEFAULT_EXPIRY_DAYS, cleanLine, signLink } from "./lib/wsSigning";
import { pngProblem } from "./lib/pngCheck";
import { businessContact, businessInScope } from "./lib/business";
import { crmDocument } from "./crm";

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_PNG_BYTES = 600 * 1024;

const rectV = v.object({ page: v.number(), x: v.number(), y: v.number(), w: v.number(), h: v.number() });
const boxV = v.object({
  id: v.string(), signer: v.string(),
  kind: v.union(v.literal("sign"), v.literal("initials"), v.literal("name"), v.literal("date"), v.literal("title")),
  page: v.number(), x: v.number(), y: v.number(), w: v.number(), h: v.number(),
  cover: v.optional(rectV), fromMarker: v.optional(v.boolean()),
});
const signerV = v.object({ key: v.string(), name: v.string(), email: v.string(), title: v.optional(v.string()), order: v.number() });
const paymentV = v.union(v.null(), v.object({ amountCents: v.number(), description: v.string() }));

// Phase 0.5d step 4: the owner of the business this document belongs to.
const ownerEmailOf = async (ctx: QueryCtx | MutationCtx) => (await businessContact(ctx, businessInScope(ctx))).ownerEmail;

async function currentSignature(ctx: QueryCtx | MutationCtx) {
  const rows = await ctx.db.query("wsOwnerSignatures").withIndex("by_adopted").order("desc").take(5);
  return rows.find((r) => !r.replacedAt) ?? null;
}

async function currentVersion(ctx: QueryCtx | MutationCtx, doc: Doc<"wsDocuments">) {
  const ver = await ctx.db.query("wsVersions").withIndex("by_document", (q) => q.eq("documentId", doc._id).eq("number", doc.currentVersion)).unique();
  if (!ver) throw new ConvexError("This document has lost its current version.");
  return ver;
}

async function loadEditable(ctx: MutationCtx, versionId: Id<"wsVersions">) {
  const ver = await ctx.db.get(versionId);
  if (!ver) throw new ConvexError("That version doesn't exist.");
  const doc = (await ctx.db.get(ver.documentId))!;
  if (doc.currentVersion !== ver.number) throw new ConvexError("That's an older version. Open the current one.");
  if (ver.approvedAt) throw new ConvexError("This version is approved and locked. Make a new version to change it.");
  if (doc.status !== "draft") throw new ConvexError("Only a draft can be edited.");
  return { ver, doc };
}

// Heston's own signer row always carries his adopted name and title and his own email, whatever the page sent.
function withOwner(signers: LayoutSigner[], sig: Doc<"wsOwnerSignatures"> | null, ownerEmail: string): LayoutSigner[] {
  return signers.map((s) => s.key === OWNER_KEY ? { key: OWNER_KEY, name: sig?.name ?? "Heston Hill", email: ownerEmail, title: sig?.title ?? "Founder", order: s.order } : { ...s, name: cleanLine(s.name), email: s.email.trim().toLowerCase(), title: cleanLine(s.title) || undefined });
}

// ---------- reading ----------

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const docs = await ctx.db.query("wsDocuments").withIndex("by_updated").order("desc").take(500);
    return Promise.all(docs.map(async (d) => {
      const ver = await currentVersion(ctx, d);
      const clients = ver.signers.filter((s) => s.key !== OWNER_KEY);
      return {
        _id: d._id, label: docLabel(d.number), number: d.number, title: d.title, status: d.status, version: d.currentVersion, updatedAt: d.updatedAt, createdAt: d.createdAt,
        signers: clients.map((s) => s.name || s.email || s.key), emails: clients.map((s) => s.email).filter(Boolean),
        pages: ver.pages.length, approved: !!ver.approvedAt, sentAt: d.sentAt ?? null, completedAt: d.completedAt ?? null,
        amount: ver.payment ? ver.payment.amountCents / 100 : null, fromBuilder: !!d.buildId, buildId: d.buildId ?? null,
        hidden: !!d.hiddenAt,
      };
    }));
  },
});

export const get = query({
  args: { documentId: v.id("wsDocuments"), versionNumber: v.optional(v.number()) },
  handler: async (ctx, a) => { await requireMe(ctx); return getCore(ctx, a.documentId, a.versionNumber); },
});

// S4: the same, for the Claude connector.
export const getAs = internalQuery({
  args: { documentId: v.id("wsDocuments"), versionNumber: v.optional(v.number()) },
  handler: async (ctx, a) => getCore(ctx, a.documentId, a.versionNumber),
});

async function getCore(ctx: QueryCtx, documentId: Id<"wsDocuments">, versionNumber?: number) {
  {
    const doc = await ctx.db.get(documentId);
    if (!doc) return null;
    const versions = await ctx.db.query("wsVersions").withIndex("by_document", (q) => q.eq("documentId", documentId)).collect();
    const shown = versions.find((x) => x.number === (versionNumber ?? doc.currentVersion)) ?? versions.find((x) => x.number === doc.currentVersion)!;
    const events = await eventsOf(ctx, documentId);
    const sig = await currentSignature(ctx);
    return {
      doc: { ...doc, label: docLabel(doc.number) },
      // S3: the signed copy (a link that works for an hour or so; the page asks again when it re-renders).
      finalUrl: doc.final ? await ctx.storage.getUrl(doc.final.fileId) : null,
      version: { ...shown, fileUrl: await ctx.storage.getUrl(shown.fileId), isCurrent: shown.number === doc.currentVersion, editable: shown.number === doc.currentVersion && !shown.approvedAt && doc.status === "draft" },
      versions: versions.sort((a, b) => b.number - a.number).map((x) => ({ number: x.number, fileName: x.fileName, fileSha256: x.fileSha256, approvedAt: x.approvedAt ?? null, lockHash: x.lockHash ?? null, ownerSignedAt: x.ownerSignedAt ?? null, createdAt: x.createdAt })),
      events: events.map((e) => ({ seq: e.seq, at: e.at, kind: e.kind, actor: e.actor, versionNumber: e.versionNumber ?? null, detail: e.detail ?? null, email: e.email ?? null, ip: e.ip ?? null, userAgent: e.userAgent ?? null })),
      chain: await verifyChain(events),
      owner: { email: (await ownerEmailOf(ctx)), name: sig?.name ?? null, title: sig?.title ?? null, adopted: !!sig },
      signings: doc.sentVersion !== undefined ? (await ctx.db.query("wsSignings").withIndex("by_document", (q) => q.eq("documentId", documentId).eq("versionNumber", doc.sentVersion!)).collect())
        .sort((a, b) => a.order - b.order)
        .map((x) => ({ key: x.signerKey, name: x.name, email: x.email, order: x.order, status: x.status, link: signLink(x.token), sentAt: x.sentAt ?? null, lastEmailAt: x.lastEmailAt ?? null, openedAt: x.openedAt ?? null, verifiedAt: x.verifiedAt ?? null, consentAt: x.consentAt ?? null, signedAt: x.signedAt ?? null, lockedUntil: x.lockedUntil ?? null })) : [],
      problems: approvalProblems({ signers: shown.signers, boxes: shown.boxes, pages: shown.pages.length, payment: shown.payment ?? null, ownerSignatureAdopted: !!sig }),
    };
  }
}

export const ownerSignature = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const sig = await currentSignature(ctx);
    if (!sig) return { adopted: false as const, email: (await ownerEmailOf(ctx)) };
    return {
      adopted: true as const, email: (await ownerEmailOf(ctx)), name: sig.name, title: sig.title, method: sig.method, adoptedAt: sig.adoptedAt,
      signatureUrl: await ctx.storage.getUrl(sig.signatureFileId), initialsUrl: await ctx.storage.getUrl(sig.initialsFileId),
      signatureSha256: sig.signatureSha256,
    };
  },
});

// ---------- uploading and creating ----------

export const uploadUrl = mutation({
  args: {},
  handler: async (ctx) => { await requireMe(ctx); return ctx.storage.generateUploadUrl(); },
});

async function readPdf(ctx: { storage: { get: (id: Id<"_storage">) => Promise<Blob | null>; delete: (id: Id<"_storage">) => Promise<void> } }, storageId: Id<"_storage">) {
  const blob = await ctx.storage.get(storageId);
  if (!blob) throw new ConvexError("The upload didn't arrive. Try again.");
  const fail = async (msg: string) => { await ctx.storage.delete(storageId); throw new ConvexError(msg); };
  if (blob.size > MAX_PDF_BYTES) return fail("That PDF is over 25 MB. Export a smaller one.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const head = new TextDecoder().decode(bytes.subarray(0, 1024));
  if (!head.includes("%PDF-")) return fail("That file isn't a PDF.");
  const ins = await inspect(bytes);
  if (!ins.ok) return fail(ins.reason === "encrypted" ? "This PDF is password-protected. Export it again without protection, then upload that." : "This PDF can't be read. Try exporting it again.");
  if (!ins.pages.length) return fail("This PDF has no pages.");
  if (ins.pages.length > 200) return fail("That PDF has over 200 pages.");
  return { bytes, pages: ins.pages, sha: await sha256Bytes(bytes) };
}

const titleFromFile = (f: string) => f.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").trim().slice(0, 120) || "Untitled document";

export const create = action({
  args: { storageId: v.id("_storage"), fileName: v.string(), title: v.optional(v.string()) },
  handler: async (ctx, { storageId, fileName, title }): Promise<{ documentId: Id<"wsDocuments">; label: string }> => {
    await ctx.runQuery(internal.users.assertAllowed, {});
    const pdf = await readPdf(ctx, storageId);
    return ctx.runMutation(internal.sign.insertDocument, {
      storageId, fileName: fileName.slice(0, 200), title: (title?.trim() || titleFromFile(fileName)).slice(0, 120),
      sha: pdf.sha, bytes: pdf.bytes.length, pages: pdf.pages,
    });
  },
});

// S4: a PDF Claude uploaded through the connector (already in storage).
export const createAs = internalAction({
  args: { storageId: v.id("_storage"), fileName: v.string(), title: v.optional(v.string()), actor: v.string() },
  handler: async (ctx, { storageId, fileName, title, actor }): Promise<{ documentId: Id<"wsDocuments">; label: string }> => {
    const pdf = await readPdf(ctx, storageId);
    return ctx.runMutation(internal.sign.insertDocument, {
      storageId, fileName: fileName.slice(0, 200), title: (title?.trim() || titleFromFile(fileName)).slice(0, 120),
      sha: pdf.sha, bytes: pdf.bytes.length, pages: pdf.pages, actor,
    });
  },
});

export const insertDocument = internalMutation({
  args: { storageId: v.id("_storage"), fileName: v.string(), title: v.string(), sha: v.string(), bytes: v.number(), pages: v.array(v.object({ width: v.number(), height: v.number(), rotate: v.number() })), actor: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const c = await ctx.db.query("counters").withIndex("by_key", (q) => q.eq("key", "wsNumber")).first();
    const number = c?.value ?? 1;
    if (c) await ctx.db.patch(c._id, { value: number + 1 }); else await ctx.db.insert("counters", { key: "wsNumber", value: number + 1 });
    const now = Date.now();
    const documentId = await ctx.db.insert("wsDocuments", { number, title: a.title, status: "draft", currentVersion: 1, createdAt: now, updatedAt: now });
    await ctx.db.insert("wsVersions", {
      documentId, number: 1, fileId: a.storageId, fileName: a.fileName, fileSha256: a.sha, fileBytes: a.bytes, pages: a.pages,
      signers: [{ key: "client", name: "", email: "", order: 1 }], boxes: [], signingOrder: "any", createdAt: now, updatedAt: now,
    });
    await appendEvent(ctx, documentId, { kind: "created", actor: a.actor ?? OWNER_KEY, versionNumber: 1, detail: `Uploaded "${a.fileName}" (${a.pages.length} page${a.pages.length === 1 ? "" : "s"}), SHA-256 ${a.sha}` });
    return { documentId, label: docLabel(number) };
  },
});

// ---------- editing a draft ----------

export const saveLayout = mutation({
  args: {
    versionId: v.id("wsVersions"), title: v.string(), signers: v.array(signerV), boxes: v.array(boxV),
    signingOrder: v.union(v.literal("any"), v.literal("sequence")), payment: paymentV, hasTextLayer: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => { await requireMe(ctx); return saveLayoutCore(ctx, a); },
});

// S4: the same, for the Claude connector.
export const saveLayoutAs = internalMutation({
  args: {
    versionId: v.id("wsVersions"), title: v.string(), signers: v.array(signerV), boxes: v.array(boxV),
    signingOrder: v.union(v.literal("any"), v.literal("sequence")), payment: paymentV, hasTextLayer: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => saveLayoutCore(ctx, a),
});

type LayoutArgs = { versionId: Id<"wsVersions">; title: string; signers: LayoutSigner[]; boxes: Array<LayoutBox>; signingOrder: "any" | "sequence"; payment: { amountCents: number; description: string } | null; hasTextLayer?: boolean };
async function saveLayoutCore(ctx: MutationCtx, a: LayoutArgs) {
  {
    const { ver, doc } = await loadEditable(ctx, a.versionId);
    const signers = withOwner(a.signers, await currentSignature(ctx), await ownerEmailOf(ctx));
    const problems = shapeProblems({ signers, boxes: a.boxes as LayoutBox[], pages: ver.pages.length });
    if (problems.length) throw new ConvexError(problems[0]);
    const title = a.title.trim().slice(0, 120) || doc.title;
    await ctx.db.patch(ver._id, {
      signers, boxes: a.boxes, signingOrder: a.signingOrder, payment: a.payment ?? undefined, updatedAt: Date.now(),
      ...(a.hasTextLayer !== undefined ? { hasTextLayer: a.hasTextLayer } : {}),
    });
    await ctx.db.patch(doc._id, { title, updatedAt: Date.now() });
    return null;
  }
}

export const approve = mutation({
  args: { versionId: v.id("wsVersions") },
  handler: async (ctx, { versionId }) => { await requireMe(ctx); return approveCore(ctx, versionId, OWNER_KEY); },
});


async function approveCore(ctx: MutationCtx, versionId: Id<"wsVersions">, actor: string) {
  {
    const { ver, doc } = await loadEditable(ctx, versionId);
    const sig = await currentSignature(ctx);
    const problems = approvalProblems({ signers: ver.signers, boxes: ver.boxes, pages: ver.pages.length, payment: ver.payment ?? null, ownerSignatureAdopted: !!sig });
    if (problems.length) throw new ConvexError(problems.join(" "));
    const lockHash = await sha256Hex(lockText({ documentNumber: doc.number, versionNumber: ver.number, title: doc.title, fileSha256: ver.fileSha256, pages: ver.pages, signers: ver.signers, boxes: ver.boxes as LayoutBox[], signingOrder: ver.signingOrder, payment: ver.payment ?? null }));
    const now = Date.now();
    await ctx.db.patch(ver._id, { approvedAt: now, lockHash, updatedAt: now });
    await ctx.db.patch(doc._id, { status: "approved", updatedAt: now });
    await closeRequests(ctx, doc._id, ["approve"]);
    await appendEvent(ctx, doc._id, { kind: "approved", actor, versionNumber: ver.number, detail: `Version ${ver.number} approved and locked${actor === OWNER_KEY ? "" : " by Claude, on Heston's OK in chat"}. Lock hash ${lockHash}. ${ver.boxes.length} boxes, ${ver.signers.length} signers.` });
    return { lockHash };
  }
}

// A new version from the current one: same file, same layout, unlocked. Only before it's sent.
export const revise = mutation({
  args: { documentId: v.id("wsDocuments") },
  handler: async (ctx, { documentId }) => {
    await requireMe(ctx);
    const doc = await ctx.db.get(documentId);
    if (!doc) throw new ConvexError("That document doesn't exist.");
    if (doc.status !== "approved" && doc.status !== "voided") throw new ConvexError(doc.status === "draft" ? "This draft can be edited as it is." : doc.status === "sent" ? "Cancel (void) it first; then make the changes as a new version and send that." : "A signed document can't be changed.");
    const cur = await currentVersion(ctx, doc);
    const now = Date.now();
    const number = cur.number + 1;
    await ctx.db.insert("wsVersions", {
      documentId, number, fileId: cur.fileId, fileName: cur.fileName, fileSha256: cur.fileSha256, fileBytes: cur.fileBytes, pages: cur.pages,
      hasTextLayer: cur.hasTextLayer, signers: cur.signers, boxes: cur.boxes, signingOrder: cur.signingOrder, payment: cur.payment, createdAt: now, updatedAt: now,
    });
    await ctx.db.patch(documentId, { status: "draft", currentVersion: number, updatedAt: now, sentAt: undefined, sentVersion: undefined, expiresAt: undefined, voidedAt: undefined, voidReason: undefined });
    await appendEvent(ctx, documentId, { kind: "new_version", actor: OWNER_KEY, versionNumber: number, detail: `Version ${number} started from version ${cur.number} (same file). Version ${cur.number} stays as it was.` });
    return { versionNumber: number };
  },
});

// A new version with a different PDF. Signers carry over; boxes start empty (the page finds markers again).
export const replaceFile = action({
  args: { documentId: v.id("wsDocuments"), storageId: v.id("_storage"), fileName: v.string() },
  handler: async (ctx, { documentId, storageId, fileName }): Promise<{ versionNumber: number }> => {
    await ctx.runQuery(internal.users.assertAllowed, { ids: [documentId] });
    const pdf = await readPdf(ctx, storageId);
    return ctx.runMutation(internal.sign.insertReplacement, { documentId, storageId, fileName: fileName.slice(0, 200), sha: pdf.sha, bytes: pdf.bytes.length, pages: pdf.pages });
  },
});

// B2: the builder's checks on a PDF it rendered (same as an upload's).
export const inspectUpload = internalAction({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }): Promise<{ sha: string; bytes: number; pages: Array<{ width: number; height: number; rotate: number }> }> => {
    const pdf = await readPdf(ctx, storageId);
    return { sha: pdf.sha, bytes: pdf.bytes.length, pages: pdf.pages };
  },
});

// B2: a builder draft rebuilt: the draft version gets the new PDF in place (it was never approved, so nothing refers to
// the old file), and its boxes start again from the new markers.
export const replaceDraftFile = internalMutation({
  args: { documentId: v.id("wsDocuments"), storageId: v.id("_storage"), fileName: v.string(), sha: v.string(), bytes: v.number(), pages: v.array(v.object({ width: v.number(), height: v.number(), rotate: v.number() })), title: v.string() },
  handler: async (ctx, a) => {
    const doc = await ctx.db.get(a.documentId);
    if (!doc) throw new ConvexError("That document doesn't exist.");
    const ver = await currentVersion(ctx, doc);
    if (doc.status !== "draft" || ver.approvedAt) throw new ConvexError("Only a draft can be rebuilt in place.");
    const old = ver.fileId;
    const now = Date.now();
    await ctx.db.patch(ver._id, { fileId: a.storageId, fileName: a.fileName, fileSha256: a.sha, fileBytes: a.bytes, pages: a.pages, boxes: [], hasTextLayer: true, updatedAt: now });
    await ctx.db.patch(doc._id, { title: a.title.slice(0, 120), updatedAt: now });
    // An earlier version (sent, then cancelled) may share this file: it stays as long as anything refers to it.
    const shared = (await ctx.db.query("wsVersions").withIndex("by_document", (q) => q.eq("documentId", doc._id)).collect()).some((x) => x._id !== ver._id && x.fileId === old) || doc.final?.fileId === old;
    if (old !== a.storageId && !shared) await ctx.storage.delete(old);
    await appendEvent(ctx, doc._id, { kind: "rebuilt", actor: OWNER_KEY, versionNumber: ver.number, detail: `Rebuilt from the builder: "${a.fileName}" (${a.pages.length} page${a.pages.length === 1 ? "" : "s"}), SHA-256 ${a.sha}` });
    return { versionId: ver._id };
  },
});

export const insertReplacement = internalMutation({
  args: { documentId: v.id("wsDocuments"), storageId: v.id("_storage"), fileName: v.string(), sha: v.string(), bytes: v.number(), pages: v.array(v.object({ width: v.number(), height: v.number(), rotate: v.number() })) },
  handler: async (ctx, a) => {
    const doc = await ctx.db.get(a.documentId);
    if (!doc) { await ctx.storage.delete(a.storageId); throw new ConvexError("That document doesn't exist."); }
    if (doc.status !== "draft" && doc.status !== "approved" && doc.status !== "voided") { await ctx.storage.delete(a.storageId); throw new ConvexError(doc.status === "sent" ? "Cancel (void) it first, then replace the PDF." : "A signed document can't be changed."); }
    const cur = await currentVersion(ctx, doc);
    const now = Date.now();
    const number = cur.number + 1;
    await ctx.db.insert("wsVersions", {
      documentId: doc._id, number, fileId: a.storageId, fileName: a.fileName, fileSha256: a.sha, fileBytes: a.bytes, pages: a.pages,
      signers: cur.signers, boxes: [], signingOrder: cur.signingOrder, payment: cur.payment, createdAt: now, updatedAt: now,
    });
    await ctx.db.patch(doc._id, { status: "draft", currentVersion: number, updatedAt: now, sentAt: undefined, sentVersion: undefined, expiresAt: undefined, voidedAt: undefined, voidReason: undefined });
    await appendEvent(ctx, doc._id, { kind: "new_version", actor: OWNER_KEY, versionNumber: number, detail: `Version ${number}: new file "${a.fileName}" (${a.pages.length} pages), SHA-256 ${a.sha}. Earlier versions are kept.` });
    return { versionNumber: number };
  },
});

// Remove a document from the Docs list, or put it back (Oct 27). Nothing is deleted: its versions, files, trail and
// signed copy stay, it still verifies, and the "Hidden" filter shows it. The trail notes both.
export const setHidden = mutation({
  args: { documentId: v.id("wsDocuments"), hidden: v.boolean() },
  handler: async (ctx, { documentId, hidden }) => {
    await requireMe(ctx);
    const doc = await ctx.db.get(documentId);
    if (!doc) throw new ConvexError("That document doesn't exist.");
    if (!!doc.hiddenAt === hidden) return null;
    await ctx.db.patch(documentId, { hiddenAt: hidden ? Date.now() : undefined });
    await appendEvent(ctx, documentId, { kind: hidden ? "hidden_from_list" : "shown_in_list", actor: OWNER_KEY, versionNumber: doc.currentVersion, detail: hidden ? "Removed from the Docs list. The document and its record are kept." : "Put back in the Docs list." });
    return null;
  },
});

// Delete a document that was never sent: its versions, files and trail go. Sent ones are kept for the record.
export const remove = mutation({
  args: { documentId: v.id("wsDocuments") },
  handler: async (ctx, { documentId }) => {
    await requireMe(ctx);
    const doc = await ctx.db.get(documentId);
    if (!doc) return null;
    if (doc.status !== "draft" && doc.status !== "approved") throw new ConvexError("Sent documents are kept for the record and can't be deleted.");
    // Security review (Oct 27): a document that was ever sent stays, even after cancel → new version (a draft again).
    const everSent = doc.sentAt || (await ctx.db.query("wsSignings").withIndex("by_document", (q) => q.eq("documentId", documentId)).first())
      || (await eventsOf(ctx, documentId)).some((e) => e.kind === "sent");
    if (everSent) throw new ConvexError("This document was sent for signing once, so it's kept for the record and can't be deleted.");
    const versions = await ctx.db.query("wsVersions").withIndex("by_document", (q) => q.eq("documentId", documentId)).collect();
    const files = new Set<Id<"_storage">>(versions.map((x) => x.fileId));
    for (const x of versions) await ctx.db.delete(x._id);
    for (const f of files) await ctx.storage.delete(f);
    for (const e of await eventsOf(ctx, documentId)) await ctx.db.delete(e._id);
    // Made in the builder: its builder draft goes too (it would otherwise hang on to a document that's gone).
    if (doc.buildId) { const b = await ctx.db.get(doc.buildId); if (b && b.documentId === documentId) await ctx.db.delete(b._id); }
    await ctx.db.delete(documentId);
    return null;
  },
});

// ---------- Heston's signature ----------

function isPng(b: Uint8Array) { return pngProblem(b) === null; }

export const adoptSignature = action({
  args: { name: v.string(), title: v.string(), method: v.union(v.literal("typed"), v.literal("drawn")), signatureStorageId: v.id("_storage"), initialsStorageId: v.id("_storage") },
  handler: async (ctx, a): Promise<null> => {
    await ctx.runQuery(internal.users.assertAllowed, {});
    const read = async (id: Id<"_storage">) => {
      const blob = await ctx.storage.get(id);
      if (!blob || blob.size > MAX_PNG_BYTES) { if (blob) await ctx.storage.delete(id); throw new ConvexError("The signature image didn't arrive or is too big."); }
      const b = new Uint8Array(await blob.arrayBuffer());
      if (!isPng(b)) { await ctx.storage.delete(id); throw new ConvexError("The signature must be a PNG image."); }
      return sha256Bytes(b);
    };
    const name = a.name.trim(), title = a.title.trim();
    if (!name || name.length > 120 || title.length > 120) throw new ConvexError("Enter your name (and title) first.");
    const [signatureSha256, initialsSha256] = await Promise.all([read(a.signatureStorageId), read(a.initialsStorageId)]);
    await ctx.runMutation(internal.sign.insertSignature, { ...a, name, title, signatureSha256, initialsSha256 });
    return null;
  },
});

export const insertSignature = internalMutation({
  args: { name: v.string(), title: v.string(), method: v.union(v.literal("typed"), v.literal("drawn")), signatureStorageId: v.id("_storage"), initialsStorageId: v.id("_storage"), signatureSha256: v.string(), initialsSha256: v.string() },
  handler: async (ctx, a) => {
    const now = Date.now();
    const old = await currentSignature(ctx);
    if (old) await ctx.db.patch(old._id, { replacedAt: now }); // kept: documents signed with it point at it
    await ctx.db.insert("wsOwnerSignatures", { name: a.name, title: a.title, method: a.method, signatureFileId: a.signatureStorageId, initialsFileId: a.initialsStorageId, signatureSha256: a.signatureSha256, initialsSha256: a.initialsSha256, adoptedAt: now });
    // Drafts pick up the new name and title on Heston's signer row.
    for (const ver of await ctx.db.query("wsVersions").collect()) {
      if (ver.approvedAt || !ver.signers.some((s) => s.key === OWNER_KEY)) continue;
      await ctx.db.patch(ver._id, { signers: ver.signers.map((s) => s.key === OWNER_KEY ? { ...s, name: a.name, title: a.title } : s) });
    }
    return null;
  },
});

// Heston's signature goes on when the document is sent (S2 calls this). Refused unless the version is approved,
// current and unchanged since approval. Records which adopted signature was used; the image is stamped onto the
// PDF at completion together with everyone else's.
export const applyOwnerSignature = internalMutation({
  args: { versionId: v.id("wsVersions") },
  handler: async (ctx, { versionId }) => applyOwner(ctx, versionId),
});

async function applyOwner(ctx: MutationCtx, versionId: Id<"wsVersions">) {
  {
    const ver = await ctx.db.get(versionId);
    if (!ver) throw new ConvexError("That version doesn't exist.");
    const doc = (await ctx.db.get(ver.documentId))!;
    if (!ver.approvedAt || !ver.lockHash || doc.status !== "approved" || doc.currentVersion !== ver.number) throw new ConvexError("Only the current, approved version can be signed.");
    const again = await sha256Hex(lockText({ documentNumber: doc.number, versionNumber: ver.number, title: doc.title, fileSha256: ver.fileSha256, pages: ver.pages, signers: ver.signers, boxes: ver.boxes as LayoutBox[], signingOrder: ver.signingOrder, payment: ver.payment ?? null }));
    if (again !== ver.lockHash) throw new ConvexError("This version changed after it was approved. Approve it again.");
    if (!ver.signers.some((s) => s.key === OWNER_KEY)) return { applied: false as const };
    if (ver.ownerSignedAt) return { applied: true as const, already: true };
    const sig = await currentSignature(ctx);
    if (!sig) throw new ConvexError("Adopt your signature first.");
    const now = Date.now();
    await ctx.db.patch(ver._id, { ownerSignedAt: now, ownerSignatureId: sig._id });
    await appendEvent(ctx, doc._id, { kind: "owner_signed", actor: OWNER_KEY, versionNumber: ver.number, email: (await ownerEmailOf(ctx)), detail: `Signed by ${sig.name}, ${sig.title}, with the signature adopted ${new Date(sig.adoptedAt).toISOString()} (image SHA-256 ${sig.signatureSha256}).` });
    return { applied: true as const };
  }
}

// ---------- sending (S2) ----------

// Send the current approved version: Heston's signature goes on, every client signer gets a link (all at once, or
// the first in line when they sign one after another), and the links work until the expiry date.
export const send = mutation({
  args: { versionId: v.id("wsVersions"), expiresInDays: v.optional(v.number()) },
  handler: async (ctx, a) => { await requireMe(ctx); return sendCore(ctx, a.versionId, a.expiresInDays, OWNER_KEY); },
});


async function sendCore(ctx: MutationCtx, versionId: Id<"wsVersions">, expiresInDays: number | undefined, actor: string) {
  {
    const ver = await ctx.db.get(versionId);
    if (!ver) throw new ConvexError("That version doesn't exist.");
    const doc = (await ctx.db.get(ver.documentId))!;
    if (doc.status !== "approved" || doc.currentVersion !== ver.number || !ver.approvedAt) throw new ConvexError("Only the current, approved version can be sent.");
    const days = Math.round(expiresInDays ?? DEFAULT_EXPIRY_DAYS);
    if (days < 1 || days > 90) throw new ConvexError("Links can last 1 to 90 days.");
    await applyOwner(ctx, versionId); // refuses if anything changed since approval
    const clients = ver.signers.filter((x) => x.key !== OWNER_KEY).sort((a, b) => a.order - b.order);
    if (!clients.length) throw new ConvexError("There's no client signer.");
    const first = Math.min(...clients.map((c) => c.order));
    const now = Date.now();
    for (const c of clients) {
      const live = ver.signingOrder === "any" || c.order === first;
      const signingId = await ctx.db.insert("wsSignings", {
        documentId: doc._id, versionNumber: ver.number, signerKey: c.key, name: c.name, email: c.email.toLowerCase(), title: c.title, order: ver.signingOrder === "any" ? 1 : c.order,
        token: randomToken(18), status: live ? "sent" : "waiting", ...(live ? { sentAt: now } : {}),
      });
      if (live) {
        await appendEvent(ctx, doc._id, { kind: "sent", actor, versionNumber: ver.number, email: c.email, detail: `Signing link emailed to ${c.name} (${c.email}).` });
        await ctx.scheduler.runAfter(0, internal.signing.emailInvite, { signingId, kind: "invite" });
      }
    }
    const expiresAt = now + days * 86_400_000;
    await ctx.db.patch(doc._id, { status: "sent", sentAt: now, sentVersion: ver.number, expiresAt, updatedAt: now });
    await crmDocument(ctx, doc._id, "contract_sent", "contract sent"); // Phase 3: the pipeline card moves on
    await appendEvent(ctx, doc._id, { kind: "send_settings", actor, versionNumber: ver.number, detail: `${actor === OWNER_KEY ? "" : "Sent by Claude, on Heston's OK in chat. "}Sent version ${ver.number} to ${clients.length} signer${clients.length === 1 ? "" : "s"} (${ver.signingOrder === "any" ? "any order" : "one after another"}); links work until ${new Date(expiresAt).toISOString()}.` });
    await closeRequests(ctx, doc._id, ["approve", "send"]);
    return { sent: clients.length, expiresAt };
  }
}

async function sentDoc(ctx: MutationCtx, documentId: Id<"wsDocuments">) {
  const doc = await ctx.db.get(documentId);
  if (!doc) throw new ConvexError("That document doesn't exist.");
  if (doc.status !== "sent") throw new ConvexError("Only a document that's out for signature can do that.");
  const signings = await ctx.db.query("wsSignings").withIndex("by_document", (q) => q.eq("documentId", documentId).eq("versionNumber", doc.sentVersion!)).collect();
  return { doc, signings };
}

// Cancel a sent document: every link stops working at once; signers who were sent a link get a short email.
export const voidDocument = mutation({
  args: { documentId: v.id("wsDocuments"), reason: v.optional(v.string()) },
  handler: async (ctx, a) => { await requireMe(ctx); return voidCore(ctx, a.documentId, a.reason, OWNER_KEY); },
});


async function voidCore(ctx: MutationCtx, documentId: Id<"wsDocuments">, reason: string | undefined, actor: string) {
  {
    const { doc, signings } = await sentDoc(ctx, documentId);
    const now = Date.now();
    const why = reason?.trim().slice(0, 300) || undefined;
    await ctx.db.patch(doc._id, { status: "voided", voidedAt: now, voidReason: why, updatedAt: now });
    await closeRequests(ctx, doc._id, ["approve", "send", "cancel"]);
    for (const x of signings) {
      if (x.status === "signed") continue;
      await ctx.db.patch(x._id, { status: "closed", sessionHash: undefined, sessionExpiresAt: undefined, codeHash: undefined, codeExpiresAt: undefined });
      if (x.sentAt) await ctx.scheduler.runAfter(0, internal.signing.emailInvite, { signingId: x._id, kind: "voided" });
    }
    await appendEvent(ctx, doc._id, { kind: "voided", actor, versionNumber: doc.sentVersion, detail: `Cancelled${actor === OWNER_KEY ? "" : " by Claude, on Heston's OK in chat"}. Every signing link stopped working.${why ? ` Reason: ${why}` : ""}` });
    return null;
  }
}

export const resend = mutation({
  args: { documentId: v.id("wsDocuments"), signerKey: v.string() },
  handler: async (ctx, a) => { await requireMe(ctx); return resendCore(ctx, a.documentId, a.signerKey, OWNER_KEY); },
});

export const resendAs = internalMutation({
  args: { documentId: v.id("wsDocuments"), signerKey: v.string(), actor: v.string() },
  handler: async (ctx, a) => resendCore(ctx, a.documentId, a.signerKey, a.actor),
});

async function resendCore(ctx: MutationCtx, documentId: Id<"wsDocuments">, signerKey: string, actor: string) {
  {
    const { doc, signings } = await sentDoc(ctx, documentId);
    const x = signings.find((y) => y.signerKey === signerKey);
    if (!x || x.status !== "sent") throw new ConvexError(x?.status === "signed" ? "They've already signed." : "It isn't their turn yet.");
    if (x.lastEmailAt && Date.now() - x.lastEmailAt < 60_000) throw new ConvexError("An email just went to them. Wait a minute.");
    await ctx.scheduler.runAfter(0, internal.signing.emailInvite, { signingId: x._id, kind: "reminder" });
    await appendEvent(ctx, doc._id, { kind: "reminder_sent", actor, versionNumber: doc.sentVersion, email: x.email, detail: `Reminder emailed to ${x.name} (${x.email}).` });
    return null;
  }
}

export const extendExpiry = mutation({
  args: { documentId: v.id("wsDocuments"), days: v.number() },
  handler: async (ctx, { documentId, days }) => {
    await requireMe(ctx);
    const { doc } = await sentDoc(ctx, documentId);
    const d = Math.round(days);
    if (d < 1 || d > 90) throw new ConvexError("1 to 90 days.");
    const expiresAt = Date.now() + d * 86_400_000;
    await ctx.db.patch(doc._id, { expiresAt, updatedAt: Date.now() });
    await appendEvent(ctx, doc._id, { kind: "expiry_changed", actor: OWNER_KEY, versionNumber: doc.sentVersion, detail: `Links now work until ${new Date(expiresAt).toISOString()}.` });
    return { expiresAt };
  },
});

// For tests and the S2 sender: the current version's id.
export const currentVersionId = internalQuery({
  args: { documentId: v.id("wsDocuments") },
  handler: async (ctx, { documentId }) => { const d = await ctx.db.get(documentId); return d ? (await currentVersion(ctx, d))._id : null; },
});

// ---------- preview ----------
// The PDF exactly as it will be stamped: Heston's adopted signature, initials, name, title and today's date in his
// boxes, and grey placeholders in the clients' boxes, with "PREVIEW" across the top of every page. Not stored.
export const preview = action({
  args: { versionId: v.id("wsVersions") },
  handler: async (ctx, { versionId }): Promise<{ url: string; fileName: string }> => {
    await ctx.runQuery(internal.users.assertAllowed, { ids: [versionId] });
    return buildPreview(ctx, versionId);
  },
});

export const previewAs = internalAction({
  args: { versionId: v.id("wsVersions") },
  handler: async (ctx, { versionId }): Promise<{ url: string; fileName: string }> => buildPreview(ctx, versionId),
});

async function buildPreview(ctx: ActionCtx, versionId: Id<"wsVersions">): Promise<{ url: string; fileName: string }> {
  {
    const data = await ctx.runQuery(internal.sign.previewData, { versionId });
    if (!data) throw new ConvexError("That version doesn't exist.");
    const pdfBlob = await ctx.storage.get(data.fileId);
    if (!pdfBlob) throw new ConvexError("The PDF is missing.");
    const bytes = new Uint8Array(await pdfBlob.arrayBuffer());
    const png = async (id: Id<"_storage"> | null) => { if (!id) return null; const b = await ctx.storage.get(id); return b ? new Uint8Array(await b.arrayBuffer()) : null; };
    const [sigPng, iniPng] = await Promise.all([png(data.signatureFileId), png(data.initialsFileId)]);
    const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" });
    const stamps: Stamp[] = [];
    for (const b of data.boxes as LayoutBox[]) {
      const cover = b.cover;
      const signer = data.signers.find((s) => s.key === b.signer);
      if (b.signer === OWNER_KEY) {
        if (b.kind === "sign" && sigPng) stamps.push({ box: b, cover, kind: "image", png: sigPng });
        else if (b.kind === "initials" && iniPng) stamps.push({ box: b, cover, kind: "image", png: iniPng });
        else stamps.push({ box: b, cover, kind: "text", text: b.kind === "date" ? today : b.kind === "name" ? (data.ownerName ?? "Heston Hill") : b.kind === "title" ? (data.ownerTitle ?? "Founder") : "[your signature]" });
      } else {
        const who = signer?.name || signer?.key || b.signer;
        stamps.push({ box: b, cover, kind: "text", text: b.kind === "sign" ? `[${who} signs here]` : b.kind === "initials" ? "[initials]" : `[${b.kind}: ${who}]` });
      }
    }
    for (let i = 0; i < data.pages; i++) stamps.push({ box: { page: i, x: 0.02, y: 0.004, w: 0.6, h: 0.018 }, kind: "text", text: `PREVIEW · ${data.label} v${data.versionNumber} · not signed` });
    const cert = [`PREVIEW of ${data.label} "${data.title}", version ${data.versionNumber}. Not a signed document.`, "", `Original file SHA-256 ${data.fileSha256}`, data.lockHash ? `Lock hash ${data.lockHash}` : "Not approved yet.", "", "The signed copy ends with an audit certificate listing every event, time, email and IP address, and the SHA-256 of the final file."];
    const out = await stamp(bytes, stamps, cert);
    // Kept for 15 minutes, then deleted: long enough to open, never a second copy lying around.
    const id = await ctx.storage.store(new Blob([new Uint8Array(out)], { type: "application/pdf" }));
    await ctx.scheduler.runAfter(15 * 60_000, internal.sign.deletePreview, { storageId: id });
    const url = await ctx.storage.getUrl(id);
    if (!url) throw new ConvexError("The preview couldn't be saved.");
    return { url, fileName: `${data.label} v${data.versionNumber} PREVIEW.pdf` };
  }
}

export const previewData = internalQuery({
  args: { versionId: v.id("wsVersions") },
  handler: async (ctx, { versionId }) => {
    const ver = await ctx.db.get(versionId);
    if (!ver) return null;
    const doc = (await ctx.db.get(ver.documentId))!;
    const sig = ver.ownerSignatureId ? await ctx.db.get(ver.ownerSignatureId) : await currentSignature(ctx);
    return {
      fileId: ver.fileId, fileSha256: ver.fileSha256, lockHash: ver.lockHash ?? null, boxes: ver.boxes, signers: ver.signers, pages: ver.pages.length,
      label: docLabel(doc.number), title: doc.title, versionNumber: ver.number,
      signatureFileId: sig?.signatureFileId ?? null, initialsFileId: sig?.initialsFileId ?? null, ownerName: sig?.name ?? null, ownerTitle: sig?.title ?? null,
    };
  },
});

export const deletePreview = internalMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => { await ctx.storage.delete(storageId); return null; },
});

// ---------- Claude's requests (security review, Oct 27) ----------
// The connector can't approve, send or cancel on its own: it leaves a request, and Heston confirms or declines it
// on the document page while signed in. So text slipped into a PDF, an email or a signer's name can't get a
// contract sent with his signature on it, whatever it persuades Claude to type.
export const REQUEST_TTL = 24 * 3600_000;
const WHAT_LABEL = { approve: "approve", send: "send", cancel: "cancel" } as const;

export const requestAs = internalMutation({
  args: { documentId: v.id("wsDocuments"), what: v.union(v.literal("approve"), v.literal("send"), v.literal("cancel")), said: v.string(), expiresInDays: v.optional(v.number()), reason: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const doc = await ctx.db.get(a.documentId);
    if (!doc) throw new ConvexError("That document doesn't exist.");
    const need = a.what === "approve" ? "draft" : a.what === "send" ? "approved" : "sent";
    if (doc.status !== need) throw new ConvexError(`${docLabel(doc.number)} is ${doc.status}; only ${need === "draft" ? "a draft can be approved" : need === "approved" ? "an approved document can be sent" : "a document out for signature can be cancelled"}.`);
    if (a.what === "approve") {
      const ver = await currentVersion(ctx, doc);
      const problems = approvalProblems({ signers: ver.signers, boxes: ver.boxes, pages: ver.pages.length, payment: ver.payment ?? null, ownerSignatureAdopted: !!(await currentSignature(ctx)) });
      if (problems.length) throw new ConvexError(problems.join(" "));
    }
    if (a.expiresInDays !== undefined && (a.expiresInDays < 1 || a.expiresInDays > 90)) throw new ConvexError("Links can last 1 to 90 days.");
    const now = Date.now();
    for (const r of await ctx.db.query("wsRequests").withIndex("by_document", (q) => q.eq("documentId", doc._id).eq("status", "pending")).collect()) {
      if (r.what === a.what) await ctx.db.patch(r._id, { status: "replaced", decidedAt: now });
    }
    const said = cleanLine(a.said, 200);
    const requestId = await ctx.db.insert("wsRequests", { documentId: doc._id, what: a.what, versionNumber: doc.currentVersion, expiresInDays: a.expiresInDays, reason: a.reason?.trim().slice(0, 300) || undefined, said, status: "pending", createdAt: now });
    await appendEvent(ctx, doc._id, { kind: "claude_requested", actor: "claude", versionNumber: doc.currentVersion, detail: `Claude asked to ${WHAT_LABEL[a.what]} version ${doc.currentVersion} through the connector, saying Heston told it: "${said}". Waiting for Heston to confirm on the site.` });
    return { requestId, expiresAt: now + REQUEST_TTL };
  },
});

// Final test (Oct 28): Heston approved and sent WS-00005 with the page's own buttons, and Claude's approve request sat
// there as "pending" with nothing left to confirm. Doing the thing directly now closes any request it answers
// ("overtaken"), and a request that no longer fits the document's status is never shown as waiting.
const FITS: Record<"approve" | "send" | "cancel", string[]> = { approve: ["draft"], send: ["approved"], cancel: ["sent"] };
export const stillFits = (what: "approve" | "send" | "cancel", status: string) => FITS[what].includes(status);

async function closeRequests(ctx: MutationCtx, documentId: Id<"wsDocuments">, whats: Array<"approve" | "send" | "cancel">) {
  const now = Date.now();
  for (const r of await ctx.db.query("wsRequests").withIndex("by_document", (q) => q.eq("documentId", documentId).eq("status", "pending")).collect()) {
    if (whats.includes(r.what)) await ctx.db.patch(r._id, { status: "overtaken", decidedAt: now });
  }
}

async function pendingOf(ctx: QueryCtx, documentId: Id<"wsDocuments">) {
  const now = Date.now();
  const doc = await ctx.db.get(documentId);
  return (await ctx.db.query("wsRequests").withIndex("by_document", (q) => q.eq("documentId", documentId).eq("status", "pending")).collect()).filter((r) => now - r.createdAt < REQUEST_TTL && !!doc && stillFits(r.what, doc.status));
}

export const requestsFor = query({
  args: { documentId: v.id("wsDocuments") },
  handler: async (ctx, { documentId }) => {
    await requireMe(ctx);
    return (await pendingOf(ctx, documentId)).map((r) => ({ _id: r._id, what: r.what, versionNumber: r.versionNumber, expiresInDays: r.expiresInDays ?? null, reason: r.reason ?? null, said: r.said, createdAt: r.createdAt }));
  },
});

export const pendingRequests = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const now = Date.now();
    const rows = (await ctx.db.query("wsRequests").withIndex("by_status", (q) => q.eq("status", "pending")).order("desc").take(50)).filter((r) => now - r.createdAt < REQUEST_TTL);
    const out = [];
    for (const r of rows) { const d = await ctx.db.get(r.documentId); if (d && stillFits(r.what, d.status)) out.push({ _id: r._id, documentId: r.documentId, label: docLabel(d.number), title: d.title, what: r.what, createdAt: r.createdAt }); }
    return out;
  },
});

export const requestStatus = internalQuery({
  args: { documentId: v.id("wsDocuments") },
  handler: async (ctx, { documentId }) => {
    const rows = await ctx.db.query("wsRequests").withIndex("by_document", (q) => q.eq("documentId", documentId)).collect();
    const now = Date.now();
    const doc = await ctx.db.get(documentId);
    const shown = (r: (typeof rows)[number]) => r.status !== "pending" ? r.status : now - r.createdAt >= REQUEST_TTL ? "expired" : doc && !stillFits(r.what, doc.status) ? "overtaken" : "pending";
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5).map((r) => ({ what: r.what, status: shown(r), asked: new Date(r.createdAt).toISOString(), decided: r.decidedAt ? new Date(r.decidedAt).toISOString() : null, error: r.error ?? null }));
  },
});

export const decideRequest = mutation({
  args: { requestId: v.id("wsRequests"), confirm: v.boolean() },
  handler: async (ctx, { requestId, confirm }) => {
    await requireMe(ctx);
    const r = await ctx.db.get(requestId);
    if (!r) throw new ConvexError("That request doesn't exist.");
    const now = Date.now();
    if (r.status !== "pending") throw new ConvexError(`That request was already ${r.status}.`);
    if (now - r.createdAt >= REQUEST_TTL) { await ctx.db.patch(r._id, { status: "expired", decidedAt: now }); throw new ConvexError("That request is over a day old. Ask Claude again, or do it yourself here."); }
    const doc = (await ctx.db.get(r.documentId))!;
    if (!confirm) {
      await ctx.db.patch(r._id, { status: "declined", decidedAt: now });
      await appendEvent(ctx, doc._id, { kind: "claude_request_declined", actor: OWNER_KEY, versionNumber: doc.currentVersion, detail: `Heston declined Claude's request to ${WHAT_LABEL[r.what]} this document.` });
      return { done: false };
    }
    if (!stillFits(r.what, doc.status)) { await ctx.db.patch(r._id, { status: "overtaken", decidedAt: now }); throw new ConvexError(`Nothing to confirm: the document is already ${doc.status}.`); }
    if (doc.currentVersion !== r.versionNumber) throw new ConvexError(`The document has moved on to version ${doc.currentVersion} since Claude asked. Decline this and check it again.`);
    await appendEvent(ctx, doc._id, { kind: "claude_request_confirmed", actor: OWNER_KEY, versionNumber: doc.currentVersion, detail: `Heston confirmed on the site, signed in: ${WHAT_LABEL[r.what]} (asked by Claude).` });
    const ver = await currentVersion(ctx, doc);
    if (r.what === "approve") await approveCore(ctx, ver._id, OWNER_KEY);
    else if (r.what === "send") await sendCore(ctx, ver._id, r.expiresInDays, OWNER_KEY);
    else await voidCore(ctx, doc._id, r.reason, OWNER_KEY);
    await ctx.db.patch(r._id, { status: "done", decidedAt: now });
    return { done: true };
  },
});
