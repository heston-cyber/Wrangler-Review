// Phase 2b (Oct 30): plans and subscriptions on each business's own connected Stripe account. Stripe is a stand-in.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import { fakeStripe, world } from "./payHarness";
import { monthlyCents, priceLabel } from "../convex/plans";

const api = anyApi;

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.STRIPE_PLATFORM_KEY = "sk_test_platform";
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_pay";
  process.env.EMAIL_ONLY_TO = "heston@wranglerproductions.com";
  process.env.RESEND_API_KEY = "re_test";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("plans", () => {
  test("New plan makes a product and a monthly price on the business's own account; the list shows it", async () => {
    const w = await world();
    const calls = fakeStripe();
    const id = await w.heston.action(api.plans.save, { name: " Monthly content retainer ", description: "Four cut-downs a month", amountCents: 250000, interval: "month", intervalCount: 1 });
    expect(calls.map((c) => `${c.method} ${c.path} ${c.account}`)).toEqual(["POST products acct_A", "POST prices acct_A", "POST products/prod_0 acct_A"]);
    expect(calls[1].form).toMatchObject({ product: "prod_0", currency: "usd", unit_amount: "250000", "recurring[interval]": "month", "recurring[interval_count]": "1" });
    expect(calls[2].form).toEqual({ default_price: "price_0" });
    const list = await w.heston.query(api.plans.list, {});
    expect(list).toEqual([expect.objectContaining({ _id: id, name: "Monthly content retainer", price: "$2,500.00 / month", archived: false, active: 0 })]);
  });

  test("editing the name only updates the product; a new price makes a new Stripe price and retires the old one", async () => {
    const w = await world();
    fakeStripe();
    const id = await w.heston.action(api.plans.save, { name: "Retainer", amountCents: 100000, interval: "month", intervalCount: 1 });
    const rename = fakeStripe();
    await w.heston.action(api.plans.save, { planId: id, name: "Retainer (social)", amountCents: 100000, interval: "month", intervalCount: 1 });
    expect(rename.map((c) => `${c.method} ${c.path}`)).toEqual(["POST products/prod_0"]);
    const reprice = fakeStripe();
    await w.heston.action(api.plans.save, { planId: id, name: "Retainer (social)", amountCents: 150000, interval: "month", intervalCount: 3 });
    expect(reprice.map((c) => `${c.method} ${c.path}`)).toEqual(["POST products/prod_0", "POST prices", "POST products/prod_0", "POST prices/price_0"]);
    expect(reprice[3].form).toEqual({ active: "false" });
    expect((await w.heston.query(api.plans.get, { planId: id }))).toMatchObject({ amountCents: 150000, interval: "month", intervalCount: 3 });
  });

  test("archive and bring back; the rules on price and interval; refused without Stripe or for anyone but the owner", async () => {
    const w = await world();
    fakeStripe();
    const id = await w.heston.action(api.plans.save, { name: "Retainer", amountCents: 100000, interval: "year", intervalCount: 1 });
    await w.heston.action(api.plans.setArchived, { planId: id, archived: true });
    expect((await w.heston.query(api.plans.list, {}))[0].archived).toBe(true);
    await w.heston.action(api.plans.setArchived, { planId: id, archived: false });
    expect((await w.heston.query(api.plans.list, {}))[0].archived).toBe(false);
    await expect(w.heston.action(api.plans.save, { name: "X", amountCents: 10, interval: "month", intervalCount: 1 })).rejects.toThrow(/at least \$0.50/);
    await expect(w.heston.action(api.plans.save, { name: "X", amountCents: 1000, interval: "year", intervalCount: 4 })).rejects.toThrow(/3 years/);
    await expect(w.maya.action(api.plans.save, { name: "X", amountCents: 1000, interval: "month", intervalCount: 1 })).rejects.toThrow();
    await expect(w.boss.query(api.plans.list, {})).resolves.toEqual([]);
    await expect(w.boss.action(api.plans.setArchived, { planId: id, archived: true })).rejects.toThrow();
    await w.t.run(async (ctx) => { const b = (await ctx.db.get(w.A))!; await ctx.db.patch(w.A, { stripe: { ...b.stripe!, status: "disconnected" } }); });
    await expect(w.heston.action(api.plans.save, { name: "X", amountCents: 1000, interval: "month", intervalCount: 1 })).rejects.toThrow(/Connect Stripe first/);
  });

  test("labels and the monthly figure", () => {
    expect(priceLabel(150000, "month", 3)).toBe("$1,500.00 every 3 months");
    expect(priceLabel(1200000, "year", 1)).toBe("$12,000.00 / year");
    expect(monthlyCents(1200000, "year", 1)).toBe(100000);
    expect(monthlyCents(150000, "month", 3)).toBe(50000);
  });
});

