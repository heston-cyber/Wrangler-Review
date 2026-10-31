// Phase 3b · Proposals (Step 3). T3b.1 proposals stay out of Docs and never go to signing; T3b.2 the round trip (send →
// the no-account page → accept or decline, recorded with name, time and IP; a second answer, a forged link and a
// withdrawn proposal refused); T3b.3 nothing moves or converts without the owner (D84), and Start the contract makes the
// Service Agreement draft from the proposal (D75); T3b.5 isolation; T3b.6 numbers never repeat.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { fakeStripe, world } from "./payHarness";
import { newId, pageOf, totals, type Page } from "../convex/lib/wsBuilder";
import { proposalProblems, proposalStarterPage, sectionCount, withoutPrices } from "../convex/lib/wsProposal";

const api = anyApi;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
});
afterEach(() => { vi.unstubAllGlobals(); });

type W = Awaited<ReturnType<typeof world>>;
/** The starter page with prices on its Investment lines. */
function priced(page: Page): Page {
  return { ...page, content: page.content.map((n) => n.type === "items" ? { ...n, attrs: { ...n.attrs, rows: [
    { id: newId(), description: "Shooting · 4 days", qty: 1, rate: 6400 }, { id: newId(), description: "Editing · standard", qty: 1, rate: 3600 },
  ] } } : n) };
}
async function ready(w: W, extra: Record<string, unknown> = {}) {
  const id = await w.heston.mutation(api.proposals.create, { clientId: w.harbor, ...extra }) as Id<"proposals">;
  const p = await w.heston.query(api.proposals.get, { proposalId: id });
  const b = await w.heston.query(api.builder.getBuild, { buildId: p.buildId });
  await w.heston.mutation(api.builder.saveBuild, { buildId: p.buildId, title: "Spring campaign", blocks: priced(pageOf(b.blocks)), fields: { ...b.fields, project: "Spring campaign" }, signers: [], style: b.style });
  return { id, buildId: p.buildId as Id<"wsBuilds"> };
}
const pdf = (w: W) => w.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.4 test"], { type: "application/pdf" })));
const post = (w: W, body: Record<string, unknown>, ip = "203.0.113.9") =>
  w.t.fetch("/p-respond", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip, "user-agent": "TestBrowser/2" }, body: JSON.stringify(body) });
const tokenOf = async (w: W, id: Id<"proposals">) => (await w.heston.query(api.proposals.get, { proposalId: id })).link.split("/p/")[1] as string;

