// C5 (Oct 24): what the pages ask the server, asked the same way through the real backend, as everyone who can be
// looking. The mock harness stubbed prefs.mine, so a client opening a shared video hit its owner-only check for the
// first time on a phone. This suite reads the site's useQuery calls from the source, so a new one must be classified
// here (which pages fire it, with what arguments) before the suite passes, and then fires every page's set as a
// guest on a comment link, a guest on a view link, a guest on a passcode link, an invited client, a signed-in client
// with no share (their home), and a stranger on the sign-in page. Nothing a page fires on load may refuse.
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.SITE_URL = "https://review.wranglerportal.com";
  process.env.BUNNY_STILLS_CDN = "wrangler-review-stills.b-cdn.net";
  process.env.BUNNY_SCRUB_CDN = "vz-scrub.b-cdn.net";
});
afterEach(() => vi.unstubAllGlobals());

// Every useQuery(api.x.y …) in src/, by file.
function queriesInSource(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.tsx?$/.test(name)) continue;
      for (const m of readFileSync(p, "utf8").matchAll(/useQuery\(api\.([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)/g)) {
        const key = `${m[1]}.${m[2]}`;
        if (!out.has(key)) out.set(key, new Set());
        out.get(key)!.add(p.replace(/^.*\/src\//, "src/"));
      }
    }
  };
  walk(join(__dirname, "..", "src"));
  return out;
}

type Share = { token: string; passcode?: string; guestKey?: string; guestName?: string };
type Ids = { videoId: Id<"videos">; versionId: Id<"versions">; projectId?: Id<"projects"> };
// Which page fires each query, and how. "owner" pages never render for a client or a guest (App.tsx routes them to
// ClientHome or the share page), so their queries aren't fired for them; the access suite covers their refusals.
type Page = "video" | "share" | "clientHome" | "signin" | "owner";
const PAGES: Record<string, { pages: Page[]; args: (ids: Ids, share: Share | null) => Record<string, unknown> | "skip" }> = {
  "users.me": { pages: ["video", "share", "clientHome", "signin"], args: () => ({}) },
  "shares.open": { pages: ["share"], args: (_i, s) => (s ? { token: s.token, passcode: s.passcode } : "skip") },
  "shares.mine": { pages: ["clientHome"], args: () => ({}) },
  // The portal shell (Phase 1): the business's look for everyone signed in, and the client's Inbox badge.
  "business.brand": { pages: ["clientHome"], args: () => ({}) },
  "inbox.unreadCount": { pages: ["clientHome"], args: () => ({}) },
  "inbox.mine": { pages: ["clientHome"], args: () => ({ limit: 3 }) }, // client Home and Inbox
  "portal.waiting": { pages: ["clientHome"], args: () => ({}) },
  // Phase 2 Part A: the client's projects (Home's card, the Review layer) and one project's page (null for anyone else).
  "projects.mine": { pages: ["clientHome"], args: () => ({}) },
  // Phase 2 Part B step 3: a client's invoices (Home's To pay rows, the Payments menu) and the invoice link's page.
  "invoicePay.mine": { pages: ["clientHome"], args: () => ({}) },
  "invoicePay.page": { pages: ["share"], args: () => ({ token: "not-a-real-token-xx" }) },
  "projects.forClient": { pages: ["clientHome"], args: (i) => ({ projectId: i.projectId ?? "nope" }) },
  "projects.page": { pages: ["owner"], args: () => "skip" }, // the owner's project page
  "documents.mine": { pages: ["clientHome"], args: () => ({}) },
  "emails.myPrefs": { pages: ["clientHome"], args: () => ({}) }, // client Settings
  "library.video": { pages: ["video"], args: (i, s) => ({ videoId: i.videoId, share: s ?? undefined }) },
  "notes.forVersion": { pages: ["video"], args: (i, s) => ({ versionId: i.versionId, share: s ?? undefined }) },
  "waveforms.forVersion": { pages: ["video"], args: (i, s) => ({ versionId: i.versionId, share: s ?? undefined }) },
  "transcripts.forVersion": { pages: ["video"], args: (i, s) => ({ versionId: i.versionId, share: s ?? undefined }) },
  "prefs.mine": { pages: ["video"], args: () => ({}) },
  "shares.coveringVideo": { pages: ["owner"], args: () => "skip" }, // VideoPage skips it unless the owner is looking
  "views.forVideo": { pages: ["owner"], args: () => "skip" }, // the Views chip only renders for the owner
  "library.overview": { pages: ["owner"], args: () => "skip" },
  "approvals.forVideo": { pages: ["video"], args: (i, s) => ({ videoId: i.videoId, share: s ?? undefined }) }, // client approval (Phase 1)
  "business.settings": { pages: ["owner"], args: () => "skip" }, // Settings › Business (owner only)
  "payments.settings": { pages: ["owner"], args: () => "skip" }, // Settings › Payments (owner only)
  "invoices.list": { pages: ["owner"], args: () => "skip" }, // Payments › Invoices
  "invoices.overview": { pages: ["owner"], args: () => "skip" }, // Payments › Overview
  "plans.list": { pages: ["owner"], args: () => "skip" }, // Payments › Plans
  "subscriptions.list": { pages: ["owner"], args: () => "skip" }, // Payments › Subscriptions
  "subscriptions.failRules": { pages: ["owner"], args: () => "skip" }, // Settings › Payments and a client's Settings tab (D64)
  // Phase 3: the CRM, estimates and the job ledger (back office only, T3.5).
  "crm.board": { pages: ["owner"], args: () => "skip" }, // Clients › Pipeline
  "crm.companies": { pages: ["owner"], args: () => "skip" }, // Add lead's company picker
  "crm.company": { pages: ["owner"], args: () => "skip" }, // the company page, an estimate for a company
  "crm.contact": { pages: ["owner"], args: () => "skip" }, // a contact's page
  "crm.deal": { pages: ["owner"], args: () => "skip" }, // a pipeline card's page, an estimate for a card
  "crm.due": { pages: ["owner"], args: () => "skip" }, // owner Home: follow-ups due
  "crm.followUps": { pages: ["owner"], args: () => "skip" }, // Clients › Follow-ups
  "crm.getEstimate": { pages: ["owner"], args: () => "skip" }, // an estimate
  "crm.ledger": { pages: ["owner"], args: () => "skip" }, // a project's Ledger tab
  "crm.rates": { pages: ["owner"], args: () => "skip" }, // Settings › Estimate rates, the estimate page
  "quotes.list": { pages: ["owner"], args: () => "skip" }, // Payments › Quotes
  "quotes.get": { pages: ["owner"], args: () => "skip" }, // a quote
  "quotes.options": { pages: ["owner"], args: () => "skip" }, // New quote's client picker
  "quotes.page": { pages: ["share"], args: () => ({ token: "x".repeat(24) }) }, // /q/<token>, no account (D81)
  "proposals.list": { pages: ["owner"], args: () => "skip" }, // Proposals › All proposals
  "proposals.get": { pages: ["owner"], args: () => "skip" }, // a proposal in the builder
  "proposals.templates": { pages: ["owner"], args: () => "skip" }, // Proposals › Templates, New proposal
  "proposals.questionnaire": { pages: ["owner"], args: () => "skip" }, // the questionnaire, its editor, the waiting page
  "proposals.fileUrls": { pages: ["owner"], args: () => "skip" }, // the questionnaire's uploaded files
  "proposals.forCompany": { pages: ["owner"], args: () => "skip" }, // the company page's Proposals and quotes
  "vendors.list": { pages: ["owner"], args: () => "skip" }, // Vendors › All vendors
  "vendors.get": { pages: ["owner"], args: () => "skip" }, // a vendor page
  "proposals.page": { pages: ["share"], args: () => ({ token: "x".repeat(24) }) }, // /p/<token>, no account (D73)
  "brandKit.get": { pages: ["owner"], args: () => "skip" }, // Settings › Brand kit, a company's Brand kit tab (Phase 3b)
  "subscriptions.get": { pages: ["owner"], args: () => "skip" }, // a subscription
  "subscriptions.page": { pages: ["share"], args: () => ({ token: "not-a-real-token-xx" }) }, // /sub/<token>, the client's page (with or without an account)
  "subscriptions.mine": { pages: ["clientHome"], args: () => ({}) }, // the client's Payments › Subscriptions
  "plans.get": { pages: ["owner"], args: () => "skip" }, // a plan
  "invoices.forProject": { pages: ["owner"], args: () => "skip" }, // project page › Invoices
  "invoices.finalOptions": { pages: ["owner"], args: () => "skip" }, // project page › Invoices (final from a contract)
  "invoices.get": { pages: ["owner"], args: () => "skip" }, // one invoice
  "invoices.options": { pages: ["owner"], args: () => "skip" }, // New invoice
  "activity.feed": { pages: ["owner"], args: () => "skip" },
  "activity.recent": { pages: ["owner"], args: () => "skip" }, // back-office Home
  "home.needs": { pages: ["owner"], args: () => "skip" }, // back-office Home
  "clients.directory": { pages: ["owner"], args: () => "skip" }, // Home and Clients
  "clients.page": { pages: ["owner"], args: () => "skip" }, // client page
  "inbox.forClient": { pages: ["owner"], args: () => "skip" }, // client page › Their Inbox
  "inbox.noteDetail": { pages: ["owner"], args: () => "skip" }, // Post a note, Sent › note
  "inbox.noteRecipients": { pages: ["owner"], args: () => "skip" }, // Post a note
  "inbox.sent": { pages: ["owner"], args: () => "skip" }, // Sent
  "clients.listInvites": { pages: ["owner"], args: () => "skip" },
  "dropbox.status": { pages: ["owner"], args: () => "skip" },
  "dropbox.flagged": { pages: ["owner"], args: () => "skip" },
  "connector.listKeys": { pages: ["owner"], args: () => "skip" },
  "register.sheetKey": { pages: ["owner"], args: () => "skip" },
  "shares.list": { pages: ["owner"], args: () => "skip" },
  "shares.activity": { pages: ["owner"], args: () => "skip" },
  "shares.forTarget": { pages: ["owner"], args: () => "skip" },
  // Wrangler Sign (S1): the Contracts pages only render for the owner; the signing page (S2) uses plain HTTP requests, not queries.
  "sign.list": { pages: ["owner"], args: () => "skip" },
  "wsArchive.status": { pages: ["owner"], args: () => "skip" },
  "wsConnector.listKeys": { pages: ["owner"], args: () => "skip" },
  "sign.get": { pages: ["owner"], args: () => "skip" },
  "sign.ownerSignature": { pages: ["owner"], args: () => "skip" },
  "sign.requestsFor": { pages: ["owner"], args: () => "skip" },
  "sign.pendingRequests": { pages: ["owner"], args: () => "skip" },
  // The doc builder (B1–B3): owner-only pages.
  "builder.fileUrls": { pages: ["owner"], args: () => "skip" },
  "builder.getBuild": { pages: ["owner"], args: () => "skip" },
  "builder.getProfile": { pages: ["owner"], args: () => "skip" },
  "builder.getTemplate": { pages: ["owner"], args: () => "skip" },
  "builder.listBuilds": { pages: ["owner"], args: () => "skip" },
  "builder.listClauses": { pages: ["owner"], args: () => "skip" },
  "builder.listFonts": { pages: ["owner"], args: () => "skip" },
  "builder.listStyles": { pages: ["owner"], args: () => "skip" },
  "builder.listTemplates": { pages: ["owner"], args: () => "skip" },
};

async function setup() {
  const t = convexTest(schema, modules);
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
  const ids = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    const client = await ctx.db.insert("users", { email: "john@example.com", name: "John", role: "client" });
    await ctx.db.insert("invites", { email: "john@example.com", createdAt: 0, acceptedAt: 0, userId: client });
    const stranger = await ctx.db.insert("users", { email: "nobody@example.com", name: "Nobody" });
    const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", { name: "Arizona", jobNumber: "26210", client: "4M LC", createdAt: now });
    const videoId = await ctx.db.insert("videos", { projectId, title: "LC Arizona", createdAt: now, updatedAt: now });
    const versionId = await ctx.db.insert("versions", { videoId, number: 1, status: "ready", bunnyGuid: "guid-1", fileName: "00001_LCArizona_v1.mp4", startTimecode: "01:00:00:00", createdAt: now, frameCount: 480, mp4Heights: [360, 1080, 2160], fpsNum: 24000, fpsDen: 1001 } as never);
    await ctx.db.insert("notes", { versionId, videoId, kind: "frame", inFrame: 10, text: "shared", status: "open", authorName: "Heston", authorId: owner, visibility: "shared", createdAt: now, updatedAt: now } as never);
    await ctx.db.insert("transcripts", { versionId, status: "done", wordCount: 3, attempts: 1, updatedAt: now });
    await ctx.db.insert("waveforms", { versionId, status: "done", rate: 20, seconds: 4, peaks: new Uint8Array([1, 2, 3]).buffer, attempts: 1, updatedAt: now });
    return { projectId, videoId, versionId, ownerSub: await sess(owner), clientSub: await sess(client), strangerSub: await sess(stranger) };
  });
  const me = t.withIdentity({ subject: ids.ownerSub });
  const base = { allVersions: true, downloads: true, emailNewVersions: false };
  const comment = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.videoId }, ...base, access: "comment", who: "link" });
  const view = await me.mutation(api.shares.create, { target: { kind: "project", projectId: ids.projectId }, ...base, access: "view", who: "link" });
  const pass = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.videoId }, ...base, access: "comment", who: "link", passcode: "coffeecup" });
  const invited = await me.mutation(api.shares.create, { target: { kind: "client", client: "4M LC" }, ...base, access: "comment", who: "invited", emails: ["john@example.com"] });
  const proof = await t.mutation(api.shares.unlock, { token: pass.token, passcode: "coffeecup" });
  return { t, ids, me, comment, view, pass: { token: pass.token, proof: (proof as { proof?: string }).proof! }, invited, client: t.withIdentity({ subject: ids.clientSub }), stranger: t.withIdentity({ subject: ids.strangerSub }) };
}