async function withPlan(w: Awaited<ReturnType<typeof world>>) {
  fakeStripe();
  return await w.heston.action(api.plans.save, { name: "Monthly retainer", description: "Four cut-downs", amountCents: 250000, interval: "month", intervalCount: 1 });
}
const today = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() - 6 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);

describe("starting a subscription", () => {
  test("the owner starts it: a waiting row (nothing in Stripe but the customer), email 13 and an Inbox item to add a payment method", async () => {
    vi.useFakeTimers();
    const w = await world();
    const planId = await withPlan(w);
    const calls = fakeStripe();
    const id = await w.heston.action(api.subscriptions.start, { clientId: w.harbor, planId, projectId: w.p, billTo: { name: "Maya Brooks", email: "Maya@Harbor.example" }, startDate: today(), firstInvoice: "now", postInbox: true });
    expect(calls.map((c) => `${c.method} ${c.path} ${c.account}`)).toEqual(["POST customers acct_A"]);
    await w.t.finishAllScheduledFunctions(vi.runAllTimers);
    const s = await w.heston.query(api.subscriptions.get, { subscriptionId: id });
    expect(s).toMatchObject({ status: "waiting", plan: "Monthly retainer", price: "$2,500.00 / month", billTo: { email: "maya@harbor.example" }, inStripe: false });
    const token = s.link.split("/sub/")[1];
    expect(await w.t.run(async (ctx) => (await ctx.db.query("emailLog").collect()).map((r) => r.key))).toEqual([`sub-started:${id}`]);
    expect(await w.t.run(async (ctx) => (await ctx.db.query("inboxItems").collect()).map((r) => `${r.kind} ${r.link} ${r.linkLabel}`))).toEqual([`subscription /sub/${token} Add payment method`]);
    // The client's page, signed out; the client's list, signed in.
    expect(await w.t.query(api.subscriptions.page, { token })).toMatchObject({ plan: "Monthly retainer", status: "waiting", canSetup: true, business: { name: "Wrangler Productions" } });
    expect((await w.maya.query(api.subscriptions.mine, {})).map((r: { token: string }) => r.token)).toEqual([token]);
    expect(await w.sam.query(api.subscriptions.mine, {})).toEqual([]);
    expect(await w.boss.query(api.subscriptions.list, {})).toMatchObject({ rows: [] });
  });

  test("the client saves a card: it becomes the default, and the subscription is made in Stripe charged now; Stripe's state comes back", async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_platform";
    const w = await world();
    const planId = await withPlan(w);
    fakeStripe();
    const id = await w.heston.action(api.subscriptions.start, { clientId: w.harbor, planId, billTo: { name: "Maya Brooks", email: "maya@harbor.example" }, startDate: today(), firstInvoice: "now", postInbox: false });
    const token = (await w.heston.query(api.subscriptions.get, { subscriptionId: id })).link.split("/sub/")[1];
    const calls = fakeStripe({ sub: { portal: id } });
    expect(await w.t.action(api.subscriptions.setupStart, { token })).toEqual({ clientSecret: "seti_1_secret_x", accountId: "acct_A", publishableKey: "pk_test_platform" });
    expect(calls.find((c) => c.path === "setup_intents")!.form).toMatchObject({ customer: "cus_1", usage: "off_session", "metadata[portal_subscription]": id });
    expect(await w.t.action(api.subscriptions.setupDone, { token, setupIntentId: "seti_1" })).toEqual({ ok: true, message: null });
    const make = calls.find((c) => c.method === "POST" && c.path === "subscriptions")!;
    expect(make.account).toBe("acct_A");
    expect(make.form).toMatchObject({ customer: "cus_1", "items[0][price]": "price_0", default_payment_method: "pm_1", collection_method: "charge_automatically", off_session: "true" });
    expect(make.form.trial_end).toBeUndefined();
    const s = await w.heston.query(api.subscriptions.get, { subscriptionId: id });
    expect(s).toMatchObject({ status: "active", method: "Visa •••• 4242", inStripe: true, currentPeriodEnd: 1_792_592_000_000 });
    delete process.env.STRIPE_PUBLISHABLE_KEY;
  });

  test("a later start: nothing now (charged on the start date), or the first period now with the plan from the next period on", async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_platform";
    const w = await world();
    const planId = await withPlan(w);
    for (const firstInvoice of ["start", "now"] as const) {
      fakeStripe();
      const id = await w.heston.action(api.subscriptions.start, { clientId: w.harbor, planId, billTo: { name: "Maya", email: "maya@harbor.example" }, startDate: inDays(10), firstInvoice, postInbox: false });
      const token = (await w.heston.query(api.subscriptions.get, { subscriptionId: id })).link.split("/sub/")[1];
      const calls = fakeStripe({ sub: { portal: id, status: "trialing", id: `sub_${firstInvoice}` } });
      await w.t.action(api.subscriptions.setupDone, { token, setupIntentId: "seti_1" });
      const f = calls.find((c) => c.method === "POST" && c.path === "subscriptions")!.form;
      const start = Date.parse(`${inDays(10)}T09:00:00-06:00`) / 1000;
      if (firstInvoice === "start") { expect(Number(f.trial_end)).toBe(start); expect(f["add_invoice_items[0][price_data][unit_amount]"]).toBeUndefined(); }
      else { expect(Number(f.trial_end)).toBeGreaterThan(start + 27 * 86400); expect(f["add_invoice_items[0][price_data][unit_amount]"]).toBe("250000"); expect(f["add_invoice_items[0][price_data][product]"]).toBe("prod_0"); }
      expect((await w.heston.query(api.subscriptions.get, { subscriptionId: id })).status).toBe(firstInvoice === "start" ? "scheduled" : "scheduled");
    }
    delete process.env.STRIPE_PUBLISHABLE_KEY;
  });

  test("past due: saving a new card retries the open invoice straight away and says what happened", async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_platform";
    const w = await world();
    const planId = await withPlan(w);
    fakeStripe();
    const id = await w.heston.action(api.subscriptions.start, { clientId: w.harbor, planId, billTo: { name: "Maya", email: "maya@harbor.example" }, startDate: today(), firstInvoice: "now", postInbox: false });
    const token = (await w.heston.query(api.subscriptions.get, { subscriptionId: id })).link.split("/sub/")[1];
    fakeStripe({ sub: { portal: id } });
    await w.t.action(api.subscriptions.setupDone, { token, setupIntentId: "seti_1" });
    const fail = fakeStripe({ sub: { portal: id, status: "past_due" }, subInvoice: {}, payError: "Your card was declined." });
    expect(await w.t.action(api.subscriptions.setupDone, { token, setupIntentId: "seti_1" })).toEqual({ ok: false, message: "Your card was declined." });
    expect(fail.some((c) => c.path === "invoices/in_s1/pay" && c.form.payment_method === "pm_1")).toBe(true);
    fakeStripe({ sub: { portal: id, status: "active" }, subInvoice: {} });
    expect(await w.t.action(api.subscriptions.setupDone, { token, setupIntentId: "seti_1" })).toEqual({ ok: true, message: null });
    delete process.env.STRIPE_PUBLISHABLE_KEY;
  });

  test("each period's invoice is mirrored once into Payments › Invoices; refused for a past start, an archived plan, or another business", async () => {
    vi.useFakeTimers();
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_platform";
    const w = await world();
    const planId = await withPlan(w);
    fakeStripe();
    const id = await w.heston.action(api.subscriptions.start, { clientId: w.harbor, planId, billTo: { name: "Maya", email: "maya@harbor.example" }, startDate: today(), firstInvoice: "now", postInbox: false });
    const token = (await w.heston.query(api.subscriptions.get, { subscriptionId: id })).link.split("/sub/")[1];
    fakeStripe({ sub: { portal: id } });
    await w.t.action(api.subscriptions.setupDone, { token, setupIntentId: "seti_1" });
    fakeStripe({ sub: { portal: id }, subInvoice: { status: "paid", amount_paid: 250000, amount_remaining: 0 } });
    await w.t.action(anyApi.subscriptions.importInvoice, { accountId: "acct_A", stripeId: "in_s1" });
    await w.t.action(anyApi.subscriptions.importInvoice, { accountId: "acct_A", stripeId: "in_s1" });
    await w.t.finishAllScheduledFunctions(vi.runAllTimers);
    const invs = (await w.heston.query(api.invoices.list, {})).filter((i: { kind: string }) => i.kind === "subscription");
    expect(invs).toHaveLength(1);
    expect(invs[0]).toMatchObject({ number: "WRNGLR-0007", status: "paid", totalCents: 250000 });
    expect((await w.heston.query(api.subscriptions.get, { subscriptionId: id })).invoices).toHaveLength(1);
    await expect(w.heston.action(api.subscriptions.start, { clientId: w.harbor, planId, billTo: { name: "M", email: "m@h.example" }, startDate: "2020-01-01", firstInvoice: "now", postInbox: false })).rejects.toThrow(/past/);
    await expect(w.boss.action(api.subscriptions.start, { clientId: w.harbor, planId, billTo: { name: "M", email: "m@h.example" }, startDate: today(), firstInvoice: "now", postInbox: false })).rejects.toThrow();
    delete process.env.STRIPE_PUBLISHABLE_KEY;
  });
});

