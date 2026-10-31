// Phase 3b (D71): brand kits. One for the business (Settings › Brand kit, 708:1235) and one per company (the company
// page's Brand kit tab, 718:7694; the proposal questionnaire fills it). Claude reads them through the Sign connector
// to make pitch decks (D72, D89). A kit holds a logo (companies; the business uses its Settings › Business logos),
// colours, heading and body fonts, reference files, links and tone words. Uploads: 25 MB a file, 20 files (D90).
// Owner only; clients never see a kit.
import { mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe } from "./lib/access";
import { businessInScope } from "./lib/business";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES = 20;

export type KitFile = { fileId: Id<"_storage">; name: string; size: number; type: string; addedAt: number; source?: string };
export type Kit = {
  logoFileId?: Id<"_storage">;
  colors: Array<{ hex: string; name?: string }>;
  fonts: { heading?: string; body?: string };
  files: KitFile[];
  links: Array<{ url: string; label: string }>;
  tone: string[];
};
export const EMPTY_KIT: Kit = { colors: [], fonts: {}, files: [], links: [], tone: [] };

async function ownerBiz(ctx: QueryCtx | MutationCtx) {
  await requireMe(ctx);
  const id = businessInScope(ctx);
  const b = id ? await ctx.db.get(id) : null;
  if (!b) throw new ConvexError("Not allowed.");
  return b;
}

/** The kit's row: the business, or one of its companies (the guard refuses another business's company). */
async function holder(ctx: QueryCtx | MutationCtx, clientId: string | undefined): Promise<Doc<"businesses"> | Doc<"clients">> {
  const b = await ownerBiz(ctx);
  if (!clientId) return b;
  const id = ctx.db.normalizeId("clients", clientId);
  const c = id ? await ctx.db.get(id) : null;
  if (!c) throw new ConvexError("That company isn't here.");
  return c;
}
const kitOf = (row: { brandKit?: unknown }): Kit => ({ ...EMPTY_KIT, ...((row.brandKit as Partial<Kit> | undefined) ?? {}) });

