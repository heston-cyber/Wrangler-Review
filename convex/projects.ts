// Phase 2 Part A (Oct 29): the project hub. One page per job: its stage (the Wrangler Way, Discovery → Delivery),
// next step, key dates, cuts with their revision rounds, the client's documents, and the final files.
//
// Owner functions use requireMe; the database guard (lib/functions) keeps them to the owner's business.
// Clients see a project only when one of their live share invites covers it (the same rule as Review), and the
// final files only once the owner (or, in Part B, a paid final invoice) unlocks them, until the links expire.
import { internalQuery, mutation, query } from "./lib/functions";
import { action } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe, requireSignedIn } from "./lib/access";
import { clampRounds, roundOf, roundsFor } from "./lib/rounds";
import { postToInbox, businessOf, hasAccess } from "./lib/inbox";
import { coveredProjects, coveredVideos, sameBusiness, shareState } from "./lib/shareAccess";
import { downloadFor, signedThumbUrl, signStillUrl } from "./lib/media";
import { docLabel } from "./lib/wsLayout";
import { crmProject } from "./crm";

export const STAGES = ["discovery", "strategy", "production", "polish", "delivery"] as const;
export type Stage = (typeof STAGES)[number];
const stageArg = v.union(v.literal("discovery"), v.literal("strategy"), v.literal("production"), v.literal("polish"), v.literal("delivery"));
export const stageName = (s: Stage) => s[0].toUpperCase() + s.slice(1);
const DAY = 86_400_000;
const LINK_DAYS = 7;
const label = (p: { name: string; jobNumber?: string }) => (p.jobNumber ? `${p.jobNumber} ${p.name}` : p.name);

function deliveryState(p: Doc<"projects">, now = Date.now()) {
  const linkDays = p.deliveryLinkDays ?? LINK_DAYS;
  const unlockedAt = p.deliveryUnlockedAt ?? null;
  const expiresAt = unlockedAt ? unlockedAt + linkDays * DAY : null;
  return { unlockedAt, linkDays, expiresAt, open: !!unlockedAt && !!expiresAt && expiresAt > now };
}

async function ownedProject(ctx: QueryCtx | MutationCtx, raw: string) {
  const id = ctx.db.normalizeId("projects", raw);
  const p = id ? await ctx.db.get(id) : null;
  if (!p) throw new ConvexError("This project doesn't exist any more.");
  return p;
}

/** Who hears about this project (stage moves, final files): the invited members of live project or client shares that
 *  cover it, with a live invite in its business. The same people who can open its project page (myProjects). */
async function portalPeople(ctx: QueryCtx | MutationCtx, p: Doc<"projects">) {
  const biz = await businessOf(ctx, p);
  if (!biz) return [];
  const shares = (await ctx.db.query("shares").collect()).filter((s) => s.who === "invited" && s.kind !== "video" && !shareState(s) && sameBusiness(s, p));
  const seen = new Set<string>();
  const out: Array<{ email: string }> = [];
  for (const s of shares) {
    if (!(await coveredProjects(ctx, s)).some((x) => x._id === p._id)) continue;
    for (const m of await ctx.db.query("shareMembers").withIndex("by_share", (q) => q.eq("shareId", s._id)).collect()) {
      const e = m.email.toLowerCase();
      if (seen.has(e) || !(await hasAccess(ctx, biz, m.email))) continue;
      seen.add(e); out.push({ email: m.email });
    }
  }
  return out;
}

export async function clientDocs(ctx: QueryCtx | MutationCtx, emails: Set<string>, businessId: Id<"businesses"> | undefined) {
  const docs = new Map<string, { _id: Id<"wsDocuments">; label: string; title: string; status: string; sentAt: number | null; completedAt: number | null }>();
  for (const e of emails) {
    for (const sg of await ctx.db.query("wsSignings").withIndex("by_email", (q) => q.eq("email", e)).collect()) {
      const d = await ctx.db.get(sg.documentId);
      if (!d || docs.has(d._id) || (businessId && d.businessId !== businessId) || d.status === "draft" || d.status === "approved" || d.hiddenAt) continue;
      docs.set(d._id, { _id: d._id, label: docLabel(d.number), title: d.title, status: d.status, sentAt: d.sentAt ?? null, completedAt: d.completedAt ?? null });
    }
  }
  return [...docs.values()].sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0));
}