async function running(w: Awaited<ReturnType<typeof world>>, extra: Record<string, unknown> = {}) {
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_platform";
  const planId = await withPlan(w);
  fakeStripe();
  const id = await w.heston.action(api.subscriptions.start, { clientId: w.harbor, planId, billTo: { name: "Maya Brooks", email: "maya@harbor.example" }, startDate: today(), firstInvoice: "now", postInbox: false, ...extra });
  const token = (await w.heston.query(api.subscriptions.get, { subscriptionId: id })).link.split("/sub/")[1];
  fakeStripe({ sub: { portal: id } });
  await w.t.action(api.subscriptions.setupDone, { token, setupIntentId: "seti_1" });
  delete process.env.STRIPE_PUBLISHABLE_KEY;
  return { id, token, planId };
}

describe("the owner's changes", () => {
  test("change plan: Stripe's proration is shown first, then the item's price changes and the portal's copy follows", async () => {
    const w = await world();
    const { id } = await running(w);
    fakeStripe();
    const bigger = await w.heston.action(api.plans.save, { name: "Retainer plus", amountCents: 400000, interval: "month", intervalCount: 1 });
    const calls = fakeStripe({ sub: { portal: id, items: { data: [{ id: "si_1", current_period_start: 1_790_000_000, current_period_end: 1_792_592_000 }] } } });
    expect(await w.heston.action(api.subscriptions.changePreview, { subscriptionId: id, planId: bigger })).toEqual({ amountCents: 312500, at: 1_792_592_000_000 });
    await w.heston.action(api.subscriptions.changePlan, { subscriptionId: id, planId: bigger });
    const upd = calls.find((c) => c.method === "POST" && c.path === "subscriptions/sub_1")!;
    expect(upd.form).toMatchObject({ "items[0][id]": "si_1", "items[0][price]": "price_0", proration_behavior: "create_prorations" });
    expect(await w.heston.query(api.subscriptions.get, { subscriptionId: id })).toMatchObject({ plan: "Retainer plus", price: "$4,000.00 / month" });
  });

  test("pause voids while paused; resume lifts it; cancel at period end then keep it; cancel now (email 16 once)", async () => {
    vi.useFakeTimers();
    const w = await world();
    const { id } = await running(w);
    let calls = fakeStripe({ sub: { portal: id, pause_collection: { behavior: "void" } } });
    await w.heston.action(api.subscriptions.pause, { subscriptionId: id });
    expect(calls.find((c) => c.method === "POST" && c.path === "subscriptions/sub_1")!.form).toEqual({ "pause_collection[behavior]": "void" });
    expect((await w.heston.query(api.subscriptions.get, { subscriptionId: id })).status).toBe("paused");
    calls = fakeStripe({ sub: { portal: id } });
    await w.heston.action(api.subscriptions.resume, { subscriptionId: id });
    expect(calls.find((c) => c.method === "POST" && c.path === "subscriptions/sub_1")!.form).toEqual({ pause_collection: "" });
    expect((await w.heston.query(api.subscriptions.get, { subscriptionId: id })).status).toBe("active");
    calls = fakeStripe({ sub: { portal: id, cancel_at_period_end: true } });
    await w.heston.action(api.subscriptions.cancel, { subscriptionId: id, when: "period_end" });
    expect(calls.find((c) => c.method === "POST" && c.path === "subscriptions/sub_1")!.form).toEqual({ cancel_at_period_end: "true" });
    expect((await w.heston.query(api.subscriptions.get, { subscriptionId: id })).status).toBe("ending");
    fakeStripe({ sub: { portal: id } });
    await w.heston.action(api.subscriptions.resume, { subscriptionId: id });
    expect((await w.heston.query(api.subscriptions.get, { subscriptionId: id })).status).toBe("active");
    calls = fakeStripe({ sub: { portal: id, status: "canceled", canceled_at: 1_791_000_000 } });
    await w.heston.action(api.subscriptions.cancel, { subscriptionId: id, when: "now" });
    expect(calls.some((c) => c.method === "DELETE" && c.path === "subscriptions/sub_1")).toBe(true);
    await w.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await w.heston.query(api.subscriptions.get, { subscriptionId: id })).status).toBe("canceled");
    expect(await w.t.run(async (ctx) => (await ctx.db.query("emailLog").collect()).filter((r) => r.key.startsWith("sub-cancelled:")).length)).toBe(1);
    await expect(w.maya.action(api.subscriptions.cancel, { subscriptionId: id, when: "now" })).rejects.toThrow();
  });

  test("a waiting subscription (no card yet) can be cancelled without Stripe", async () => {
    const w = await world();
    const planId = await withPlan(w);
    fakeStripe();
    const id = await w.heston.action(api.subscriptions.start, { clientId: w.harbor, planId, billTo: { name: "Maya", email: "maya@harbor.example" }, startDate: today(), firstInvoice: "now", postInbox: false });
    const calls = fakeStripe();
    await w.heston.action(api.subscriptions.cancel, { subscriptionId: id, when: "period_end" });
    expect(calls.filter((c) => c.path.startsWith("subscriptions"))).toEqual([]);
    expect((await w.heston.query(api.subscriptions.get, { subscriptionId: id })).status).toBe("canceled");
  });
});

