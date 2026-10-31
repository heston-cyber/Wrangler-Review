// The video register (Phase R2, Oct 22): the Register page, New video, file names for the next render,
// and the read-only feed the Google Sheet copy pulls every 10 minutes.
import { action, httpAction } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./lib/functions";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { requireMe } from "./lib/access";
import type { Id } from "./_generated/dataModel";
import { highestVersion, insertVideo, nextFileName, pad5, shortTitleError, shortTitleFrom, takeNumber, videoByNumber } from "./lib/register";
import { pickProject, splitJob } from "./lib/dropboxPath";
import { sha256Hex } from "./connector";
import { SITE } from "./lib/site";
import { forBusiness } from "./lib/functions";
import { defaultBusiness } from "./lib/business";

const clean = (s: string, max = 200) => s.trim().replace(/\s+/g, " ").slice(0, max);
const site = () => SITE();
const iso = (ms: number) => new Date(ms).toISOString();

type Row = {
  videoId: Id<"videos">; number: number; numberText: string; shortTitle: string; title: string;
  client: string | null; project: string; projectId: Id<"projects">; jobNumber: string | null;
  versions: number; latest: number | null; status: string; openNotes: number;
  createdAt: number; lastActivity: number; nextFileName: string | null; link: string;
  final: { version: number; at: number } | null; storageBytes: number | null;
};

async function rows(ctx: QueryCtx): Promise<{ rows: Row[]; unnumbered: number }> {
  const projects = new Map((await ctx.db.query("projects").collect()).map((p) => [p._id as string, p]));
  const out: Row[] = [];
  let unnumbered = 0;
  for (const vid of await ctx.db.query("videos").collect()) {
    if (!vid.number) { unnumbered++; continue; }
    const p = projects.get(vid.projectId);
    const versions = (await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", vid._id)).collect()).sort((a, b) => a.number - b.number);
    const latest = versions[versions.length - 1] ?? null;
    const notes = latest ? await ctx.db.query("notes").withIndex("by_video", (q) => q.eq("videoId", vid._id)).collect() : [];
    const open = latest ? notes.filter((n) => n.versionId === latest._id && n.status === "open").length : 0;
    const lastNote = notes.reduce((m, n) => Math.max(m, n.createdAt ?? 0), 0);
    out.push({
      videoId: vid._id, number: vid.number, numberText: pad5(vid.number), shortTitle: vid.shortTitle ?? "", title: vid.title,
      client: p?.client?.trim() || null, project: p?.name ?? "", projectId: vid.projectId, jobNumber: p?.jobNumber ?? null,
      versions: versions.length, latest: latest?.number ?? null,
      status: vid.final ? `Final v${vid.final.version}` : !latest ? "Waiting for v1" : latest.status === "ready" ? (open ? "Open notes" : "Ready") : latest.status === "failed" ? "Failed" : "Converting",
      final: vid.final ?? null, storageBytes: versions.some((x) => x.storageBytes !== undefined) ? versions.reduce((m, x) => m + (x.storageBytes ?? 0), 0) : null,
      openNotes: open, createdAt: vid.createdAt, lastActivity: Math.max(vid.updatedAt, lastNote),
      nextFileName: nextFileName(vid, latest?.number ?? 0), link: `${site()}/v/${vid._id}`,
    });
  }
  return { rows: out.sort((a, b) => b.number - a.number), unnumbered };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    return await rows(ctx);
  },
});

// The name to render next for one video (shown on the video page).
export const nextName = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    await requireMe(ctx);
    const vid = await ctx.db.get(videoId);
    if (!vid?.number) return null;
    return { number: pad5(vid.number), shortTitle: vid.shortTitle ?? "", fileName: nextFileName(vid, await highestVersion(ctx, videoId)) };
  },
});

// Finds a project by name (or "26122 Spirit Days" / job number), or makes it.
async function projectFor(ctx: MutationCtx, a: { projectId?: Id<"projects">; projectName?: string; jobNumber?: string; client?: string }) {
  if (a.projectId) {
    const p = await ctx.db.get(a.projectId);
    if (!p) throw new ConvexError("That project no longer exists.");
    return p._id;
  }
  const name = clean(a.projectName ?? "", 120);
  if (!name) throw new ConvexError("Pick a project, or name a new one.");
  const client = a.client ? clean(a.client, 120) : undefined;
  const picked = pickProject(await ctx.db.query("projects").collect(), name, client);
  if (picked) {
    if (picked.setClient && client) await ctx.db.patch(picked.project._id, { client });
    return picked.project._id;
  }
  const split = splitJob(name);
  const jobNumber = a.jobNumber ? clean(a.jobNumber, 40) : split.jobNumber;
  return await ctx.db.insert("projects", { name: split.name, ...(jobNumber ? { jobNumber } : {}), ...(client ? { client } : {}), createdAt: Date.now() });
}

