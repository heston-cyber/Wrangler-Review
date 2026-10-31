// Phase 3c (Oct 31) · Vendors, the owner's side: the vendor record (S5 · Phase 3c 730:2 All vendors, 730:653 empty,
// 730:1153 the vendor page, 732:2909 Add vendor). A business's subcontractors with their roles, rates (shown beside the
// business's own Pricing subcontractor costs), details, gear, W-9 status and notes. Bookings, briefings, the vendor
// portal and payments build on this in the next steps. Owner only.
import { mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe } from "./lib/access";
import { businessInScope } from "./lib/business";
import type { Rates } from "./lib/estimate";
import { ratesOf } from "./crm";

const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const clip = (s: string | undefined, n: number) => (s ?? "").trim().slice(0, n);

async function ownerBiz(ctx: QueryCtx | MutationCtx) {
  await requireMe(ctx);
  const id = businessInScope(ctx);
  const b = id ? await ctx.db.get(id) : null;
  if (!b) throw new ConvexError("Not allowed.");
  return b;
}
const rateV = v.object({ role: v.string(), unit: v.union(v.literal("day"), v.literal("hour")), cents: v.number() });
const detailsV = {
  name: v.string(), email: v.string(), roles: v.array(v.string()), rates: v.array(rateV),
  basedIn: v.optional(v.string()), phone: v.optional(v.string()), portfolio: v.optional(v.string()), gear: v.optional(v.array(v.string())), notes: v.optional(v.string()),
};
type Details = { name: string; email: string; roles: string[]; rates: Array<{ role: string; unit: "day" | "hour"; cents: number }>; basedIn?: string; phone?: string; portfolio?: string; gear?: string[]; notes?: string };

function clean(a: Details) {
  const email = a.email.trim().toLowerCase();
  if (!a.name.trim()) throw new ConvexError("Add their name.");
  if (!EMAIL.test(email) || email.length > 254) throw new ConvexError("Add their email.");
  const roles = [...new Set(a.roles.map((r) => clip(r, 40)).filter(Boolean))].slice(0, 12);
  const rates = a.rates.slice(0, 12).map((r) => ({ role: clip(r.role, 40) || roles[0] || "Rate", unit: r.unit, cents: Math.round(r.cents) }));
  if (rates.some((r) => !Number.isFinite(r.cents) || r.cents < 0 || r.cents > 10_000_000)) throw new ConvexError("Check their rates.");
  return {
    name: clip(a.name, 120), email, roles, rates, basedIn: clip(a.basedIn, 80) || undefined, phone: clip(a.phone, 40) || undefined,
    portfolio: clip(a.portfolio, 300) || undefined, gear: a.gear ? [...new Set(a.gear.map((g) => clip(g, 40)).filter(Boolean))].slice(0, 30) : undefined, notes: clip(a.notes, 2000) || undefined,
  };
}

/** Pricing's subcontractor cost for a role ("Shooter" → the Shooter cost, per its kind's unit). */
export function pricingCost(r: Rates | undefined, role: string): { cents: number; unit: "day" | "hour"; name: string } | null {
  if (!r) return null;
  const c = r.costs.find((x) => x.name.trim().toLowerCase() === role.trim().toLowerCase());
  if (!c) return null;
  const kind = r.kinds.find((k) => k.id === c.kindId);
  return { cents: c.cents, unit: kind?.unit ?? "hour", name: c.name };
}
const status = (x: Doc<"vendors">) => (x.joinedAt ? "in the portal" : x.invitedAt ? `invited ${new Date(x.invitedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "not invited");

export const list = query({
  args: {},
  handler: async (ctx) => {
    await ownerBiz(ctx);
    const rows = (await ctx.db.query("vendors").collect()).filter((x) => !x.archivedAt).sort((a, b) => a.name.localeCompare(b.name));
    return rows.map((x) => ({ _id: x._id, name: x.name, roles: x.roles, basedIn: x.basedIn ?? null, portal: status(x), w9: !!x.w9, paidThisYearCents: 0 }));
  },
});

export const get = query({
  args: { vendorId: v.string() },
  handler: async (ctx, { vendorId }) => {
    const b = await ownerBiz(ctx);
    const id = ctx.db.normalizeId("vendors", vendorId);
    const x = id ? await ctx.db.get(id) : null;
    if (!x) return null;
    const rates = await ratesOf(ctx, b);
    return {
      ...x, portal: status(x), w9: x.w9 ? { name: x.w9.name, uploadedAt: x.w9.uploadedAt, url: await ctx.storage.getUrl(x.w9.fileId) } : null,
      costs: x.roles.map((role) => ({ role, cost: pricingCost(rates, role) })),
      totals: { paidThisYearCents: 0, approvedCents: 0, approvedCount: 0, waitingCents: 0, waitingCount: 0 },
    };
  },
});

export const add = mutation({
  args: { ...detailsV, invite: v.boolean() },
  handler: async (ctx, a) => {
    await ownerBiz(ctx);
    const d = clean(a);
    const dup = (await ctx.db.query("vendors").withIndex("by_email", (q) => q.eq("email", d.email)).collect()).find((x) => !x.archivedAt);
    if (dup) throw new ConvexError(`${dup.name} is already a vendor with that email.`);
    const now = Date.now();
    // The invite email and the vendor's login arrive with the vendor portal (Phase 3c step 4); asking now records it.
    return ctx.db.insert("vendors", { ...d, ...(a.invite ? { invitedAt: now } : {}), createdAt: now, updatedAt: now });
  },
});

export const update = mutation({
  args: { vendorId: v.id("vendors"), ...detailsV },
  handler: async (ctx, { vendorId, ...a }) => {
    await ownerBiz(ctx);
    const x = await ctx.db.get(vendorId);
    if (!x) throw new ConvexError("That vendor isn't here.");
    const d = clean(a);
    if (d.email !== x.email && (await ctx.db.query("vendors").withIndex("by_email", (q) => q.eq("email", d.email)).collect()).some((y) => y._id !== x._id && !y.archivedAt)) throw new ConvexError("Another vendor has that email.");
    await ctx.db.patch(vendorId, { ...d, updatedAt: Date.now() });
    return null;
  },
});

/** Take a vendor off the list (their bookings, invoices and 1099 totals stay). */
export const archive = mutation({
  args: { vendorId: v.id("vendors"), archived: v.boolean() },
  handler: async (ctx, { vendorId, archived }) => {
    await ownerBiz(ctx);
    if (!(await ctx.db.get(vendorId))) throw new ConvexError("That vendor isn't here.");
    await ctx.db.patch(vendorId, { archivedAt: archived ? Date.now() : undefined, updatedAt: Date.now() });
    return null;
  },
});
