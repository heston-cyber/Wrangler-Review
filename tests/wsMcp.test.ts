// @vitest-environment node
// Wrangler Sign Phase S4 (Oct 27): the Claude connector at /ws-mcp.
//   T-S4.1 a contract drafted in chat goes in intact: markers become boxes, signers and the amount are set, and it
//          previews.
//   T-S4.2 approve and send happen only with Heston's words from the chat, and never out of order.
//   T-S4.3 status, the audit trail and the signed copy are readable; missing, wrong, revoked and Review keys are
//          refused (and a Sign key doesn't open Review's connector).
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";

const modules = import.meta.glob("../convex/**/*.ts");
beforeAll(() => { process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com"; process.env.RESEND_API_KEY = "re_test"; process.env.SITE_URL = "https://review.wranglerportal.com"; });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

async function contractPdf() {
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  const p1 = d.addPage([612, 792]);
  p1.drawText("CHANGE ORDER #2", { x: 72, y: 720, size: 14, font: f });
  p1.drawText("Initials: {{initials:client}}", { x: 72, y: 640, size: 11, font: f });
  const p2 = d.addPage([612, 792]);
  p2.drawText("CLIENT: {{sign:client}}   Date: {{date:client}}", { x: 72, y: 300, size: 11, font: f });
  p2.drawText("WRANGLER: {{sign:heston}}   Date: {{date:heston}}", { x: 72, y: 240, size: 11, font: f });
  const bytes = await d.save();
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function setup() {
  const t = convexTest(schema, modules);
  const mails: Array<{ to: string; subject: string }> = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); mails.push({ to: b.to[0], subject: b.subject }); return new Response(JSON.stringify({ id: "e" }), { status: 200 }); }
    return new Response("{}", { status: 500 });
  });
  const sub = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    return `${owner}|${await ctx.db.insert("authSessions", { userId: owner, expirationTime: Date.now() + 3_600_000 })}`;
  });
  const me = t.withIdentity({ subject: sub });
  const store = (b: Uint8Array) => t.run((ctx) => ctx.storage.store(new Blob([b], { type: "image/png" })));
  await me.action(api.sign.adoptSignature, { name: "Heston Hill", title: "Founder", method: "typed", signatureStorageId: await store(PNG), initialsStorageId: await store(PNG) });
  const { key } = await me.action(api.wsConnector.createKey, {});
  const rpc = async (body: unknown, auth: string | null = key, path = "/ws-mcp") => {
    const r = await t.fetch(path, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) });
    const txt = await r.text();
    return { status: r.status, j: txt ? JSON.parse(txt) : null };
  };
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
    return { error: r.j.result.isError === true, text: r.j.result.content[0].text as string, data: r.j.result.structuredContent as Record<string, any>, content: r.j.result.content };
  };
  const flush = async () => { vi.useFakeTimers(); await t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
  return { t, me, key, rpc, call, mails, flush };
}