describe("failed charges and D64", () => {
  async function failedInvoice(w: Awaited<ReturnType<typeof world>>, id: string) {
    fakeStripe({ sub: { portal: id }, subInvoice: {} });
    await w.t.action(anyApi.subscriptions.importInvoice, { accountId: "acct_A", stripeId: "in_s1" });
    return await w.t.run(async (ctx) => {
      const i = (await ctx.db.query("invoices").collect()).find((x) => x.kind === "subscription")!;
      await ctx.db.patch(i._id, { lastFailure: { at: Date.now(), message: "Your card was declined.", key: "pi_9:ch_9" } });
      return i._id;
    });
  }

  test("emails 15 (client) and 17 (owner), the Inbox item, and past due; Stripe keeps trying, so it stays", async () => {
    const w = await world();
    const { id } = await running(w);
    const inv = await failedInvoice(w, id);
    fakeStripe({ sub: { portal: id }, subInvoice: { next_payment_attempt: 1_793_000_000 } });
    expect(await w.t.action(anyApi.subscriptions.onFailed, { invoiceId: inv, failureKey: "pi_9:ch_9", failureAt: Date.now(), message: "Your card was declined." })).toBe("sent");
    const keys = await w.t.run(async (ctx) => (await ctx.db.query("emailLog").collect()).map((r) => `${r.key.split(":")[0]} ${r.to}`));
    expect(keys).toEqual(expect.arrayContaining(["subfailed maya@harbor.example", "subfailed-owner heston@wranglerproductions.com"]));
    expect(await w.t.run(async (ctx) => (await ctx.db.query("inboxItems").collect()).map((r) => r.title))).toContain("Payment failed · Monthly retainer");
    expect((await w.heston.query(api.subscriptions.get, { subscriptionId: id })).lastFailure).toMatchObject({ message: "Your card was declined." });
    // Run again: nothing new.
    await w.t.action(anyApi.subscriptions.onFailed, { invoiceId: inv, failureKey: "pi_9:ch_9", failureAt: Date.now(), message: "Your card was declined." });
    expect(await w.t.run(async (ctx) => (await ctx.db.query("emailLog").collect()).filter((r) => r.key.startsWith("subfailed")).length)).toBe(2);
  });

  test("after the last try: the business's choice, overridden per client (cancel), and only then", async () => {
    vi.useFakeTimers();
    const w = await world();
    const { id } = await running(w);
    await w.heston.mutation(api.subscriptions.setFailRule, { rule: "past_due" });
    await w.heston.mutation(api.subscriptions.setClientFailRule, { clientId: w.harbor, rule: "cancel" });
    expect(await w.heston.query(api.subscriptions.failRules, { clientId: w.harbor })).toEqual({ business: "past_due", client: "cancel" });
    const inv = await failedInvoice(w, id);
    const calls = fakeStripe({ sub: { portal: id, status: "canceled" }, subInvoice: { next_payment_attempt: null } });
    await w.t.action(anyApi.subscriptions.onFailed, { invoiceId: inv, failureKey: "pi_9:ch_9", failureAt: Date.now(), message: "Your card was declined." });
    expect(calls.some((c) => c.method === "DELETE" && c.path === "subscriptions/sub_1")).toBe(true);
    await w.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await w.heston.query(api.subscriptions.get, { subscriptionId: id })).status).toBe("canceled");
    // Back to the business setting (keep past due): no cancel.
    await w.heston.mutation(api.subscriptions.setClientFailRule, { clientId: w.harbor, rule: "business" });
    expect(await w.heston.query(api.subscriptions.failRules, { clientId: w.harbor })).toEqual({ business: "past_due", client: "business" });
  });
});