async function register(ctx: MutationCtx, a: { title: string; shortTitle?: string; projectId?: Id<"projects">; projectName?: string; jobNumber?: string; client?: string }) {
  const title = clean(a.title, 160);
  if (!title) throw new ConvexError("Give the video a title.");
  const shortTitle = (a.shortTitle ?? "").trim() || shortTitleFrom(title);
  const bad = shortTitleError(shortTitle);
  if (bad) throw new ConvexError(bad);
  const projectId = await projectFor(ctx, a);
  const made = await insertVideo(ctx, { projectId, title, shortTitle });
  const p = await ctx.db.get(projectId);
  return { ...made, numberText: pad5(made.number), project: p?.name ?? "", client: p?.client ?? null, link: `${site()}/v/${made.videoId}` };
}

const regArgs = {
  title: v.string(), shortTitle: v.optional(v.string()), projectId: v.optional(v.id("projects")),
  projectName: v.optional(v.string()), jobNumber: v.optional(v.string()), client: v.optional(v.string()),
};

// "New video": the next number, the short title and the first file name to render.
export const newVideo = mutation({
  args: regArgs,
  handler: async (ctx, a) => {
    await requireMe(ctx);
    return await register(ctx, a);
  },
});

// The same for the Claude connector (its key was checked by the MCP endpoint).
export const newVideoInternal = internalMutation({ args: regArgs, handler: async (ctx, a) => await register(ctx, a) });

// Changes the short title (only future file names change; past versions keep their names).
export const setShortTitle = mutation({
  args: { videoId: v.id("videos"), shortTitle: v.string() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const s = a.shortTitle.trim();
    const bad = shortTitleError(s);
    if (bad) throw new ConvexError(bad);
    const vid = await ctx.db.get(a.videoId);
    if (!vid?.number) throw new ConvexError("This video isn't in the register.");
    await ctx.db.patch(a.videoId, { shortTitle: s });
  },
});

// Puts an older video into the register (Oct 22: LC Arizona became 00001). With no number it gets the next one.
// The counter moves past a chosen number, so it's never handed out again.
export async function numberVideo(ctx: MutationCtx, a: { videoId: Id<"videos">; number?: number; shortTitle: string; client?: string }) {
  const vid = await ctx.db.get(a.videoId);
  if (!vid) throw new ConvexError("No such video.");
  if (vid.number) throw new ConvexError(`It's already ${pad5(vid.number)}.`);
  const shortTitle = a.shortTitle.trim();
  const bad = shortTitleError(shortTitle);
  if (bad) throw new ConvexError(bad);
  let number: number;
  if (a.number !== undefined) {
    if (!Number.isInteger(a.number) || a.number < 1 || a.number > 99999) throw new ConvexError("Numbers run 1 to 99999.");
    if (await videoByNumber(ctx, a.number)) throw new ConvexError(`${pad5(a.number)} is taken.`);
    number = a.number;
    const row = await ctx.db.query("counters").withIndex("by_key", (q) => q.eq("key", "videoNumber")).first();
    if (!row) await ctx.db.insert("counters", { key: "videoNumber", value: number + 1 });
    else if (row.value <= number) await ctx.db.patch(row._id, { value: number + 1 });
  } else {
    number = await takeNumber(ctx);
  }
  await ctx.db.patch(a.videoId, { number, shortTitle });
  if (a.client?.trim()) await ctx.db.patch(vid.projectId, { client: clean(a.client, 120) });
  return { number: pad5(number), title: vid.title, next: nextFileName({ number, shortTitle }, await highestVersion(ctx, a.videoId)) };
}

export const numberExisting = internalMutation({
  args: { videoId: v.id("videos"), number: v.optional(v.number()), shortTitle: v.string(), client: v.optional(v.string()) },
  handler: async (ctx, a) => await numberVideo(ctx, a),
});

// "Add to the register" on an older video's page.
export const addToRegister = mutation({
  args: { videoId: v.id("videos"), number: v.optional(v.number()), shortTitle: v.string() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    return await numberVideo(ctx, a);
  },
});