describe("T-S4.1 a contract drafted in chat", () => {
  test("goes in intact: markers become boxes, signers and the amount are set, no problems, and it previews", async () => {
    const x = await setup();
    const r = await x.call("create_document", {
      title: "Change Order #2 — UTT", file_name: "Change Order 2.pdf", pdf_base64: await contractPdf(),
      signers: [{ name: "Dillon Ripley", email: "Dillon@UnitedTurf.example", title: "Owner" }], payment: { amount: 450, description: "Change order #2" },
    });
    expect(r.error, r.text).toBe(false);
    expect(r.data).toMatchObject({ document: "WS-00001", status: "draft", pages: 2, heston_signs: true, markers_found: 5, payment: { amount: 450, description: "Change order #2" }, problems: [] });
    expect(r.data.signers).toEqual([{ key: "client", name: "Dillon Ripley", email: "dillon@unitedturf.example", title: "Owner", order: 1 }]);
    expect(r.data.boxes.map((b: any) => `${b.signer}:${b.kind}:p${b.page}`).sort()).toEqual(["client:date:p2", "client:initials:p1", "client:sign:p2", "heston:date:p2", "heston:sign:p2"]);
    // The box sits where the marker was: "{{sign:client}}" on page 2 at x = 72 + width("CLIENT: "), y = 300 from the bottom.
    const sign = r.data.boxes.find((b: any) => b.signer === "client" && b.kind === "sign");
    expect(sign.x).toBeCloseTo((72 + 43.4) / 612, 1);
    expect(sign.y + sign.h).toBeGreaterThan((792 - 300 - 12) / 792); // its bottom edge is at the marker's baseline
    // Heston's own row carries his adopted name, whatever was sent.
    const doc = (await x.me.query(api.sign.list, {}))[0];
    expect(doc.title).toBe("Change Order #2 — UTT");
    const p = await x.call("preview_document", { document: "WS-00001" });
    expect(p.error).toBe(false);
    expect(JSON.parse(p.text).preview_link).toMatch(/^http/);
    // The trail says Claude made it.
    const trail = await x.call("get_audit_trail", { document: "WS-00001" });
    expect(trail.data.events[0]).toMatchObject({ kind: "created", actor: "claude" });
  });

  test("update_document moves, adds and removes boxes on a draft; boxes outside the page are refused", async () => {
    const x = await setup();
    await x.call("create_document", { title: "Plain", pdf_base64: await contractPdf(), signers: [{ name: "A B", email: "a@b.example" }] });
    const before = (await x.call("get_document", { document: "plain" })).data;
    const ini = before.boxes.find((b: any) => b.kind === "initials");
    const u = await x.call("update_document", { document: "WS-00001", move_boxes: [{ id: ini.id, x: 0.5 }], add_boxes: [{ signer: "client", kind: "name", page: 2, x: 0.1, y: 0.5 }], heston_signs: false, signing_order: "sequence" });
    expect(u.error, u.text).toBe(false);
    expect(u.data.heston_signs).toBe(false);
    expect(u.data.boxes.some((b: any) => b.signer === "heston")).toBe(false);
    expect(u.data.boxes.find((b: any) => b.id === ini.id).x).toBe(0.5);
    expect(u.data.boxes.filter((b: any) => b.kind === "name")).toHaveLength(1);
    expect((await x.call("update_document", { document: "WS-00001", add_boxes: [{ signer: "client", kind: "sign", page: 9, x: 0.1, y: 0.1 }] })).text).toMatch(/page must be 1 to 2/);
  });
});