describe("email 14 (D62) and the reminders", () => {
  test("sent once, 7 days before the next charge; never for a waiting or ended subscription", async () => {
    const w = await world();
    const { id } = await running(w);
    const now = Date.now();
    await w.t.run(async (ctx) => { await ctx.db.patch(id, { currentPeriodEnd: now + 6.5 * 86_400_000 }); });
    expect(await w.t.action(anyApi.subscriptions.runUpcoming, {})).toBe(1);
    expect(await w.t.action(anyApi.subscriptions.runUpcoming, {})).toBe(0);
    await w.t.run(async (ctx) => { await ctx.db.patch(id, { currentPeriodEnd: now + 9 * 86_400_000 }); });
    expect(await w.t.action(anyApi.subscriptions.runUpcoming, {})).toBe(0);
    await w.t.run(async (ctx) => { await ctx.db.patch(id, { currentPeriodEnd: now + 6.5 * 86_400_000, status: "canceled" }); });
    expect(await w.t.action(anyApi.subscriptions.runUpcoming, {})).toBe(0);
  });
});

describe("review fixes (Oct 30)", () => {
  test("1: a cancelled subscription can't be started by saving a card; 2: two saves at once make one Stripe subscription", async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_platform";
    const w = await world();
    const planId = await withPlan(w);
    fakeStripe();
    const a = await w.heston.action(api.subscriptions.start, { clientId: w.harbor, planId, billTo: { name: "Maya", email: "maya@harbor.example" }, startDate: today(), firstInvoice: "now", postInbox: false });
    const tokA = (await w.heston.query(api.subscriptions.get, { subscriptionId: a })).link.split("/sub/")[1];
    await w.heston.action(api.subscriptions.cancel, { subscriptionId: a, when: "now" });
    const calls = fakeStripe({ sub: { portal: a } });
    await expect(w.t.action(api.subscriptions.setupDone, { token: tokA, setupIntentId: "seti_1" })).rejects.toThrow(/ended/);
    expect(calls.some((c) => c.method === "POST" && c.path === "subscriptions")).toBe(false);
    fakeStripe();
    const b = await w.heston.action(api.subscriptions.start, { clientId: w.harbor, planId, billTo: { name: "Maya", email: "maya@harbor.example" }, startDate: today(), firstInvoice: "now", postInbox: false });
    expect(await w.t.mutation(anyApi.subscriptions.claimStart, { subscriptionId: b })).toBe("ok");
    const tokB = (await w.heston.query(api.subscriptions.get, { subscriptionId: b })).link.split("/sub/")[1];
    const second = fakeStripe({ sub: { portal: b } });
    await expect(w.t.action(api.subscriptions.setupDone, { token: tokB, setupIntentId: "seti_1" })).rejects.toThrow(/being set up/);
    expect(second.some((c) => c.method === "POST" && c.path === "subscriptions")).toBe(false);
    delete process.env.STRIPE_PUBLISHABLE_KEY;
  });

  test("3: Stripe not answering is never the last try (no D64 cancel); 4: the first charge's failure sends nothing", async () => {
    const w = await world();
    const { id } = await running(w);
    await w.heston.mutation(api.subscriptions.setFailRule, { rule: "cancel" });
    fakeStripe({ sub: { portal: id }, subInvoice: {} });
    await w.t.action(anyApi.subscriptions.importInvoice, { accountId: "acct_A", stripeId: "in_s1" });
    const inv = await w.t.run(async (ctx) => {
      const i = (await ctx.db.query("invoices").collect()).find((x) => x.kind === "subscription")!;
      await ctx.db.patch(i._id, { lastFailure: { at: Date.now(), message: "Declined.", key: "k1" } });
      return i._id;
    });
    const down = fakeStripe();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    expect(await w.t.action(anyApi.subscriptions.onFailed, { invoiceId: inv, failureKey: "k1", failureAt: Date.now(), message: "Declined." })).toBe("retry");
    expect(down.some((c) => c.method === "DELETE")).toBe(false);
    fakeStripe({ sub: { portal: id }, subInvoice: { billing_reason: "subscription_create", next_payment_attempt: null } });
    expect(await w.t.action(anyApi.subscriptions.onFailed, { invoiceId: inv, failureKey: "k1", failureAt: Date.now(), message: "Declined." })).toBe("first-charge");
    expect(await w.t.run(async (ctx) => (await ctx.db.query("emailLog").collect()).filter((r) => r.key.startsWith("subfailed")).length)).toBe(0);
  });

  test("6: a first charge more than 2 years out is refused at start; 7: a waiting trial shows its end as the first charge", async () => {
    const w = await world();
    const planId = await withPlan(w);
    fakeStripe();
    await expect(w.heston.action(api.subscriptions.start, { clientId: w.harbor, planId, billTo: { name: "Maya", email: "maya@harbor.example" }, startDate: inDays(300), trialDays: 700, firstInvoice: "start", postInbox: false })).rejects.toThrow(/2 years/);
    const id = await w.heston.action(api.subscriptions.start, { clientId: w.harbor, planId, billTo: { name: "Maya", email: "maya@harbor.example" }, startDate: today(), trialDays: 14, firstInvoice: "start", postInbox: false });
    const s = await w.heston.query(api.subscriptions.get, { subscriptionId: id });
    expect(s.nextCharge).toBeGreaterThan(Date.now() + 13.9 * 86_400_000);
  });

  test("10: a paused period's voided bill (nothing paid) isn't mirrored to the client", async () => {
    const w = await world();
    const { id } = await running(w);
    fakeStripe({ sub: { portal: id }, subInvoice: { status: "void", amount_paid: 0 } });
    await w.t.action(anyApi.subscriptions.importInvoice, { accountId: "acct_A", stripeId: "in_s1" });
    expect((await w.heston.query(api.invoices.list, {})).filter((i: { kind: string }) => i.kind === "subscription")).toEqual([]);
  });
});

describe("the sandbox clock check", () => {
  test("refuses a live key", async () => {
    const w = await world();
    process.env.STRIPE_PLATFORM_KEY = "rk_live_x";
    await expect(w.t.action(anyApi.subscriptionClock.clockCheck, {})).rejects.toThrow(/only with a Stripe test/);
    process.env.STRIPE_PLATFORM_KEY = "sk_test_platform";
  });
});