async function filesOf(ctx: QueryCtx | MutationCtx, projectId: Id<"projects">) {
  const rows = await ctx.db.query("deliveryFiles").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect();
  return rows.map((f) => ({ _id: f._id, name: f.name, size: f.size ?? null, kind: f.kind, note: f.note ?? null }));
}

// ---------- owner ----------

/** The owner's project page. */
export const page = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    await requireMe(ctx);
    const id = ctx.db.normalizeId("projects", projectId);
    const p = id ? await ctx.db.get(id) : null;
    if (!p) return null;
    const client = p.clientId ? await ctx.db.get(p.clientId) : null;
    const r = await roundsFor(ctx, p);
    const videos = [];
    for (const vid of await ctx.db.query("videos").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()) {
      const vs = (await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", vid._id)).collect()).sort((a, b) => b.number - a.number);
      const latest = vs[0] ?? null;
      const open = latest ? (await ctx.db.query("notes").withIndex("by_version", (q) => q.eq("versionId", latest._id)).collect()).filter((n) => n.status === "open").length : 0;
      videos.push({
        _id: vid._id, number: vid.number ?? null, title: vid.title, updatedAt: vid.updatedAt,
        latest: latest && { versionId: latest._id, number: latest.number, status: latest.status, versions: vs.length },
        round: latest && !r.off ? roundOf(latest.number, r.included) : null,
        openNotes: open, final: vid.final ? { version: vid.final.version } : null,
        thumbUrl: latest ? (await signStillUrl(latest.posterUrl)) ?? (await signedThumbUrl(latest)) : null,
      });
    }
    videos.sort((a, b) => b.updatedAt - a.updatedAt);
    const people = p.clientId ? (await ctx.db.query("clientPeople").withIndex("by_client", (q) => q.eq("clientId", p.clientId!)).collect()).filter((x) => !x.removedAt) : [];
    return {
      _id: p._id, name: p.name, jobNumber: p.jobNumber ?? null, label: label(p),
      client: client ? { _id: client._id, name: client.name, watermarkOff: !!client.watermarkOff } : null,
      stage: (p.stage ?? "discovery") as Stage, nextStep: p.nextStep ?? null, keyDates: p.keyDates ?? [],
      rounds: { included: r.included, off: r.off, from: r.from, project: p.rounds ?? null, client: r.clientRounds, business: r.businessRounds, businessOff: r.businessOff },
      videos,
      documents: await clientDocs(ctx, new Set(people.map((x) => x.email)), p.businessId),
      people: people.map((x) => ({ _id: x._id, name: x.name ?? null, email: x.email, role: x.role })),
      delivery: { ...deliveryState(p), files: await filesOf(ctx, p._id) },
      dropbox: !!p.dropboxFolder,
    };
  },
});

/** Move the stage; optionally tell the client's people in their Inbox (with an optional note). */
export const setStage = mutation({
  args: { projectId: v.string(), stage: stageArg, post: v.boolean(), note: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const p = await ownedProject(ctx, a.projectId);
    const now = Date.now();
    await ctx.db.patch(p._id, { stage: a.stage, updatedAt: now });
    if (["production", "polish", "delivery"].includes(a.stage)) await crmProject(ctx, p._id, "in_production", `project stage: ${a.stage}`); // Phase 3
    let posted = 0;
    if (a.post) {
      const biz = await businessOf(ctx, p);
      const note = (a.note ?? "").trim().slice(0, 400);
      if (biz) for (const person of await portalPeople(ctx, p)) {
        if (await postToInbox(ctx, {
          businessId: biz, clientId: p.clientId, email: person.email, kind: "stage", title: `Stage moved to ${stageName(a.stage)}`,
          text: note || label(p), link: `/projects/${p._id}`, linkLabel: "Open project", source: { module: "projects", id: p._id }, key: `stage:${p._id}:${a.stage}:${now}`,
        })) posted++;
      }
    }
    return { posted };
  },
});

export const setNextStep = mutation({
  args: { projectId: v.string(), text: v.string() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const p = await ownedProject(ctx, a.projectId);
    const t = a.text.trim().replace(/\s+/g, " ");
    if (t.length > 200) throw new ConvexError("Keep the next step under 200 characters.");
    await ctx.db.patch(p._id, { nextStep: t || undefined, updatedAt: Date.now() });
    return null;
  },
});