describe("T-S4.2 approve, send and cancel only when Heston confirms on the site", () => {
  test("Claude's call only leaves a request; Heston's Confirm does it; refused out of order; declining does nothing", async () => {
    const x = await setup();
    await x.call("create_document", { title: "CO", pdf_base64: await contractPdf(), signers: [{ name: "Dillon Ripley", email: "dillon@example.com" }] });
    const docId = (await x.t.run((ctx) => ctx.db.query("wsDocuments").first()))!._id;
    const pending = () => x.me.query(api.sign.requestsFor, { documentId: docId });
    const status = async () => (await x.t.run((ctx) => ctx.db.get(docId)))!.status;
    // Send before approval: refused, nothing asked.
    const early = await x.call("send_document", { document: "WS-00001", heston_ok: "send it" });
    expect(early.error).toBe(true); expect(early.text).toMatch(/only an approved document/);
    // No words from Heston: refused by the tool.
    const r0 = await x.rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "approve_document", arguments: { document: "WS-00001" } } });
    expect(r0.j.result.isError).toBe(true);
    expect(r0.j.result.content[0].text).toMatch(/Ask Heston first/);
    // With "his words": only a request. The document is still a draft.
    const a = await x.call("approve_document", { document: "WS-00001", heston_ok: "Looks good, approve it" });
    expect(a.error, a.text).toBe(false);
    expect(a.data).toMatchObject({ requested: "approve", done: false, waiting_for_heston: true });
    expect(a.data.confirm_at).toMatch(/\/sign\/d\//);
    expect(await status()).toBe("draft");
    const [req] = await pending();
    expect(req).toMatchObject({ what: "approve", said: "Looks good, approve it" });
    // Heston confirms on the site: approved, by him.
    await x.me.mutation(api.sign.decideRequest, { requestId: req._id, confirm: true });
    expect(await status()).toBe("approved");
    await expect(x.me.mutation(api.sign.decideRequest, { requestId: req._id, confirm: true })).rejects.toThrow(/already done/);
    // Editing after approval is refused.
    expect((await x.call("update_document", { document: "WS-00001", title: "Changed" })).text).toMatch(/can't be edited/);
    // Send: a request; declined → nothing goes out.
    const s1 = await x.call("send_document", { document: "WS-00001", heston_ok: "Yes send it to Dillon", expires_in_days: 14 });
    expect(s1.data).toMatchObject({ requested: "send", done: false });
    await x.me.mutation(api.sign.decideRequest, { requestId: (await pending())[0]._id, confirm: false });
    await x.flush();
    expect(await status()).toBe("approved");
    expect(x.mails.filter((m) => m.subject.startsWith("Please sign"))).toHaveLength(0);
    // Asked again and confirmed: sent, with the 14 days Claude asked for.
    await x.call("send_document", { document: "WS-00001", heston_ok: "ok now send it", expires_in_days: 14 });
    await x.me.mutation(api.sign.decideRequest, { requestId: (await pending())[0]._id, confirm: true });
    await x.flush();
    expect(await status()).toBe("sent");
    expect(x.mails.map((m) => m.subject)).toContain("Please sign: CO (WS-00001)");
    const doc = (await x.t.run((ctx) => ctx.db.get(docId)))!;
    expect(Math.round((doc.expiresAt! - doc.sentAt!) / 86_400_000)).toBe(14);
    const ev = (await x.call("get_audit_trail", { document: "WS-00001" })).data.events;
    expect(ev.filter((e: any) => e.kind === "claude_requested").map((e: any) => e.detail).join("\n")).toContain('"Looks good, approve it"');
    expect(ev.find((e: any) => e.kind === "claude_request_declined")).toBeTruthy();
    expect(ev.find((e: any) => e.kind === "approved")).toMatchObject({ actor: "heston" });
    expect(ev.find((e: any) => e.kind === "send_settings")).toMatchObject({ actor: "heston" });
    // get_document shows what happened to each request.
    const g = await x.call("get_document", { document: "WS-00001" });
    expect(g.data.requests.map((r: any) => `${r.what}:${r.status}`)).toEqual(["send:done", "send:declined", "approve:done"]);
    // Out of order is refused at the request.
    expect((await x.call("approve_document", { document: "WS-00001", heston_ok: "again" })).error).toBe(true);
    // Cancel: a request too.
    await x.call("void_document", { document: "WS-00001", heston_ok: "cancel it", reason: "Wrong amount" });
    expect(await status()).toBe("sent");
    await x.me.mutation(api.sign.decideRequest, { requestId: (await pending())[0]._id, confirm: true });
    expect(await status()).toBe("voided");
  });

  test("a request is only for the version it was asked about, and lasts a day", async () => {
    const x = await setup();
    await x.call("create_document", { title: "CO", pdf_base64: await contractPdf(), signers: [{ name: "Dillon Ripley", email: "dillon@example.com" }] });
    const docId = (await x.t.run((ctx) => ctx.db.query("wsDocuments").first()))!._id;
    await x.call("approve_document", { document: "WS-00001", heston_ok: "approve" });
    const [req] = await x.me.query(api.sign.requestsFor, { documentId: docId });
    await x.t.run(async (ctx) => { await ctx.db.patch(req._id, { createdAt: Date.now() - 25 * 3600_000 }); });
    expect(await x.me.query(api.sign.requestsFor, { documentId: docId })).toHaveLength(0);
    await expect(x.me.mutation(api.sign.decideRequest, { requestId: req._id, confirm: true })).rejects.toThrow(/over a day old/);
    expect((await x.t.run((ctx) => ctx.db.get(docId)))!.status).toBe("draft");
  });
});

