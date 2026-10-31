// @vitest-environment node
// Phase 3b · Proposals Step 4: the questionnaire (D70, D82, D90), "Fill in myself", "Draft with Claude" through the Sign
// connector (D89), and the pitch deck's material (D72).
//   T3b.1 each business edits its own questionnaire; Client and Pricing can't be removed; Reset goes back.
//   T3b.4 the answers become the proposal: the outline with the priced lines and deposit; a new lead or company is saved
//         as chosen; the company's brand kit gets the brand answers; Claude reads the answers and writes the draft, and
//         can't write a sent proposal or one with signature boxes.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { WRANGLER_QUESTIONNAIRE, cleanQuestionnaire, outlineFromAnswers, type Questionnaire } from "../convex/lib/questionnaire";
import { pageOf, textOf, totals, type PNode } from "../convex/lib/wsBuilder";

const api = anyApi;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
});
afterEach(() => { vi.unstubAllGlobals(); });
type W = Awaited<ReturnType<typeof world>>;

const answers = (client: Record<string, unknown>) => ({
  client, title: "Spirit Days 2027 coverage", type: "Event coverage", scope: "Three days of music on the riverfront.", deliverables: ["Recap film", "15s social cuts"],
  goals: "Sell more early-bird passes.", colors: ["#1F4E79", "#F2B705"], heading: "Montserrat", tone: ["Energetic", "Community"], links: ["https://youtube.com/watch?v=x"],
  days: 4, level: "standard", model: "Fixed price", schedule: "Deposit, then balance on delivery", deposit: { kind: "percent", value: 50 },
  shoot: { start: "2027-04-16", end: "2027-04-18" }, delivery: "2027-05-07", milestones: [{ name: "First cut", date: "2027-04-28" }], crew: ["Director", "Shooter"],
  __lines: [
    { id: "a", description: "Shooting · 4 days", qty: 1, unitCents: 640_000, suggestedCents: 640_000, auto: "shooting" },
    { id: "b", description: "Editing · standard", qty: 1, unitCents: 1_000_000, suggestedCents: 1_280_000, auto: "editing" },
  ],
});
async function mcp(w: W) {
  const { key } = await w.heston.action(api.wsConnector.createKey, {});
  return async (name: string, args: Record<string, unknown> = {}) => {
    const r = await w.t.fetch("/ws-mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    const j = await r.json();
    return { error: j.result.isError === true, text: j.result.content[0].text as string, data: j.result.structuredContent as Record<string, any> };
  };
}

describe("proposal questionnaire", () => {
  test("T3b.1 each business edits its own set; Client and Pricing stay; Reset goes back", async () => {
    const w = await world();
    const q0 = await w.heston.query(api.proposals.questionnaire, {});
    expect(q0).toMatchObject({ custom: false });
    expect(q0.questionnaire.steps.map((s: { title: string }) => s.title)).toEqual(["Client", "Project", "Brand kit", "Pricing", "Timeline", "Resources", "Special items"]);
    const mine: Questionnaire = JSON.parse(JSON.stringify(q0.questionnaire));
    mine.steps[1].questions.push({ id: "venue", label: "Venue size", type: "number" });
    mine.steps = mine.steps.filter((s) => s.id !== "resources");
    await w.heston.mutation(api.proposals.saveQuestionnaire, { questionnaire: mine });
    const q1 = await w.heston.query(api.proposals.questionnaire, {});
    expect(q1.custom).toBe(true);
    expect(q1.questionnaire.steps).toHaveLength(6);
    expect((await w.boss.query(api.proposals.questionnaire, {})).custom).toBe(false); // another business still has Wrangler's
    await expect(w.heston.mutation(api.proposals.saveQuestionnaire, { questionnaire: { steps: mine.steps.filter((s) => s.fixed !== "pricing") } })).rejects.toThrow(/Pricing step can't be removed/);
    const noDays = JSON.parse(JSON.stringify(mine)); noDays.steps.find((s: { fixed?: string }) => s.fixed === "pricing").questions.shift();
    await expect(w.heston.mutation(api.proposals.saveQuestionnaire, { questionnaire: noDays })).rejects.toThrow(/can't be removed/);
    await w.heston.mutation(api.proposals.resetQuestionnaire, {});
    expect((await w.heston.query(api.proposals.questionnaire, {})).custom).toBe(false);
    expect(() => cleanQuestionnaire(WRANGLER_QUESTIONNAIRE)).not.toThrow();
  });

  test("the outline: sections from the answers, the lines under Investment, the deposit in Payment terms", () => {
    const page = outlineFromAnswers(WRANGLER_QUESTIONNAIRE, answers({ mode: "existing", company: "Spirit Days", name: "Sam", email: "sam@x.co" }));
    const words = textOf(page as unknown as PNode);
    expect(words).toMatch(/Overview[\s\S]*Sell more early-bird passes[\s\S]*Scope[\s\S]*Crew: Director, Shooter[\s\S]*Deliverables[\s\S]*Recap film[\s\S]*Timeline[\s\S]*Shoot: Apr 16, 2027 – Apr 18, 2027[\s\S]*First cut: Apr 28, 2027/);
    expect(totals(page)).toMatchObject({ total: 16_400, depositPct: 50, deposit: 8_200 });
  });

  test("T3b.4 Fill in myself: a new lead is saved, the builder gets the outline, the client and the title", async () => {
    const w = await world();
    const id = await w.heston.mutation(api.proposals.startQuestionnaire, {}) as Id<"proposals">;
    expect(await w.heston.query(api.proposals.get, { proposalId: id })).toMatchObject({ filling: true, source: "questionnaire", number: "WRNGLR-P-0001" });
    expect((await w.heston.query(api.proposals.list, {}))[0]).toMatchObject({ filling: true });
    await expect(w.heston.mutation(api.proposals.finish, { proposalId: id, how: "self" })).rejects.toThrow(/Answer "Client"/);
    await w.heston.mutation(api.proposals.saveAnswers, { proposalId: id, step: 7, answers: answers({ mode: "new", company: "Spirit Days", name: "Sam Patel", email: "Sam@SpiritDays.com", website: "spiritdays.com", saveAs: "lead" }) });
    await w.heston.mutation(api.proposals.finish, { proposalId: id, how: "self" });
    const p = await w.heston.query(api.proposals.get, { proposalId: id });
    expect(p).toMatchObject({ filling: false, status: "draft", title: "Spirit Days 2027 coverage", who: { name: "Sam Patel", email: "sam@spiritdays.com", company: "Spirit Days" } });
    const b = await w.heston.query(api.builder.getBuild, { buildId: p.buildId });
    expect(b.fields.project).toBe("Spirit Days 2027 coverage");
    expect(totals(pageOf(b.blocks)).total).toBe(16_400);
    const board = await w.heston.query(api.crm.board, {});
    expect(board.deals).toEqual([expect.objectContaining({ stage: "lead", title: "Spirit Days 2027 coverage" })]); // the owner chose "a new lead"
  });

  test("T3b.4 Draft with Claude: waiting → Claude reads the answers and writes the draft → ready, with the review banner; the brand kit is filled", async () => {
    const w = await world();
    const call = await mcp(w);
    const id = await w.heston.mutation(api.proposals.startQuestionnaire, { clientId: w.harbor }) as Id<"proposals">;
    const start = await w.heston.query(api.proposals.get, { proposalId: id });
    expect(start.answers.client).toMatchObject({ mode: "existing", company: "Harbor Coffee", name: "Maya Brooks" });
    expect((await call("get_proposal", { proposal: "WRNGLR-P-0001" })).data).toMatchObject({ filling: true });
    expect((await call("write_proposal_draft", { proposal: "WRNGLR-P-0001", markdown: "# X" })).error).toBe(true); // not finished yet
    await w.heston.mutation(api.proposals.saveAnswers, { proposalId: id, answers: answers(start.answers.client) });
    await w.heston.mutation(api.proposals.finish, { proposalId: id, how: "claude" });
    expect((await w.heston.query(api.proposals.get, { proposalId: id })).status).toBe("waiting");
    const kit = await w.heston.query(api.brandKit.get, { clientId: w.harbor });
    expect(kit).toMatchObject({ colors: [{ hex: "#1F4E79" }, { hex: "#F2B705" }], fonts: { heading: "Montserrat" }, tone: ["Energetic", "Community"], links: [expect.objectContaining({ label: "YouTube" })] });
    const got = await call("get_proposal", { proposal: "WRNGLR-P-0001" });
    expect(got.error).toBe(false);
    expect(got.data).toMatchObject({ number: "WRNGLR-P-0001", status: "waiting", client: { company: "Harbor Coffee" }, investment: { total: 16_400, deposit_percent: 50 }, deck: { kit: "client" } });
    expect(got.data.lines[1]).toMatchObject({ rate: 10_000, suggested_rate: 12_800, overridden: true });
    expect(got.data.answers.find((s: { step: string }) => s.step === "Project").answers).toContainEqual({ question: "Type", answer: "Event coverage" });
    expect(got.data.deck_instructions).toMatch(/Claude Slides/);
    expect((await call("list_proposals", { status: "waiting" })).data.items).toEqual([expect.objectContaining({ proposal: "WRNGLR-P-0001" })]);
    expect((await call("write_proposal_draft", { proposal: "WRNGLR-P-0001", markdown: "# Spirit\n[[signatures heston client]]" })).text).toMatch(/aren't signed/);
    const wrote = await call("write_proposal_draft", { proposal: "WRNGLR-P-0001", markdown: "# Spring at Harbor\n### Overview\nA film for the new menu.\n[[items]]\n| Shooting · 4 days | 1 | 6400 |\n[[payment deposit=50 invoice=no initials=no]]" });
    expect(wrote.error).toBe(false);
    expect(await w.heston.query(api.proposals.get, { proposalId: id })).toMatchObject({ status: "ready", drafted: "claude" });
    await w.heston.mutation(api.proposals.dismissDrafted, { proposalId: id });
    expect((await w.heston.query(api.proposals.get, { proposalId: id })).drafted).toBeNull();
    // The deck's choices are kept for Claude.
    await w.heston.mutation(api.proposals.setDeck, { proposalId: id, kit: "business", note: "Keep it to 8 slides.", asked: true });
    expect((await call("get_proposal", { proposal: "WRNGLR-P-0001" })).data.deck).toEqual({ kit: "business", note: "Keep it to 8 slides." });
  });

  test("T3b.5 another business's questionnaire answers and proposals stay out of reach, through the site and the connector", async () => {
    const w = await world();
    const id = await w.heston.mutation(api.proposals.startQuestionnaire, { clientId: w.harbor }) as Id<"proposals">;
    await expect(w.boss.mutation(api.proposals.saveAnswers, { proposalId: id, answers: {} })).rejects.toThrow();
    await expect(w.boss.mutation(api.proposals.finish, { proposalId: id, how: "self" })).rejects.toThrow();
    await expect(w.maya.query(api.proposals.questionnaire, {})).rejects.toThrow();
    const { key } = await w.boss.action(api.wsConnector.createKey, {});
    const r = await w.t.fetch("/ws-mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_proposal", arguments: { proposal: "WRNGLR-P-0001" } } }) });
    expect((await r.json()).result.isError).toBe(true);
  });

  test("review fixes: nobody else's upload is deleted or borrowed; finishing twice makes one lead; Start the contract twice makes one draft; template prices stay out", async () => {
    const w = await world();
    const file = () => w.t.run((ctx) => ctx.storage.store(new Blob(["x"], { type: "image/png" })));
    const exists = (id: string) => w.t.run(async (ctx) => !!(await ctx.db.system.get(id as Id<"_storage">)));
    const id = await w.heston.mutation(api.proposals.startQuestionnaire, {}) as Id<"proposals">;
    const theirs = await file();
    expect(await w.boss.mutation(api.proposals.addAnswerFile, { proposalId: id, storageId: theirs, name: "x" })).toMatchObject({ error: expect.any(String) });
    await expect(w.t.action(api.proposals.send, { proposalId: id, storageId: theirs })).rejects.toThrow();
    expect(await exists(theirs)).toBe(true); // refused without touching the file
    // A file id typed into the answers by hand is dropped; one uploaded for this proposal is kept.
    const mine = await w.heston.mutation(api.proposals.addAnswerFile, { proposalId: id, storageId: await file(), name: "logo.png" });
    await w.heston.mutation(api.proposals.saveAnswers, { proposalId: id, answers: { ...answers({ mode: "new", company: "Spirit Days", name: "Sam Patel", email: "sam@x.co", saveAs: "lead" }), logo: [mine, { fileId: theirs, name: "theirs", size: 1, type: "image/png" }] } });
    expect((await w.heston.query(api.proposals.get, { proposalId: id })).answers.logo).toEqual([mine]);
    await w.heston.mutation(api.proposals.finish, { proposalId: id, how: "claude" });
    await w.heston.mutation(api.proposals.finish, { proposalId: id, how: "claude" }); // Edit answers, then finish again
    expect((await w.heston.query(api.crm.board, {})).deals).toHaveLength(1);
    // A proposal template keeps no prices, however it's saved.
    const tpl = await w.heston.mutation(api.proposals.newTemplate, {});
    const t0 = await w.heston.query(api.builder.getTemplate, { templateId: tpl });
    const page = pageOf(t0.blocks);
    page.content = page.content.map((n) => n.type === "items" ? { ...n, attrs: { ...n.attrs, rows: [{ id: "r", description: "Shoot", qty: 1, rate: 900 }] } } : n);
    await w.heston.mutation(api.builder.updateTemplate, { templateId: tpl, name: "T", blocks: page, fields: t0.fields, style: t0.style });
    expect(totals(pageOf((await w.heston.query(api.builder.getTemplate, { templateId: tpl })).blocks)).total).toBe(0);
  });
});
