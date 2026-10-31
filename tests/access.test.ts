// Client side C1 (Oct 23): the access matrix. Every public function the site has is called as nobody, as a
// stranger with an account, and as an invited client. All of them must be refused, except the few that are meant
// to answer (listed in OPEN / SIGNED_IN below). The list of functions is read from the generated API, so a new
// function can't slip through without being classified here.
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const modules = import.meta.glob("../convex/**/*.ts");

beforeAll(async () => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.DROPBOX_APP_KEY = "test-key";
  process.env.DROPBOX_APP_SECRET = "test-secret";
  process.env.BUNNY_STREAM_LIBRARY_ID = "785477";
  process.env.BUNNY_STREAM_API_KEY = "bunny-test";
  process.env.RESEND_API_KEY = "re_test";
  process.env.SITE_URL = "https://review.wranglerportal.com";
  process.env.CONVEX_SITE_URL = "https://handsome-hummingbird-11.convex.site";
  // Convex Auth mints a JWT once a code is accepted; a throwaway RSA pair made here, never a real key.
  const { generateKeyPairSync } = await import("node:crypto");
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.JWT_PRIVATE_KEY = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const jwk = pair.publicKey.export({ format: "jwk" });
  process.env.JWKS = JSON.stringify({ keys: [{ use: "sig", alg: "RS256", ...jwk }] });
});
afterEach(() => vi.unstubAllGlobals());

// Functions anyone may call, and why.
const OPEN: Record<string, string> = {
  "users.me": "returns the caller's own identity, or null",
  "phase0.saveRun": "lab test log: append-only, capped, holds no client data",
  "shares.open": "a share link: answers by the share's own gate (off/expired/passcode/invited), tested in shares.test.ts",
  "shares.touch": "records an open on a share link: same gate; a missing token records nothing",
  "shares.unlock": "the passcode box on a share link: rate-limited; a missing token answers 'missing'",
  "clients.canSignUp": "the sign-up page's pre-check: says only whether an email is invited",
  "prefs.mine": "the owner's display settings: the video page asks whoever is looking; anyone but the owner gets {}",
  // Phase 2 Part B step 3: the invoice link (/i/<token>) from email 08 works without an account, like a share link.
  "invoicePay.page": "an invoice link: answers only for a sent invoice's own long random token (tested in invoicePay.test.ts)",
  "invoicePay.markViewed": "the same link: records the first view of that invoice only; a missing token does nothing",
  "quotes.page": "a quote link (Phase 3b, D81): answers only for a sent quote's own long random token (tested in crm.test.ts)",
  "quotes.markViewed": "the same link: records the first view of that quote only; a missing token does nothing",
  "proposals.page": "a proposal link (Phase 3b, D73): answers only for a sent proposal's own long random token (tested in proposals.test.ts)",
  "proposals.markViewed": "the same link: records the first view of that proposal only; a missing token does nothing",
  "invoicePay.start": "Pay on the same link: returns Stripe's payment secret for that invoice only; a missing token is refused",
  "invoicePay.refresh": "the same link: re-reads that invoice from Stripe; a missing token does nothing",
  "invoicePay.mine": "a client's invoices, found by their own email; anyone else gets []",
  // Phase 2b: the subscription link (/sub/<token>) from email 13 works without an account, like the invoice link.
  "subscriptions.page": "a subscription link: answers only for that subscription's own long random token (tested in subscriptions.test.ts)",
  "subscriptions.setupStart": "the same link: a SetupIntent for that subscription's customer only; a missing token is refused",
  "subscriptions.setupDone": "the same link: checks the SetupIntent is that subscription's own before using it; a missing token is refused",
  "subscriptions.mine": "a client's subscriptions, found by their own email; anyone else gets []",
};
// Functions with their own gate (a key in the arguments): refused with the wrong key, whoever calls.
const KEYED = new Set(["r1results.report"]);
// Functions any signed-in account may call (owner or client), never a stranger.
const SIGNED_IN = new Set(["users.setName", "clients.account", "shares.mine",
  // Phase 1: a client's own Inbox, Documents and their businesses' look
  "inbox.mine", "inbox.unreadCount", "inbox.markRead", "inbox.markAllRead", "documents.mine", "business.brand",
  "portal.waiting", "emails.myPrefs", "emails.setMine",
  // Phase 2 Part A: a client's projects (only those their share invites cover) and the final files' links (only once open)
  "projects.mine", "projects.forClient", "projects.deliveryLink"]);