// For the CI check: counts only (the public CI log never carries names).
export const counts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { rows: r, unnumbered } = await rows(ctx);
    const c = await ctx.db.query("counters").withIndex("by_key", (q) => q.eq("key", "videoNumber")).first();
    return { numbered: r.length, unnumbered, numbers: r.map((x) => x.numberText), nextNumber: c?.value ?? 1, sheetKeys: (await ctx.db.query("sheetKeys").collect()).length };
  },
});

// ---------- the Google Sheet copy ----------

function base64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// One key at a time: making a new one replaces the old. The key is shown once on the Settings page.
export const makeSheetKey = action({
  args: {},
  handler: async (ctx): Promise<{ key: string }> => {
    await ctx.runQuery(internal.users.assertAllowed, {});
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const key = "wrs_" + base64url(bytes);
    await ctx.runMutation(internal.register.replaceSheetKey, { hash: await sha256Hex(key), prefix: key.slice(0, 9) });
    return { key };
  },
});

export const replaceSheetKey = internalMutation({
  args: { hash: v.string(), prefix: v.string() },
  handler: async (ctx, a) => {
    for (const k of await ctx.db.query("sheetKeys").collect()) await ctx.db.delete(k._id);
    await ctx.db.insert("sheetKeys", { hash: a.hash, prefix: a.prefix, createdAt: Date.now() });
  },
});

export const sheetKey = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const k = await ctx.db.query("sheetKeys").first();
    return k ? { prefix: k.prefix, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt ?? null } : null;
  },
});

export const removeSheetKey = mutation({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    for (const k of await ctx.db.query("sheetKeys").collect()) await ctx.db.delete(k._id);
  },
});

export const feedRows = internalMutation({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const k = await ctx.db.query("sheetKeys").withIndex("by_hash", (q) => q.eq("hash", hash)).first();
    if (!k) return null;
    await ctx.db.patch(k._id, { lastUsedAt: Date.now() });
    return (await rows(ctx)).rows;
  },
});

export const FEED_COLUMNS = ["Number", "Next render", "Title", "Short title", "Client", "Project", "Job", "Latest version", "Versions", "Status", "Final", "Open notes", "Storage (GB)", "Created", "Last activity", "Link"] as const;

export function feedTable(r: Row[]) {
  return r.map((x) => ({
    "Number": x.numberText, "Next render": x.nextFileName ? x.nextFileName + ".mp4" : "", "Title": x.title, "Short title": x.shortTitle,
    "Client": x.client ?? "", "Project": x.project, "Job": x.jobNumber ?? "", "Latest version": x.latest ? `v${x.latest}` : "",
    "Versions": x.versions, "Status": x.status, "Final": x.final ? `v${x.final.version} · ${iso(x.final.at).slice(0, 10)}` : "", "Open notes": x.openNotes,
    "Storage (GB)": x.storageBytes === null ? "" : Math.round(x.storageBytes / 1e7) / 100, "Created": iso(x.createdAt), "Last activity": iso(x.lastActivity), "Link": x.link,
  }));
}

// GET /register-feed with the sheet key in X-Key (or ?key=). Read-only.
export const feed = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const key = req.headers.get("x-key") || url.searchParams.get("key") || "";
  const hash = key ? await sha256Hex(key) : "";
  if (key) ctx = forBusiness(ctx, await ctx.runQuery(internal.register.businessOfSheetKey, { hash })); // only that key's business
  const r = key ? await ctx.runMutation(internal.register.feedRows, { hash }) : null;
  if (!r) return new Response(JSON.stringify({ error: "Wrong or missing sheet key. Make a new one in Wrangler Review › Settings › Google Sheet copy." }), { status: 401, headers: { "content-type": "application/json" } });
  const ledger = await ctx.runQuery(internal.crm.ledgerRows, {}); // Phase 3 (D58): the "Job ledger" tab
  return new Response(JSON.stringify({ updated: new Date().toISOString(), columns: FEED_COLUMNS, rows: feedTable(r), ledger }), {
    status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
});

export type RegisterRow = Row;

/** The business a Google Sheet key belongs to (null for an unknown key; the feed then refuses it). */
export const businessOfSheetKey = internalQuery({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const k = await ctx.db.query("sheetKeys").withIndex("by_hash", (q) => q.eq("hash", hash)).unique();
    if (!k) return null;
    return k.businessId ?? (await defaultBusiness(ctx))?._id ?? null;
  },
});