/** A link's label from its address ("instagram.com/…" → Instagram, anything else → Website). */
export function linkLabel(url: string) {
  const host = url.replace(/^https?:\/\//i, "").split("/")[0].replace(/^www\./, "").toLowerCase();
  const known: Record<string, string> = { "instagram.com": "Instagram", "vimeo.com": "Vimeo", "youtube.com": "YouTube", "youtu.be": "YouTube", "tiktok.com": "TikTok", "facebook.com": "Facebook", "linkedin.com": "LinkedIn", "x.com": "X", "twitter.com": "X", "behance.net": "Behance", "dropbox.com": "Dropbox", "drive.google.com": "Google Drive", "figma.com": "Figma", "pinterest.com": "Pinterest" };
  return known[host] ?? "Website";
}

export const get = query({
  args: { clientId: v.optional(v.string()) },
  handler: async (ctx, { clientId }) => {
    const row = await holder(ctx, clientId);
    const k = kitOf(row);
    const biz = !clientId ? (row as Doc<"businesses">) : null;
    const url = async (id?: Id<"_storage">) => (id ? await ctx.storage.getUrl(id) : null);
    return {
      kind: clientId ? ("company" as const) : ("business" as const), name: row.name,
      // The business's logos and accent/background come from Settings › Business (shown, not edited here).
      logo: biz ? { dark: await url(biz.logoFileId), light: await url(biz.logoLightFileId), fileId: null } : { dark: await url(k.logoFileId), light: null, fileId: k.logoFileId ?? null },
      fixedColors: biz ? [biz.accent, biz.background].filter((x): x is string => !!x).map((hex, i) => ({ hex, name: i === 0 ? "Accent" : "Background" })) : [],
      colors: k.colors, fonts: k.fonts, links: k.links, tone: k.tone,
      files: await Promise.all(k.files.map(async (f) => ({ ...f, url: await ctx.storage.getUrl(f.fileId) }))),
      limits: { bytes: MAX_FILE_BYTES, files: MAX_FILES },
    };
  },
});

const HEX = /^#[0-9a-f]{6}$/i;
export const save = mutation({
  args: {
    clientId: v.optional(v.id("clients")),
    colors: v.array(v.object({ hex: v.string(), name: v.optional(v.string()) })),
    fonts: v.object({ heading: v.optional(v.string()), body: v.optional(v.string()) }),
    links: v.array(v.object({ url: v.string(), label: v.optional(v.string()) })),
    tone: v.array(v.string()),
  },
  handler: async (ctx, a) => {
    const row = await holder(ctx, a.clientId);
    if (a.colors.length > 24 || a.links.length > 40 || a.tone.length > 30) throw new ConvexError("That's too many for one kit.");
    for (const c of a.colors) if (!HEX.test(c.hex.trim())) throw new ConvexError(`"${c.hex}" isn't a colour like #E10600.`);
    const links = a.links.map((l) => {
      const url = l.url.trim().slice(0, 500);
      if (!/^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(url)) throw new ConvexError(`"${url}" isn't a web address.`);
      return { url, label: (l.label?.trim() || linkLabel(url)).slice(0, 40) };
    });
    const kit: Kit = {
      ...kitOf(row),
      colors: a.colors.map((c) => ({ hex: c.hex.trim().toUpperCase(), ...(c.name?.trim() ? { name: c.name.trim().slice(0, 40) } : {}) })),
      fonts: { ...(a.fonts.heading?.trim() ? { heading: a.fonts.heading.trim().slice(0, 80) } : {}), ...(a.fonts.body?.trim() ? { body: a.fonts.body.trim().slice(0, 80) } : {}) },
      links, tone: [...new Set(a.tone.map((t) => t.trim().slice(0, 30)).filter(Boolean))],
    };
    await ctx.db.patch(row._id, { brandKit: kit });
    return null;
  },
});

export const uploadUrl = mutation({
  args: { clientId: v.optional(v.id("clients")) },
  handler: async (ctx, { clientId }) => {
    const row = await holder(ctx, clientId);
    if (kitOf(row).files.length >= MAX_FILES) throw new ConvexError(`A kit holds up to ${MAX_FILES} files. Remove one first, or link to it instead.`);
    return await ctx.storage.generateUploadUrl();
  },
});

/** After the browser uploads: checks the size and file count (D90), then adds it (or sets the company's logo).
 *  A refused file is deleted and the reason returned (not thrown, so the delete isn't rolled back). */
export async function attachFile(ctx: MutationCtx, row: Doc<"businesses"> | Doc<"clients">, storageId: Id<"_storage">, name: string, opts: { logo?: boolean; source?: string } = {}): Promise<string | null> {
  const meta = await ctx.db.system.get(storageId);
  if (!meta) return "The file didn't upload. Try again.";
  const kit = kitOf(row);
  const refuse = async (msg: string) => { await ctx.storage.delete(storageId); return msg; };
  if (meta.size > MAX_FILE_BYTES) return refuse(`That file is ${Math.ceil(meta.size / 1024 / 1024)} MB. The limit is 25 MB; link to big files (like videos) instead.`);
  if (opts.logo) {
    if (!/^image\/(png|svg\+xml|jpeg|webp)$/.test(meta.contentType ?? "")) return refuse("A logo needs to be an SVG, PNG, JPG or WebP.");
    if (kit.logoFileId) await ctx.storage.delete(kit.logoFileId).catch(() => null);
    await ctx.db.patch(row._id, { brandKit: { ...kit, logoFileId: storageId } });
    return null;
  }
  if (kit.files.length >= MAX_FILES) return refuse(`A kit holds up to ${MAX_FILES} files.`);
  const file: KitFile = { fileId: storageId, name: name.trim().slice(0, 140) || "File", size: meta.size, type: meta.contentType ?? "", addedAt: Date.now(), ...(opts.source ? { source: opts.source } : {}) };
  await ctx.db.patch(row._id, { brandKit: { ...kit, files: [...kit.files, file] } });
  return null;
}

export const addFile = mutation({
  args: { clientId: v.optional(v.id("clients")), storageId: v.id("_storage"), name: v.string(), logo: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const row = await holder(ctx, a.clientId);
    if (a.logo && !a.clientId) throw new ConvexError("The business's logos are set in Settings › Business.");
    return { error: await attachFile(ctx, row, a.storageId, a.name, { logo: a.logo }) };
  },
});

export const removeFile = mutation({
  args: { clientId: v.optional(v.id("clients")), fileId: v.id("_storage"), logo: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const row = await holder(ctx, a.clientId);
    const kit = kitOf(row);
    if (a.logo) { if (kit.logoFileId !== a.fileId) throw new ConvexError("That logo isn't here."); await ctx.db.patch(row._id, { brandKit: { ...kit, logoFileId: undefined } }); }
    else {
      if (!kit.files.some((f) => f.fileId === a.fileId)) throw new ConvexError("That file isn't in this kit.");
      await ctx.db.patch(row._id, { brandKit: { ...kit, files: kit.files.filter((f) => f.fileId !== a.fileId) } });
    }
    await ctx.storage.delete(a.fileId).catch(() => null);
    return null;
  },
});