import { argsFor, call, publicFunctions, setup } from "./matrix";
const denied = (e: unknown) => /Sign in first|Not allowed/.test(String((e as Error).message ?? e));

describe("access matrix", () => {
  test("every public function is classified", async () => {
    const { ids } = await setup();
    const table = argsFor(ids);
    const missing = publicFunctions().map((f) => f.key).filter((k) => !(k in table));
    expect(missing).toEqual([]);
  });

  for (const who of ["nobody", "stranger", "client"] as const) {
    test(`${who}: every function refuses, except the ones meant to answer`, async () => {
      const { t, ids } = await setup();
      vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 })); // nothing external may be reached
      const as = who === "nobody" ? t : t.withIdentity({ subject: who === "stranger" ? ids.strangerSub : ids.clientSub });
      const table = argsFor(ids);
      const results: Record<string, string> = {};
      for (const f of publicFunctions()) {
        const allowed = f.key in OPEN || (who === "client" && SIGNED_IN.has(f.key));
        if (KEYED.has(f.key)) { await expect(call(as, f.ref, table[f.key], "")).rejects.toThrow(/Not allowed/); results[f.key] = "denied (own key)"; continue; }
        try {
          await call(as, f.ref, table[f.key], "");
          results[f.key] = allowed ? "answered (expected)" : "ANSWERED";
        } catch (e) {
          if (denied(e)) results[f.key] = allowed ? `DENIED: ${(e as Error).message}` : "denied";
          else results[f.key] = allowed ? "answered (expected, other error)" : `OTHER: ${String((e as Error).message).slice(0, 80)}`;
        }
      }
      const bad = Object.entries(results).filter(([, r]) => /^(ANSWERED|DENIED|OTHER)/.test(r));
      expect(bad).toEqual([]);
      // r1results.report with a wrong key is refused by its own check, with a different message.
      expect(results["users.me"]).toMatch(/answered/);
    });
  }

  test("the owner is not refused", async () => {
    const { t, ids } = await setup();
    const me = t.withIdentity({ subject: ids.ownerSub });
    expect(await me.query(api.library.overview, {})).toBeTruthy();
    expect((await me.query(api.users.me, {}))?.role).toBe("owner");
    expect(await me.query(api.clients.listInvites, {})).toHaveLength(1);
  });

  test("a client sees their own identity and account, and nothing else", async () => {
    const { t, ids } = await setup();
    const c = t.withIdentity({ subject: ids.clientSub });
    expect((await c.query(api.users.me, {}))).toMatchObject({ role: "client", allowed: false });
    expect(await c.query(api.clients.account, {})).toMatchObject({ kind: "client", email: "client@example.com" });
    await c.mutation(api.users.setName, { name: "Casey" });
    expect((await c.query(api.clients.account, {})).name).toBe("Casey");
    await expect(c.query(api.library.overview, {})).rejects.toThrow(/Not allowed/);
    // The video page asks for the owner's display settings whoever is looking: a client (or a guest) gets {} back.
    expect(await c.query(api.prefs.mine, {})).toEqual({});
    expect(await t.query(api.prefs.mine, {})).toEqual({});
    await expect(c.mutation(api.prefs.set, { key: "details", value: [] })).rejects.toThrow(/Not allowed/);
  });
});