export const setKeyDates = mutation({
  args: { projectId: v.string(), dates: v.array(v.object({ label: v.string(), date: v.string() })) },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const p = await ownedProject(ctx, a.projectId);
    if (a.dates.length > 12) throw new ConvexError("Up to 12 key dates.");
    const dates = [];
    for (const d of a.dates) {
      const l = d.label.trim().replace(/\s+/g, " ").slice(0, 40);
      if (!l && !d.date) continue;
      if (!l) throw new ConvexError("Each date needs a name.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || Number.isNaN(Date.parse(d.date))) throw new ConvexError(`Pick a date for "${l}".`);
      dates.push({ label: l, date: d.date });
    }
    dates.sort((x, y) => x.date.localeCompare(y.date));
    await ctx.db.patch(p._id, { keyDates: dates, updatedAt: Date.now() });
    return null;
  },
});

/** Rounds per video on this project; null goes back to the client's (or the business's) setting. */
export const setRounds = mutation({
  args: { projectId: v.string(), rounds: v.union(v.number(), v.null()) },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const p = await ownedProject(ctx, a.projectId);
    await ctx.db.patch(p._id, { rounds: a.rounds === null ? undefined : clampRounds(a.rounds), updatedAt: Date.now() });
    return null;
  },
});

/** The rounds a new version would be on, for the upload's change-order prompt. */
export const nextRound = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    await requireMe(ctx);
    const vid = await ctx.db.get(videoId);
    if (!vid) return null;
    const p = await ctx.db.get(vid.projectId);
    const r = await roundsFor(ctx, p);
    const vs = await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
    const next = vs.reduce((m, x) => Math.max(m, x.number), 0) + 1;
    const client = p?.clientId ? await ctx.db.get(p.clientId) : null;
    return { next, included: r.included, over: !r.off && next > r.included, project: p ? label(p) : null, projectId: p?._id ?? null, client: client?.name ?? null, video: vid.title };
  },
});

// ---------- final files ----------

export const addDeliveryFile = mutation({
  args: {
    projectId: v.string(),
    file: v.union(
      v.object({ kind: v.literal("dropbox"), path: v.string(), name: v.string(), size: v.optional(v.number()) }),
      v.object({ kind: v.literal("version"), versionId: v.id("versions") }),
    ),
  },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const p = await ownedProject(ctx, a.projectId);
    const existing = await ctx.db.query("deliveryFiles").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect();
    if (existing.length >= 50) throw new ConvexError("Up to 50 final files per project.");
    if (a.file.kind === "dropbox") {
      const path = a.file.path.trim().toLowerCase();
      if (!path.startsWith("/") || path.includes("..")) throw new ConvexError("That isn't a Dropbox path.");
      if (existing.some((f) => f.dropboxPath === path)) return null;
      await ctx.db.insert("deliveryFiles", { projectId: p._id, kind: "dropbox", dropboxPath: path, name: a.file.name.slice(0, 200), size: a.file.size, note: "Dropbox", createdAt: Date.now() });
    } else {
      const ver = await ctx.db.get(a.file.versionId);
      const vid = ver ? await ctx.db.get(ver.videoId) : null;
      if (!ver || !vid || vid.projectId !== p._id) throw new ConvexError("That version isn't in this project.");
      if (existing.some((f) => f.versionId === ver._id)) return null;
      const name = `${vid.number ? String(vid.number).padStart(5, "0") + "_" : ""}${(vid.shortTitle || vid.title).replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "")}_v${ver.number}.mp4`;
      await ctx.db.insert("deliveryFiles", { projectId: p._id, kind: "version", versionId: ver._id, name, size: ver.fileSize, note: "From the site", createdAt: Date.now() });
    }
    await ctx.db.patch(p._id, { updatedAt: Date.now() });
    return null;
  },
});

export const removeDeliveryFile = mutation({
  args: { fileId: v.id("deliveryFiles") },
  handler: async (ctx, { fileId }) => {
    await requireMe(ctx);
    const f = await ctx.db.get(fileId);
    if (f) await ctx.db.delete(f._id);
    return null;
  },
});

/** Unlock or lock the final files by hand (Part B unlocks them when the final invoice is paid), or change how long
 *  the links last. Unlocking tells the client's people ("Final files ready"). */
