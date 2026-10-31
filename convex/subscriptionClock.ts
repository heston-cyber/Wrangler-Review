// Phase 2b, T2b.1–T2b.5 on the real Stripe sandbox: a check run by hand from the Convex dashboard on the DEV
// deployment (Functions › subscriptionClock:clockCheck › Run). It refuses a live key.
//
// Stripe's test clocks fast-forward time for customers made on them. The check makes a throwaway plan, client and
// one test-clock customer per case on the business's connected SANDBOX account, runs each case through the portal's
// own code (subscriptionForm, applyStripe, importInvoice, the owner's pause/cancel calls), advances the clock, and
// reads the result back from Stripe and the portal. Then it deletes the clocks (Stripe removes their customers and
// subscriptions with them) and the portal's test rows. Emails go to clock-check addresses, which the preview holds.
import { internalAction, internalMutation, internalQuery } from "./lib/functions";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { keyMode, platformKey, stripeCall, type StripeResult } from "./lib/stripeApi";
import { subscriptionForm } from "./subscriptions";

const DAY = 86_400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const target = internalQuery({
  args: {},
  handler: async (ctx) => {
    const b = (await ctx.db.query("businesses").collect()).find((x) => x.stripe?.status === "connected" && !x.stripe.livemode);
    return b ? { businessId: b._id, accountId: b.stripe!.accountId } : null;
  },
});

export const setup = internalMutation({
  args: { businessId: v.id("businesses"), accountId: v.string(), productId: v.string(), priceId: v.string() },
  handler: async (ctx, a) => {
    const now = Date.now();
    const planId = await ctx.db.insert("plans", { businessId: a.businessId, name: "Clock check (test)", amountCents: 10000, interval: "month", intervalCount: 1, stripe: { accountId: a.accountId, productId: a.productId, priceId: a.priceId, livemode: false }, createdAt: now, updatedAt: now });
    const clientId = await ctx.db.insert("clients", { businessId: a.businessId, name: "Clock check (test)", createdAt: now });
    return { planId, clientId };
  },
});

export const row = internalQuery({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, { subscriptionId }) => {
    const s = await ctx.db.get(subscriptionId);
    if (!s) return null;
    const invoices = (await ctx.db.query("invoices").collect()).filter((i) => i.subscriptionId === subscriptionId).map((i) => ({ status: i.status, total: i.totalCents }));
    return { status: s.status, pause: !!s.pause, cancelAtPeriodEnd: !!s.cancelAtPeriodEnd, invoices };
  },
});

export const cleanup = internalMutation({
  args: { planId: v.id("plans"), clientId: v.id("clients") },
  handler: async (ctx, { planId, clientId }) => {
    for (const s of (await ctx.db.query("subscriptions").collect()).filter((x) => x.planId === planId)) {
      for (const i of (await ctx.db.query("invoices").collect()).filter((x) => x.subscriptionId === s._id)) await ctx.db.delete(i._id);
      for (const it of (await ctx.db.query("inboxItems").collect()).filter((x) => x.source.id === s._id)) await ctx.db.delete(it._id);
      await ctx.db.delete(s._id);
    }
    await ctx.db.delete(planId);
    await ctx.db.delete(clientId);
  },
});

type Result = { case: string; ok: boolean; detail: string };