function callOf(as: ReturnType<typeof convexTest>, key: string) {
  const [mod, fn] = key.split(".");
  const ref = (api as unknown as Record<string, Record<string, unknown>>)[mod]?.[fn];
  if (!ref) throw new Error(`no such function ${key}`);
  return (args: Record<string, unknown>) => as.query(ref as never, args as never);
}

describe("every query the pages fire answers for everyone who can see the page", () => {
  test("every useQuery in src/ is classified here", () => {
    const found = [...queriesInSource().keys()].sort();
    const missing = found.filter((k) => !(k in PAGES));
    const stale = Object.keys(PAGES).filter((k) => !queriesInSource().has(k));
    expect({ missing, stale }).toEqual({ missing: [], stale: [] });
  });

  type Case = { name: string; pages: Page[]; as: (s: Awaited<ReturnType<typeof setup>>) => ReturnType<typeof convexTest>; share: (s: Awaited<ReturnType<typeof setup>>) => Share | null };
  const guest = (token: string, passcode?: string): Share => ({ token, passcode, guestKey: "gk-pat", guestName: "Pat" });
  const CASES: Case[] = [
    { name: "a guest on a comment link (video page)", pages: ["share", "video"], as: (s) => s.t, share: (s) => guest(s.comment.token) },
    { name: "a guest on a view-only project link (list, then video page)", pages: ["share", "video"], as: (s) => s.t, share: (s) => guest(s.view.token) },
    { name: "a guest on a passcode link, after the passcode (video page)", pages: ["share", "video"], as: (s) => s.t, share: (s) => guest(s.pass.token, s.pass.proof) },
    { name: "an invited client on their client link (list, then video page)", pages: ["share", "video"], as: (s) => s.client, share: (s) => ({ token: s.invited.token }) },
    { name: "a signed-in client on the site itself (their home)", pages: ["clientHome"], as: (s) => s.client, share: () => null },
    { name: "a stranger who signed up but isn't invited (sign-in / not-allowed page)", pages: ["signin"], as: (s) => s.stranger, share: () => null },
    { name: "someone not signed in on the site itself (sign-in page)", pages: ["signin"], as: (s) => s.t, share: () => null },
  ];

  for (const c of CASES) {
    test(c.name, async () => {
      const s = await setup();
      const as = c.as(s);
      const share = c.share(s);
      const refused: string[] = [];
      for (const [key, spec] of Object.entries(PAGES)) {
        if (!spec.pages.some((p) => c.pages.includes(p))) continue;
        const args = spec.args(s.ids, share);
        if (args === "skip") continue;
        try { await callOf(as, key)(args); }
        catch (e) { refused.push(`${key}: ${(e as Error).message.slice(0, 100)}`); }
      }
      expect(refused).toEqual([]);
    });
  }

  test("the share page's own answer is 'ok' for each of those links", async () => {
    const s = await setup();
    expect((await s.t.query(api.shares.open, { token: s.comment.token })).state).toBe("ok");
    expect((await s.t.query(api.shares.open, { token: s.view.token })).state).toBe("ok");
    expect((await s.t.query(api.shares.open, { token: s.pass.token, passcode: s.pass.proof })).state).toBe("ok");
    expect((await s.t.query(api.shares.open, { token: s.pass.token })).state).toBe("passcode");
    expect((await s.client.query(api.shares.open, { token: s.invited.token })).state).toBe("ok");
    expect((await s.t.query(api.shares.open, { token: s.invited.token })).state).toBe("signin");
    // An account that isn't a client (signed up, never invited) is asked to sign in with the invited email.
    expect((await s.stranger.query(api.shares.open, { token: s.invited.token })).state).toBe("signin");
  });
});