export const setDelivery = mutation({
  args: { projectId: v.string(), unlocked: v.optional(v.boolean()), linkDays: v.optional(v.number()) },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const p = await ownedProject(ctx, a.projectId);
    const patch: Partial<Doc<"projects">> = { updatedAt: Date.now() };
    if (a.linkDays !== undefined) patch.deliveryLinkDays = Math.max(1, Math.min(90, Math.round(a.linkDays)));
    let posted = 0;
    if (a.unlocked === false) patch.deliveryUnlockedAt = undefined;
    if (a.unlocked === true) {
      const files = await ctx.db.query("deliveryFiles").withIndex("by_project", (q) => q.eq("projectId", p._id)).first();
      if (!files) throw new ConvexError("Add the final files first.");
    }
    await ctx.db.patch(p._id, patch);
    if (a.unlocked === true) posted = (await openDelivery(ctx, p)) ?? 0;
    return { posted };
  },
});

/** Opens the final files for the client (the owner's Unlock, or a paid final invoice): the links start now, and the
 *  project's people get "Final files ready". Returns how many were told, or null when there are no files to open. */
export async function openDelivery(ctx: MutationCtx, p: Doc<"projects">): Promise<number | null> {
  const files = await ctx.db.query("deliveryFiles").withIndex("by_project", (q) => q.eq("projectId", p._id)).first();
  if (!files) return null;
  const now = Date.now();
  await ctx.db.patch(p._id, { deliveryUnlockedAt: now, updatedAt: now });
  await crmProject(ctx, p._id, "delivered", "final files opened"); // Phase 3
  let posted = 0;
  const biz = await businessOf(ctx, p);
  if (biz) for (const person of await portalPeople(ctx, p)) {
    if (await postToInbox(ctx, {
      businessId: biz, clientId: p.clientId, email: person.email, kind: "final_files", title: "Final files ready", text: label(p),
      link: `/projects/${p._id}`, linkLabel: "Download", source: { module: "projects", id: p._id }, key: `final:${p._id}:${now}`,
    })) posted++;
  }
  return posted;
}

/** Files in the project's Dropbox folder, to pick final files from. */
export const dropboxFiles = action({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }): Promise<{ path: string; name: string; size: number }[]> => {
    const me: { businessId: Id<"businesses"> | null } = await ctx.runQuery(internal.users.assertAllowed, {});
    const folder: string | null = await ctx.runQuery(internal.projects.folderOf, { projectId });
    if (!folder) throw new ConvexError("This project has no Dropbox folder.");
    return await ctx.runAction(internal.dropbox.listFolder, { path: folder, ...(me.businessId ? { asBusiness: me.businessId } : {}) });
  },
});
export const folderOf = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => (await ctx.db.get(projectId))?.dropboxFolder ?? null,
});

// ---------- the client side ----------

/** The projects a signed-in client can see: those a live project or client share they're invited to covers. A share
 *  of one video doesn't open its project page (stage, documents, final files); it adds that video to a project page
 *  the person can already see. */