export const clockCheck = internalAction({
  args: { keep: v.optional(v.boolean()) },
  handler: async (ctx, { keep }): Promise<Result[]> => {
    if (keyMode(platformKey()) !== "test") throw new Error("Refused: this check runs only with a Stripe test/sandbox key (the dev deployment).");
    const t = await ctx.runQuery(internal.subscriptionClock.target, {});
    if (!t) throw new Error("No business is connected to a sandbox Stripe account.");
    const account = t.accountId;
    const call = (m: "GET" | "POST" | "DELETE", p: string, form?: Record<string, unknown>) => stripeCall(m, p, { account, form });
    const product = await call("POST", "products", { name: "Clock check (test)" });
    const price = await call("POST", "prices", { product: product.id, currency: "usd", unit_amount: 10000, recurring: { interval: "month" } });
    const { planId, clientId } = await ctx.runMutation(internal.subscriptionClock.setup, { businessId: t.businessId, accountId: account, productId: String(product.id), priceId: String(price.id) });
    const clocks: string[] = [];
    const results: Result[] = [];

    const now = Math.floor(Date.now() / 1000);
    async function advance(clock: string, to: number) {
      await call("POST", `test_helpers/test_clocks/${clock}/advance`, { frozen_time: to });
      for (let i = 0; i < 60; i++) { await sleep(3000); if ((await call("GET", `test_helpers/test_clocks/${clock}`)).status === "ready") return; }
      throw new Error("The test clock didn't finish advancing in 3 minutes.");
    }
    /** A clock, a customer on it, a card attached, and the portal's row; then the subscription made the portal's way. */
    async function start(name: string, card: string, opts: { trialDays?: number } = {}) {
      const clock = (await call("POST", "test_helpers/test_clocks", { frozen_time: now, name: `Clock check · ${name}` })).id as string;
      clocks.push(clock);
      const email = `clock-check+${name}@example.com`;
      const cus = (await call("POST", "customers", { email, name: `Clock check ${name}`, test_clock: clock })).id as string;
      const pm = (await call("POST", `payment_methods/${card}/attach`, { customer: cus })).id as string;
      await call("POST", `customers/${cus}`, { invoice_settings: { default_payment_method: pm } });
      const today = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
      const id = await ctx.runMutation(internal.subscriptions.create, {
        businessId: t!.businessId, clientId, planId, billTo: { name: `Clock check ${name}`, email }, startDate: today, trialDays: opts.trialDays,
        firstInvoice: opts.trialDays ? "start" : "now", accountId: account, customerId: cus, livemode: false, postInbox: false, by: "Clock check",
      }) as Id<"subscriptions">;
      const row = await ctx.runQuery(internal.subscriptionClock.rowDoc, { subscriptionId: id });
      const sub = await call("POST", "subscriptions", subscriptionForm(row!, pm, String(product.id)));
      await ctx.runMutation(internal.subscriptions.applyStripe, { accountId: account, object: sub, method: "Test card" });
      return { id, clock, cus, sub: String(sub.id) };
    }
    async function pull(c: { id: Id<"subscriptions">; sub: string }) {
      await ctx.runAction(internal.subscriptions.sync, { accountId: account, subscriptionId: c.sub });
      const list = (await call("GET", "invoices", { subscription: c.sub, limit: 10 })).data as StripeResult[];
      for (const inv of list) await ctx.runAction(internal.subscriptions.importInvoice, { accountId: account, stripeId: String(inv.id) });
      await sleep(1500);
      return { stripe: list.map((i) => `${i.status}:${i.amount_paid}`), portal: await ctx.runQuery(internal.subscriptionClock.row, { subscriptionId: c.id }) };
    }
    const run = async (name: string, f: () => Promise<Result>) => {
      try { results.push(await f()); } catch (e) { results.push({ case: name, ok: false, detail: `Error: ${e instanceof Error ? e.message : String(e)}` }); }
    };

    try {
      await run("T2b.1 renewal", async () => {
        const c = await start("renewal", "pm_card_visa");
        await advance(c.clock, now + 32 * DAY);
        const r = await pull(c);
        const paid = r.portal!.invoices.filter((i) => i.status === "paid").length;
        return { case: "T2b.1 renewal", ok: r.portal!.status === "active" && paid >= 2, detail: `portal ${r.portal!.status}, ${paid} paid invoices · Stripe ${r.stripe.join(", ")}` };
      });
      await run("T2b.2 failed renewal, then a new card", async () => {
        const c = await start("failing", "pm_card_visa");
        const bad = (await call("POST", "payment_methods/pm_card_chargeCustomerFail/attach", { customer: c.cus })).id as string;
        await call("POST", `subscriptions/${c.sub}`, { default_payment_method: bad });
        await advance(c.clock, now + 32 * DAY);
        const failed = await pull(c);
        const open = ((await call("GET", "invoices", { subscription: c.sub, status: "open", limit: 3 })).data as StripeResult[])[0];
        const good = (await call("POST", "payment_methods/pm_card_visa/attach", { customer: c.cus })).id as string;
        await call("POST", `subscriptions/${c.sub}`, { default_payment_method: good });
        if (open) await call("POST", `invoices/${open.id}/pay`, { payment_method: good, off_session: true });
        const after = await pull(c);
        return { case: "T2b.2 failed renewal, then a new card", ok: failed.portal!.status === "past_due" && after.portal!.status === "active",
          detail: `after the failed renewal: ${failed.portal!.status} · after the new card: ${after.portal!.status} · Stripe ${after.stripe.join(", ")}` };
      });
      await run("T2b.4 pause voids, resume", async () => {
        const c = await start("pause", "pm_card_visa");
        await call("POST", `subscriptions/${c.sub}`, { pause_collection: { behavior: "void" } });
        await advance(c.clock, now + 32 * DAY);
        const paused = await pull(c);
        await call("POST", `subscriptions/${c.sub}`, { pause_collection: "" });
        const resumed = await pull(c);
        const shownVoid = paused.portal!.invoices.some((i) => i.status === "void");
        return { case: "T2b.4 pause voids, resume", ok: paused.portal!.pause && !shownVoid && paused.stripe.some((s) => s.startsWith("void")) && !resumed.portal!.pause,
          detail: `paused: ${paused.portal!.pause}, voided bill hidden from client: ${!shownVoid} · resumed: ${!resumed.portal!.pause} · Stripe ${paused.stripe.join(", ")}` };
      });
      await run("T2b.4 cancel at the period's end", async () => {
        const c = await start("cancel", "pm_card_visa");
        await call("POST", `subscriptions/${c.sub}`, { cancel_at_period_end: true });
        const ending = await pull(c);
        await advance(c.clock, now + 32 * DAY);
        const ended = await pull(c);
        return { case: "T2b.4 cancel at the period's end", ok: ending.portal!.cancelAtPeriodEnd && ended.portal!.status === "canceled",
          detail: `before the end: ${ending.portal!.cancelAtPeriodEnd ? "ending" : ending.portal!.status} · after: ${ended.portal!.status} · Stripe ${ended.stripe.join(", ")}` };
      });
      await run("trial: nothing until it ends, then charged", async () => {
        const c = await start("trial", "pm_card_visa", { trialDays: 7 });
        const during = await pull(c);
        await advance(c.clock, now + 8 * DAY);
        const after = await pull(c);
        const paid = after.portal!.invoices.filter((i) => i.status === "paid" && i.total > 0).length;
        return { case: "trial: nothing until it ends, then charged", ok: during.portal!.status === "trialing" && during.portal!.invoices.length === 0 && paid === 1 && after.portal!.status === "active",
          detail: `during: ${during.portal!.status}, ${during.portal!.invoices.length} invoices shown · after: ${after.portal!.status}, ${paid} paid` };
      });
    } finally {
      for (const clock of clocks) await call("DELETE", `test_helpers/test_clocks/${clock}`).catch(() => null);
      await call("POST", `products/${product.id}`, { active: false }).catch(() => null);
      if (!keep) await ctx.runMutation(internal.subscriptionClock.cleanup, { planId, clientId });
    }
    return results;
  },
});

export const rowDoc = internalQuery({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, { subscriptionId }) => await ctx.db.get(subscriptionId),
});
