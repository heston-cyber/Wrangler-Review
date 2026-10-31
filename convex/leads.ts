// Phase 3 (Oct 31), step 7: leads from the new website's quote form. Webflow sends each form submission here
// (POST /leads/webflow), signed with the webhook's secret (x-webflow-timestamp + x-webflow-signature = HMAC-SHA256 of
// "timestamp:body"). A real-looking submission becomes a Lead card; spam is dropped first. Switched off until
// WEBFLOW_WEBHOOK_SECRET is set (D29: the form isn't built yet). The company and contact are made at the first
// estimate (D56), not here.
import { httpAction } from "./_generated/server";
import { internalMutation } from "./lib/functions";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { defaultBusiness } from "./lib/business";

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function webflowSignatureOk(body: string, timestamp: string | null, signature: string | null, secret: string, now = Date.now()) {
  if (!timestamp || !signature) return false;
  const t = Number(timestamp);
  if (!Number.isFinite(t) || Math.abs(now - t) > 5 * 60_000) return false; // a captured request can't be replayed later
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const want = hex(await crypto.subtle.sign("HMAC", k, enc.encode(`${timestamp}:${body}`)));
  if (want.length !== signature.length) return false;
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ signature.charCodeAt(i);
  return d === 0;
}

const pick = (data: Record<string, unknown>, ...names: string[]) => {
  for (const [k, val] of Object.entries(data)) if (names.some((n) => k.toLowerCase().replace(/[^a-z]/g, "") === n)) return String(val ?? "").trim();
  return "";
};

/** Spam is dropped before a card is made: a filled honeypot, no real email, link-stuffed text, or a repeat.
 *  The honeypot is a hidden field named "hp" (or honeypot, _gotcha, bot-field) on the new site's form (D29); a
 *  real "Website" field is kept as a lead detail (review, Oct 31). */
export function looksLikeSpam(data: Record<string, unknown>) {
  if (pick(data, "hp", "honeypot", "gotcha", "botfield")) return "honeypot";
  const email = pick(data, "email", "emailaddress");
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return "no email";
  const text = Object.values(data).map((x) => String(x ?? "")).join(" ");
  if ((text.match(/https?:\/\//gi) ?? []).length > 2) return "links";
  if (/\b(viagra|casino|crypto ?invest|seo services|backlinks)\b/i.test(text)) return "words";
  return null;
}

export const fromWebsite = internalMutation({
  args: { data: v.any(), submissionId: v.optional(v.string()) },
  handler: async (ctx, { data, submissionId }) => {
    const d = (data ?? {}) as Record<string, unknown>;
    if (looksLikeSpam(d)) return null;
    const email = pick(d, "email", "emailaddress").toLowerCase();
    const name = pick(d, "name", "fullname", "yourname") || email;
    const company = pick(d, "company", "business", "companyname", "organization");
    const now = Date.now();
    // A double submit (the same submission, or the same person sending the same message within 10 minutes) is one
    // lead; a different message from the same person is a new one.
    const message = pick(d, "message", "details", "project").slice(0, 3000);
    const all = await ctx.db.query("deals").collect();
    if (submissionId && all.some((x) => x.history.some((h) => h.kind === "website" && h.detail === submissionId))) return null;
    const recent = all.find((x) => x.lead?.email === email && (x.lead?.message ?? "") === message && now - x.createdAt < 10 * 60_000);
    if (recent) return recent._id;
    const biz = await defaultBusiness(ctx);
    const known = new Set(["name", "fullname", "yourname", "email", "emailaddress", "company", "business", "companyname", "organization", "phone", "phonenumber", "message", "details", "project"]);
    return await ctx.db.insert("deals", {
      ...(biz ? { businessId: biz._id } : {}), title: (company || name).slice(0, 160), stage: "lead", source: "website", contactEmail: email,
      lead: { name: name.slice(0, 120), email, ...(company ? { company: company.slice(0, 120) } : {}), ...(pick(d, "phone", "phonenumber") ? { phone: pick(d, "phone", "phonenumber").slice(0, 40) } : {}),
        ...(pick(d, "message", "details", "project") ? { message: pick(d, "message", "details", "project").slice(0, 3000) } : {}),
        fields: Object.entries(d).filter(([k]) => !known.has(k.toLowerCase().replace(/[^a-z]/g, ""))).slice(0, 30).map(([k, val]) => ({ label: k.slice(0, 80), value: String(val ?? "").slice(0, 1000) })), at: now },
      history: [{ kind: "website", at: now, ...(submissionId ? { detail: submissionId } : {}) }], createdAt: now, updatedAt: now,
    });
  },
});

/** POST /leads/webflow */
export const webflow = httpAction(async (ctx, req) => {
  const secret = process.env.WEBFLOW_WEBHOOK_SECRET;
  if (!secret) return new Response("not switched on", { status: 404 });
  const body = await req.text();
  if (!(await webflowSignatureOk(body, req.headers.get("x-webflow-timestamp"), req.headers.get("x-webflow-signature"), secret))) return new Response("bad signature", { status: 400 });
  let j: { triggerType?: string; payload?: { data?: Record<string, unknown>; id?: string; formId?: string; name?: string } };
  try { j = JSON.parse(body); } catch { return new Response("bad body", { status: 400 }); }
  if (j.triggerType && j.triggerType !== "form_submission") return new Response("ignored", { status: 200 });
  const only = process.env.WEBFLOW_FORM_NAME; // when set, other forms on the site are ignored
  if (only && j.payload?.name !== only) return new Response("ignored", { status: 200 });
  await ctx.runMutation(internal.leads.fromWebsite, { data: j.payload?.data ?? {}, submissionId: j.payload?.id });
  return new Response("ok", { status: 200 });
});