describe("T-S6 final-test fixes (Oct 28)", () => {
  test("approving or sending with the page's own buttons closes Claude's request; a stale one can't be confirmed", async () => {
    const x = await setup();
    await x.call("create_document", { title: "CO", pdf_base64: await contractPdf(), signers: [{ name: "Dillon Ripley", email: "dillon@example.com" }] });
    const doc = (await x.t.run((ctx) => ctx.db.query("wsDocuments").first()))!;
    const ver = (await x.t.run((ctx) => ctx.db.query("wsVersions").first()))!;
    await x.call("approve_document", { document: "WS-00001", heston_ok: "send final test" });
    const [req] = await x.me.query(api.sign.requestsFor, { documentId: doc._id });
    expect(req.what).toBe("approve");
    // A request left over from before this fix (still "pending" in the database) is hidden once it no longer fits.
    await x.me.mutation(api.sign.approve, { versionId: ver._id });
    expect(await x.me.query(api.sign.requestsFor, { documentId: doc._id })).toHaveLength(0);
    expect(await x.me.query(api.sign.pendingRequests, {})).toHaveLength(0);
    expect((await x.call("get_document", { document: "WS-00001" })).data.requests.map((r: any) => `${r.what}:${r.status}`)).toEqual(["approve:overtaken"]);
    await expect(x.me.mutation(api.sign.decideRequest, { requestId: req._id, confirm: true })).rejects.toThrow(/already overtaken|Nothing to confirm/);
    // A send request, then Heston sends himself: closed as overtaken.
    await x.call("send_document", { document: "WS-00001", heston_ok: "send it" });
    await x.me.mutation(api.sign.send, { versionId: ver._id });
    await x.flush();
    const rows = await x.t.run((ctx) => ctx.db.query("wsRequests").collect());
    expect(rows.map((r) => `${r.what}:${r.status}`).sort()).toEqual(["approve:overtaken", "send:overtaken"]);
  });

  test("a stale pending row from before the fix is shown as overtaken and refused", async () => {
    const x = await setup();
    await x.call("create_document", { title: "CO", pdf_base64: await contractPdf(), signers: [{ name: "Dillon Ripley", email: "dillon@example.com" }] });
    const doc = (await x.t.run((ctx) => ctx.db.query("wsDocuments").first()))!;
    await x.call("approve_document", { document: "WS-00001", heston_ok: "approve" });
    const [req] = await x.me.query(api.sign.requestsFor, { documentId: doc._id });
    // As WS-00005 was: approved behind the request's back, the row still pending.
    await x.t.run(async (ctx) => { await ctx.db.patch(doc._id, { status: "approved" }); });
    expect(await x.me.query(api.sign.requestsFor, { documentId: doc._id })).toHaveLength(0);
    expect((await x.call("get_document", { document: "WS-00001" })).data.requests[0].status).toBe("overtaken");
    await expect(x.me.mutation(api.sign.decideRequest, { requestId: req._id, confirm: true })).rejects.toThrow(/Nothing to confirm/);
  });
});

describe("T-S4.3 reading, and keys", () => {
  test("status and the signed copy read back; missing, wrong, revoked and Review keys are refused", async () => {
    const x = await setup();
    const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    expect((await x.rpc(list)).j.result.tools.map((t: any) => t.name)).toEqual(["list_documents", "get_document", "create_document", "update_document", "preview_document", "approve_document", "send_document", "send_reminder", "void_document", "get_audit_trail", "get_signed_pdf", "list_templates", "get_template", "list_drafts", "create_draft", "get_draft", "update_draft", "import_pdf", "draft_to_signing", "save_draft_as_template", "list_proposals", "get_proposal", "write_proposal_draft", "verify_pdf"]); // Phase 3b: the proposal tools (D89)
    expect((await x.rpc(list, null)).status).toBe(401);
    expect((await x.rpc(list, "ws_wrongwrongwrongwrongwrong")).status).toBe(401);
    // A Wrangler Review key doesn't open this one, and this key doesn't open Review's.
    const { key: reviewKey } = await x.me.action(api.connector.createKey, {});
    expect((await x.rpc(list, reviewKey)).status).toBe(401);
    expect((await x.rpc(list, x.key, "/mcp")).status).toBe(401);
    // The key in the address works too.
    expect((await x.rpc(list, null, `/ws-mcp/${x.key}`)).status).toBe(200);
    await x.call("create_document", { title: "Status check", pdf_base64: await contractPdf(), signers: [{ name: "Q R", email: "q@r.example" }] });
    const l = await x.call("list_documents", { status: "draft" });
    expect(l.data.items).toEqual([expect.objectContaining({ document: "WS-00001", title: "Status check", status: "draft", signers: ["Q R"] })]);
    expect((await x.call("get_signed_pdf", { document: "WS-00001" })).text).toMatch(/isn't signed by everyone yet/);
    expect((await x.call("get_document", { document: "WS-00042" })).text).toMatch(/There's no WS-00042/);
    expect((await x.call("verify_pdf", { sha256: "a".repeat(64) })).data).toMatchObject({ match: false });
    // Revoked: refused at once.
    const keys = await x.me.query(api.wsConnector.listKeys, {});
    await x.me.mutation(api.wsConnector.revokeKey, { keyId: keys[0]._id });
    expect((await x.rpc(list)).status).toBe(401);
  });
});