async function myProjects(ctx: QueryCtx, email: string) {
  type Row = { project: Doc<"projects">; videos: Map<string, { video: Doc<"videos">; token: string }> };
  const out = new Map<string, Row>();
  const invites = (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", email)).collect()).filter((i) => !i.revokedAt);
  if (!invites.length) return out;
  const live = [];
  for (const m of await ctx.db.query("shareMembers").withIndex("by_email", (q) => q.eq("email", email)).collect()) {
    const s = await ctx.db.get(m.shareId);
    if (s && !shareState(s) && invites.some((i) => sameBusiness(s, i))) live.push(s);
  }
  for (const s of live) if (s.kind !== "video") for (const p of await coveredProjects(ctx, s)) if (!out.has(p._id)) out.set(p._id, { project: p, videos: new Map() });
  for (const s of live) {
    for (const vid of await coveredVideos(ctx, s)) {
      const row = out.get(vid.projectId);
      if (row && !row.videos.has(vid._id)) row.videos.set(vid._id, { video: vid, token: s.token });
    }
  }
  return out;
}

/** The client's projects (Home's project card and the Review layer). */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireSignedIn(ctx);
    if (me.kind !== "client") return [];
    const out = [];
    for (const { project: p } of (await myProjects(ctx, me.email)).values()) {
      const biz = p.businessId ? await ctx.db.get(p.businessId) : null;
      if (biz?.modules?.projects === false) continue; // the owner switched project pages off (Settings › Business)
      out.push({ _id: p._id, label: label(p), stage: (p.stage ?? "discovery") as Stage, nextStep: p.nextStep ?? null, business: biz?.name ?? null, updatedAt: p.updatedAt ?? p.createdAt, delivery: deliveryState(p).open });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/** One project as its client sees it. */
export const forClient = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const me = await requireSignedIn(ctx);
    if (me.kind !== "client") return null;
    const id = ctx.db.normalizeId("projects", projectId);
    const row = id ? (await myProjects(ctx, me.email)).get(id) : undefined;
    if (!row) return null;
    const p = row.project;
    if (p.businessId && (await ctx.db.get(p.businessId))?.modules?.projects === false) return null;
    const r = await roundsFor(ctx, p);
    const videos = [];
    for (const { video: vid, token } of row.videos.values()) {
      const ready = (await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", vid._id)).collect()).filter((x) => x.status === "ready").sort((a, b) => b.number - a.number);
      const last = ready[0];
      if (!last) continue;
      const approved = (await ctx.db.query("clientApprovals").withIndex("by_version_user", (q) => q.eq("versionId", last._id).eq("userId", me.userId)).first()) !== null;
      videos.push({ _id: vid._id, title: vid.title, token, version: last.number, round: r.off ? null : roundOf(last.number, r.included), approved, final: !!vid.final, thumbUrl: (await signStillUrl(last.posterUrl)) ?? (await signedThumbUrl(last)), updatedAt: vid.updatedAt });
    }
    videos.sort((a, b) => b.updatedAt - a.updatedAt);
    const d = deliveryState(p);
    const biz = p.businessId ? await ctx.db.get(p.businessId) : null;
    return {
      _id: p._id, label: label(p), business: biz?.name ?? null,
      stage: (p.stage ?? "discovery") as Stage, nextStep: p.nextStep ?? null, keyDates: p.keyDates ?? [],
      rounds: r.off ? null : r.included, videos,
      documents: await clientDocs(ctx, new Set([me.email]), p.businessId),
      delivery: { open: d.open, expiresAt: d.open ? d.expiresAt : null, expired: !!d.unlockedAt && !d.open, files: d.open ? await filesOf(ctx, p._id) : [], count: (await filesOf(ctx, p._id)).length },
    };
  },
});

/** A download link for one final file: the owner any time; a client only while the files are unlocked. */
export const deliveryLink = action({
  args: { fileId: v.id("deliveryFiles") },
  handler: async (ctx, { fileId }): Promise<{ url: string; name: string }> => {
    const f: { kind: "dropbox" | "version"; path: string | null; versionId: Id<"versions"> | null; name: string; until: number; businessId: Id<"businesses"> | null } = await ctx.runQuery(internal.projects.canDownload, { fileId });
    if (f.kind === "dropbox") {
      const url: string = await ctx.runAction(internal.dropbox.temporaryLink, { path: f.path!, ...(f.businessId ? { asBusiness: f.businessId } : {}) });
      return { url, name: f.name };
    }
    const url: string | null = await ctx.runQuery(internal.projects.versionFileUrl, { versionId: f.versionId!, until: f.until });
    if (!url) throw new ConvexError("That file isn't available.");
    // The site's copy may be the render as uploaded (a .mov, say) rather than an MP4: name it by what it is.
    const ext = /\.(mp4|mov|m4v|mxf)$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();
    return { url, name: ext ? f.name.replace(/\.[^.]+$/, `.${ext}`) : f.name };
  },
});
export const canDownload = internalQuery({
  args: { fileId: v.id("deliveryFiles") },
  handler: async (ctx, { fileId }) => {
    const me = await requireSignedIn(ctx);
    const f = await ctx.db.get(fileId);
    const p = f ? await ctx.db.get(f.projectId) : null;
    if (!f || !p) throw new ConvexError("That file isn't available.");
    const now = Date.now();
    let until = now + 4 * 3_600_000;
    if (me.kind === "client") {
      const d = deliveryState(p, now);
      if (!d.open || !(await myProjects(ctx, me.email)).has(p._id)) throw new ConvexError("The final files aren't open yet.");
      until = Math.min(until, d.expiresAt!);
    }
    return { kind: f.kind, path: f.dropboxPath ?? null, versionId: f.versionId ?? null, name: f.name, until, businessId: p.businessId ?? null };
  },
});
export const versionFileUrl = internalQuery({
  args: { versionId: v.id("versions"), until: v.number() },
  handler: async (ctx, { versionId }) => {
    // The same file "Download" saves (the render itself, or the largest MP4 copy); its signature lasts a few hours,
    // and a fresh one is made on every click while the files are open.
    const ver = await ctx.db.get(versionId);
    return ver ? (await downloadFor(ver))?.url ?? null : null;
  },
});