describe("who may make an account", () => {
  const signUp = (t: ReturnType<typeof convexTest>, email: string) =>
    t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email, password: "longenoughpassword" } });

  test("an owner email and an invited email can; anyone else is refused; a code email goes out through Resend", async () => {
    const { t, ids } = await setup();
    const sent: string[] = [];
    const mails: Array<{ to: string; subject: string; text: string; from: string; html: string }> = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); sent.push(b.to[0]); mails.push({ to: b.to[0], subject: b.subject, text: b.text, from: b.from, html: b.html }); return new Response(JSON.stringify({ id: "em_1" }), { status: 200 }); }
      return new Response("{}", { status: 500 });
    });
    const lastCode = () => /\b(\d{6})\b/.exec(mails[mails.length - 1].text)![1];
    await expect(signUp(t, "intruder@example.com")).rejects.toThrow(/hasn't been invited/);
    await t.withIdentity({ subject: ids.ownerSub }).mutation(api.clients.invite, { email: "New.Client@Example.com", name: "New Client" });
    const r = await signUp(t, "new.client@example.com") as { tokens?: unknown; started?: boolean };
    expect(r.tokens ?? null).toBeNull(); // no session yet: a code is needed first
    expect(sent).toEqual(["new.client@example.com"]);
    const user = await t.run(async (ctx) => (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", "new.client@example.com")).unique()));
    expect(user).toMatchObject({ role: "client", name: "New Client" });
    const inv = await t.run(async (ctx) => (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", "new.client@example.com")).unique()));
    expect(inv?.acceptedAt).toBeTypeOf("number");
    expect(mails[0]).toMatchObject({ from: "Wrangler Productions <review@wranglerportal.com>" });
    expect(mails[0].html).toContain('<meta name="color-scheme" content="dark">');
    expect(mails[0].subject).toMatch(/^\d{6} is your WranglerPortal code$/);
    // A wrong code is refused; the emailed one signs them in.
    await expect(t.action(api.auth.signIn, { provider: "password", params: { flow: "email-verification", email: "new.client@example.com", code: "000000" } })).rejects.toThrow();
    const done = await t.action(api.auth.signIn, { provider: "password", params: { flow: "email-verification", email: "new.client@example.com", code: lastCode() } }) as { tokens?: unknown };
    expect(done.tokens).toBeTruthy();
    // Password reset: a code by email, then a new password that signs in; the old one no longer does.
    await t.action(api.auth.signIn, { provider: "password", params: { flow: "reset", email: "new.client@example.com" } });
    expect(mails[mails.length - 1].subject).toBe("Reset your WranglerPortal password");
    const reset = await t.action(api.auth.signIn, { provider: "password", params: { flow: "reset-verification", email: "new.client@example.com", code: lastCode(), newPassword: "anotherlongpassword" } }) as { tokens?: unknown };
    expect(reset.tokens).toBeTruthy();
    await expect(t.action(api.auth.signIn, { provider: "password", params: { flow: "signIn", email: "new.client@example.com", password: "longenoughpassword" } })).rejects.toThrow();
    const back = await t.action(api.auth.signIn, { provider: "password", params: { flow: "signIn", email: "new.client@example.com", password: "anotherlongpassword" } }) as { tokens?: unknown };
    expect(back.tokens).toBeTruthy();
    // A revoked invite can't be used.
    await t.withIdentity({ subject: ids.ownerSub }).mutation(api.clients.revokeInvite, { inviteId: ids.inviteId });
    await t.run(async (ctx) => { for (const u of await ctx.db.query("users").collect()) if (u.email === "client@example.com") await ctx.db.delete(u._id); });
    await expect(signUp(t, "client@example.com")).rejects.toThrow(/hasn't been invited/);
    // An owner's email is fine, and the owner can't be "invited".
    const o = await signUp(t, "heston@wranglerproductions.com").catch((e: Error) => e);
    expect(o instanceof Error ? o.message : "ok").not.toMatch(/hasn't been invited/);
    await expect(t.withIdentity({ subject: ids.ownerSub }).mutation(api.clients.invite, { email: "heston@wranglerproductions.com" })).rejects.toThrow(/owner/);
  }, 30_000);
});