describe("proposals", () => {
  test("the starter page, its problems, and a template without prices", () => {
    const page = proposalStarterPage();
    expect(sectionCount(page)).toBe(8); // Overview … Next steps
    const p = priced(page);
    expect(totals(p)).toMatchObject({ total: 10000, depositPct: 50, deposit: 5000 });
    expect(totals(withoutPrices(p)).total).toBe(0);
    const fields = { business: { name: "W", legalName: "", contact: "Heston", title: "", email: "", phone: "", address: "" }, client: { name: "", company: "", email: "", phone: "", address: "" }, project: "", date: "2026-10-31", custom: [] };
    const probs = proposalProblems({ title: "T", page, fields, signers: [], style: {} as never });
    expect(probs.join(" ")).toMatch(/client's name.*client's email.*Fill in: \{project\}, \{client.company\}.*Investment/);
  });

  test("T3b.6 · T3b.1 numbers run per business; proposals stay out of Docs and never go to signing", async () => {
    const w = await world();
    const a = await w.heston.mutation(api.proposals.create, { clientId: w.harbor }) as Id<"proposals">;
    const b = await w.heston.mutation(api.proposals.create, {}) as Id<"proposals">;
    const pa = await w.heston.query(api.proposals.get, { proposalId: a });
    expect(pa).toMatchObject({ number: "WRNGLR-P-0001", status: "draft", who: { name: "Maya Brooks", email: "maya@harbor.example", company: "Harbor Coffee" } });
    await w.heston.mutation(api.proposals.deleteDraft, { proposalId: b });
    expect((await w.heston.query(api.proposals.get, { proposalId: await w.heston.mutation(api.proposals.create, {}) })).number).toBe("WRNGLR-P-0003"); // never reused
    expect(await w.heston.query(api.builder.listBuilds, {})).toEqual([]); // Docs doesn't list proposals
    await expect(w.heston.mutation(api.builder.deleteBuild, { buildId: pa.buildId })).rejects.toThrow(/Proposals/);
    await expect(w.heston.action(api.builder.toSigning, { buildId: pa.buildId, storageId: await pdf(w) })).rejects.toThrow(/aren't signed/);
    // Proposal templates: their own list, prices left out, kept away from Docs' templates.
    const { buildId } = await ready(w);
    const b0 = await w.heston.query(api.builder.getBuild, { buildId });
    const tpl = await w.heston.mutation(api.builder.saveAsTemplate, { kind: "proposal", name: "Brand film", title: b0.title, blocks: b0.blocks, fields: b0.fields, signers: [], style: b0.style });
    expect(await w.heston.query(api.builder.listTemplates, {})).toEqual([]);
    expect(await w.heston.query(api.proposals.templates, {})).toEqual([expect.objectContaining({ name: "Brand film", sections: 8, used: 0 })]);
    expect(totals(pageOf((await w.heston.query(api.builder.getTemplate, { templateId: tpl })).blocks)).total).toBe(0);
    await expect(w.heston.mutation(api.builder.createBuild, { templateId: tpl })).rejects.toThrow(/proposal template/);
    await w.heston.mutation(api.proposals.create, { templateId: tpl });
    expect((await w.heston.query(api.proposals.templates, {}))[0].used).toBe(1);
  });

  test("T3b.2 send → /p/ → accept (name, time, IP recorded); locked once sent; second answers and forged links refused", async () => {
    const w = await world();
    fakeStripe();
    const blank = await w.heston.mutation(api.proposals.create, { clientId: w.harbor }) as Id<"proposals">;
    await expect(w.heston.action(api.proposals.send, { proposalId: blank, storageId: await pdf(w) })).rejects.toThrow(/Fill in|Investment/);
    const { id, buildId } = await ready(w);
    await w.heston.action(api.proposals.send, { proposalId: id, storageId: await pdf(w), message: "Happy to talk it through." });
    const p = await w.heston.query(api.proposals.get, { proposalId: id });
    expect(p).toMatchObject({ status: "sent", money: { totalCents: 1_000_000, depositCents: 500_000, depositPct: 50, lines: 2 }, message: "Happy to talk it through." });
    expect((await w.heston.query(api.crm.board, {})).deals).toEqual([]); // the box wasn't ticked: nothing moved (D84)
    const b = await w.heston.query(api.builder.getBuild, { buildId });
    await expect(w.heston.mutation(api.builder.saveBuild, { buildId, title: "X", blocks: b.blocks, fields: b.fields, signers: [], style: b.style })).rejects.toThrow(/can't change/);
    const token = await tokenOf(w, id);
    const page = await w.t.query(api.proposals.page, { token });
    expect(page).toMatchObject({ number: "WRNGLR-P-0002", status: "sent", totalCents: 1_000_000, depositPct: 50, contact: { name: "Maya Brooks", company: "Harbor Coffee" }, pdfUrl: expect.any(String) });
    expect(JSON.stringify(page)).not.toMatch(/history|maya@harbor|asked/);
    expect(await w.t.query(api.proposals.page, { token: "x".repeat(24) })).toBeNull();
    await w.t.mutation(api.proposals.markViewed, { token });
    expect((await post(w, { token, action: "accept", name: "M" })).status).toBe(409);
    expect(await (await post(w, { token, action: "accept", name: "Maya Brooks" })).json()).toEqual({ ok: true, status: "accepted" });
    expect(await w.heston.query(api.proposals.get, { proposalId: id })).toMatchObject({ status: "accepted", response: { kind: "accepted", name: "Maya Brooks" }, viewedAt: expect.any(Number) });
    expect(await w.t.run((ctx) => ctx.db.get(id))).toMatchObject({ response: { ip: "203.0.113.9", userAgent: "TestBrowser/2" } });
    expect((await post(w, { token, action: "decline", name: "" })).status).toBe(409);
    expect((await post(w, { token: "y".repeat(24), action: "accept", name: "Maya Brooks" })).status).toBe(409);
    expect((await w.heston.query(api.home.needs, {})).find((n: { kind: string }) => n.kind === "proposal")).toMatchObject({ what: "accepted", who: "Maya Brooks", number: "WRNGLR-P-0002" });
  });

  test("T3b.3 Start the contract (D75): a Service Agreement draft with the client, lines and deposit; asked once, nothing sent", async () => {
    const w = await world();
    fakeStripe();
    await w.heston.mutation(api.builder.ensureStarter, {});
    const { id } = await ready(w);
    await w.heston.action(api.proposals.send, { proposalId: id, storageId: await pdf(w) });
    await expect(w.heston.action(api.proposals.startContract, { proposalId: id })).rejects.toThrow(/accepted/);
    await post(w, { token: await tokenOf(w, id), action: "accept", name: "Maya Brooks" });
    const contract = await w.heston.action(api.proposals.startContract, { proposalId: id });
    const c = await w.heston.query(api.builder.getBuild, { buildId: contract });
    expect(c.kind).toBeUndefined(); // a contract, in Docs
    expect(c.fields.client).toMatchObject({ name: "Maya Brooks", email: "maya@harbor.example", company: "Harbor Coffee" });
    expect(totals(pageOf(c.blocks))).toMatchObject({ total: 10000, depositPct: 50 });
    expect(c.document).toBeNull(); // not sent to signing
    expect(await w.heston.action(api.proposals.startContract, { proposalId: id })).toBe(contract); // the same draft again
    expect((await w.heston.query(api.home.needs, {})).some((n: { kind: string }) => n.kind === "proposal")).toBe(false);
    expect((await w.heston.query(api.builder.listBuilds, {})).map((x: { _id: string }) => x._id)).toEqual([contract]);
  });

  test("T3b.3 the Send box moves the card to Quoted; decline with a reason; withdrawn can't be answered; copy to change", async () => {
    const w = await world();
    fakeStripe();
    const { id } = await ready(w);
    await w.heston.action(api.proposals.send, { proposalId: id, storageId: await pdf(w), move: true });
    expect((await w.heston.query(api.crm.board, {})).deals).toEqual([expect.objectContaining({ stage: "quoted", company: "Harbor Coffee", valueCents: 1_000_000 })]);
    await post(w, { token: await tokenOf(w, id), action: "decline", name: "", reason: "Next year" });
    expect(await w.heston.query(api.proposals.get, { proposalId: id })).toMatchObject({ status: "declined", response: { kind: "declined", name: "Maya Brooks", reason: "Next year" } });
    expect((await w.heston.query(api.home.needs, {})).find((n: { kind: string }) => n.kind === "proposal")).toMatchObject({ what: "declined" });
    await w.heston.mutation(api.proposals.later, { proposalId: id, what: "seen" });
    expect((await w.heston.query(api.home.needs, {})).some((n: { kind: string }) => n.kind === "proposal")).toBe(false);
    const again = await w.heston.mutation(api.proposals.copy, { proposalId: id });
    expect(await w.heston.query(api.proposals.get, { proposalId: again })).toMatchObject({ status: "draft", number: "WRNGLR-P-0002", money: { totalCents: 1_000_000 } });
    const { id: v } = await ready(w);
    await w.heston.action(api.proposals.send, { proposalId: v, storageId: await pdf(w) });
    const vt = await tokenOf(w, v);
    await w.heston.mutation(api.proposals.withdraw, { proposalId: v });
    expect(await (await post(w, { token: vt, action: "accept", name: "Maya Brooks" })).json()).toMatchObject({ error: expect.stringMatching(/withdrawn/) });
    expect((await w.t.query(api.proposals.page, { token: vt })).status).toBe("void");
  });

  test("T3b.5 clients and other businesses see none of it", async () => {
    const w = await world();
    const id = await w.heston.mutation(api.proposals.create, { clientId: w.harbor }) as Id<"proposals">;
    await expect(w.maya.query(api.proposals.list, {})).rejects.toThrow();
    await expect(w.maya.query(api.proposals.get, { proposalId: id })).rejects.toThrow();
    expect(await w.boss.query(api.proposals.list, {})).toEqual([]);
    expect(await w.boss.query(api.proposals.templates, {})).toEqual([]);
    expect(await w.boss.query(api.proposals.get, { proposalId: id })).toBeNull();
    await expect(w.boss.mutation(api.proposals.withdraw, { proposalId: id })).rejects.toThrow();
    await expect(w.boss.mutation(api.proposals.create, { clientId: w.harbor })).rejects.toThrow(/company/);
  });
});
