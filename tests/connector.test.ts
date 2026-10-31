// The Claude connector: keys, the /mcp endpoint, and what its tools hand back.
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
beforeAll(() => { process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com"; });

const META = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} };

async function setup() {
  const t = convexTest(schema, modules);
  const mk = async (email: string, name?: string) => {
    const { userId, sessionId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email, ...(name ? { name } : {}) });
      const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 });
      return { userId, sessionId };
    });
    return t.withIdentity({ subject: `${userId}|${sessionId}` });
  };
  const me = await mk("heston@wranglerproductions.com", "Heston");
  const other = await mk("someone@else.com");
  const projectId = await me.mutation(api.library.createProject, { name: "Spirit Airlines", jobNumber: "26122" });
  const videoId = await me.mutation(api.library.createVideo, { projectId, title: "Spirit Intro" });
  const { versionId } = await t.mutation(internal.library.insertVersion, { videoId, bunnyGuid: "g1", fileName: "spirit_v1.mp4" });
  await t.run(async (ctx) => { await ctx.db.patch(versionId, { status: "ready", fpsNum: 24000, fpsDen: 1001, frameCount: 3149, frameCountFrom: "file", startTimecode: "01:00:00:00" }); });
  const n1 = await me.mutation(api.notes.create, { versionId, kind: "frame", inFrame: 400, text: "Logo too small" });
  const n2 = await me.mutation(api.notes.create, { versionId, kind: "range", inFrame: 1000, outFrame: 1047, text: "Tighten this" });
  const n3 = await me.mutation(api.notes.create, { versionId, kind: "general", text: "Music a touch loud" });
  const { key } = await me.action(api.connector.createKey, {});
  return { t, me, other, key, videoId, versionId, notes: [n1, n2, n3] as string[] };
}

type Opts = { key?: string | null; headers?: Record<string, string>; path?: string };
async function rpc(t: ReturnType<typeof convexTest>, body: unknown, o: Opts = {}) {
  const res = await t.fetch(o.path ?? "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...(o.key ? { authorization: `Bearer ${o.key}` } : {}), ...(o.headers ?? {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, j: text ? JSON.parse(text) : null };
}
const call = (t: ReturnType<typeof convexTest>, key: string, name: string, args: Record<string, unknown> = {}) =>
  rpc(t, { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args, _meta: META } }, { key, headers: { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": name } });

describe("connector keys", () => {
  test("only the allowed account makes keys; a key is shown once and only its start is listed", async () => {
    const { t, me, other, key } = await setup();
    expect(key).toMatch(/^wr_[A-Za-z0-9_-]{40,}$/);
    const keys = await me.query(api.connector.listKeys, {});
    expect(keys).toHaveLength(1);
    expect(keys[0].prefix).toBe(key.slice(0, 10));
    expect(JSON.stringify(keys)).not.toContain(key);
    const stored = await t.run((ctx) => ctx.db.query("connectorKeys").collect());
    expect(JSON.stringify(stored)).not.toContain(key);
    await expect(other.action(api.connector.createKey, {})).rejects.toThrow(/Not allowed/);
    await expect(other.query(api.connector.listKeys, {})).rejects.toThrow(/Not allowed/);
  });

  test("no key, a wrong key and a revoked key are all refused", async () => {
    const { t, me, key } = await setup();
    const list = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
    expect((await rpc(t, list)).status).toBe(401);
    expect((await rpc(t, list, { key: "wr_" + "x".repeat(43) })).status).toBe(401);
    expect((await rpc(t, list, { key })).status).toBe(200);
    expect((await rpc(t, list, { headers: { "x-api-key": key } })).status).toBe(200);
    expect((await rpc(t, list, { path: `/mcp/${key}` })).status).toBe(200);
    const [k] = await me.query(api.connector.listKeys, {});
    expect(k.lastUsedAt).not.toBeNull();
    await me.mutation(api.connector.revokeKey, { keyId: k._id });
    expect((await rpc(t, list, { key })).status).toBe(401);
    expect((await rpc(t, list, { path: `/mcp/${key}` })).status).toBe(401);
    expect(await me.query(api.connector.listKeys, {})).toHaveLength(0);
  });

  test("a site Claude doesn't run on can't call it from a browser", async () => {
    const { t, key } = await setup();
    const list = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
    expect((await rpc(t, list, { key, headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await rpc(t, list, { key, headers: { origin: "https://claude.ai" } })).status).toBe(200);
  });
});

describe("MCP protocol", () => {
  test("older clients: initialize, notification, tools/list", async () => {
    const { t, key } = await setup();
    const init = await rpc(t, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c", version: "1" } } }, { key });
    expect(init.status).toBe(200);
    expect(init.j.result.protocolVersion).toBe("2025-06-18");
    expect(init.j.result.serverInfo.name).toBe("wrangler-review");
    expect(init.j.result.instructions).toMatch(/get_notes/);
    const unknownVer = await rpc(t, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-01-01" } }, { key });
    expect(unknownVer.j.result.protocolVersion).toBe("2025-11-25");
    expect((await rpc(t, { jsonrpc: "2.0", method: "notifications/initialized" }, { key })).status).toBe(202);
    const list = await rpc(t, { jsonrpc: "2.0", id: 2, method: "tools/list" }, { key });
    expect(list.j.result.tools.map((x: { name: string }) => x.name)).toEqual(["find_videos", "get_notes", "get_note_images", "get_resolve_markers", "get_transcript", "reply_to_note", "mark_notes", "register_video", "add_to_register", "next_render_name", "set_version_description", "get_client_inbox", "list_follow_ups", "draft_follow_up", "draft_ledger_entry", "draft_client_note"]);
    expect(list.j.result.resultType).toBeUndefined();
    const batch = await rpc(t, [{ jsonrpc: "2.0", id: 3, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }], { key });
    expect(batch.j).toEqual([{ jsonrpc: "2.0", id: 3, result: {} }]);
    const nope = await rpc(t, { jsonrpc: "2.0", id: 4, method: "resources/list" }, { key });
    expect([nope.status, nope.j.error.code]).toEqual([200, -32601]);
  });

  test("2026-07-28 clients: discover, version and header checks", async () => {
    const { t, key } = await setup();
    const d = await rpc(t, { jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: META } }, { key, headers: { "mcp-protocol-version": "2026-07-28", "mcp-method": "server/discover" } });
    expect(d.status).toBe(200);
    expect(d.j.result.resultType).toBe("complete");
    expect(d.j.result.supportedVersions).toContain("2026-07-28");
    expect(d.j.result._meta["io.modelcontextprotocol/serverInfo"].name).toBe("wrangler-review");
    const l = await rpc(t, { jsonrpc: "2.0", id: 2, method: "tools/list", params: { _meta: META } }, { key });
    expect(l.j.result.ttlMs).toBeGreaterThan(0);
    expect(l.j.result.tools).toHaveLength(16);
    const bad = await rpc(t, { jsonrpc: "2.0", id: 3, method: "tools/list", params: { _meta: { ...META, "io.modelcontextprotocol/protocolVersion": "2099-01-01" } } }, { key });
    expect([bad.status, bad.j.error.code]).toEqual([400, -32022]);
    expect(bad.j.error.data.supported).toContain("2026-07-28");
    const mm = await rpc(t, { jsonrpc: "2.0", id: 4, method: "tools/list", params: { _meta: META } }, { key, headers: { "mcp-method": "tools/call" } });
    expect([mm.status, mm.j.error.code]).toEqual([400, -32020]);
    const nm = await rpc(t, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "find_videos", arguments: {}, _meta: META } }, { key, headers: { "mcp-name": "get_notes" } });
    expect([nm.status, nm.j.error.code]).toEqual([400, -32020]);
    const b64 = await rpc(t, { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "find_videos", arguments: {}, _meta: META } }, { key, headers: { "mcp-name": `=?base64?${btoa("find_videos")}?=` } });
    expect(b64.status).toBe(200);
    const nf = await rpc(t, { jsonrpc: "2.0", id: 7, method: "resources/list", params: { _meta: META } }, { key });
    expect([nf.status, nf.j.error.code]).toEqual([404, -32601]);
    expect((await t.fetch("/mcp", { method: "GET", headers: { authorization: `Bearer ${key}` } })).status).toBe(405);
  });
});

describe("tools", () => {
  test("find_videos and get_notes give exact frames, timecodes and the render's details", async () => {
    const { t, key, videoId } = await setup();
    const f = await call(t, key, "find_videos", { query: "26122" });
    expect(f.j.result.structuredContent.items.map((x: { title: string }) => x.title)).toEqual(["Spirit Intro"]);
    expect(f.j.result.structuredContent.items[0].versions[0]).toMatchObject({ number: 1, open_notes: 3, total_notes: 3 });
    const g = await call(t, key, "get_notes", { video: "spirit intro" });
    const sc = g.j.result.structuredContent;
    expect(sc.video.video_id).toBe(videoId);
    expect(sc.version).toMatchObject({ number: 1, frame_rate: 23.976, frame_rate_exact: "24000/1001", start_timecode: "01:00:00:00", frame_count: 3149, frame_count_exact: true, last_frame_timecode: "01:02:11:04" });
    expect(sc.notes.map((n: Record<string, unknown>) => [n.type, n.in_frame, n.out_frame, n.length_frames, n.in_timecode, n.out_timecode])).toEqual([
      ["whole_video", null, null, null, null, null],
      ["frame", 400, 400, 1, "01:00:16:16", "01:00:16:16"],
      ["range", 1000, 1047, 48, "01:00:41:16", "01:00:43:15"],
    ]);
    expect(sc.notes[1].link).toMatch(/\/v\/.+\?version=1&note=/);
    expect(g.j.result.content[0].type).toBe("text");
  });

  test("an unclear video name asks which one", async () => {
    const { t, me, key } = await setup();
    const p2 = await me.mutation(api.library.createProject, { name: "Other" });
    await me.mutation(api.library.createVideo, { projectId: p2, title: "Spirit Outro" });
    const g = await call(t, key, "get_notes", { video: "spirit" });
    expect(g.j.result.isError).toBe(true);
    expect(g.j.result.content[0].text).toMatch(/More than one video/);
    expect(g.j.result.content[0].text).toMatch(/Spirit Outro/);
    const none = await call(t, key, "get_notes", { video: "nothing like it" });
    expect(none.j.result.isError).toBe(true);
    const v9 = await call(t, key, "get_notes", { video: "spirit intro", version: 9 });
    expect(v9.j.result.content[0].text).toMatch(/no v9/);
  });

  test("get_resolve_markers: Resolve colours, durations and the EDL", async () => {
    const { t, key } = await setup();
    const m = await call(t, key, "get_resolve_markers", { video: "spirit intro" });
    const sc = m.j.result.structuredContent;
    expect(sc.markers.map((x: Record<string, unknown>) => [x.frame, x.timecode, x.duration_frames, x.color])).toEqual([
      [0, "01:00:00:00", 1, "Green"],
      [400, "01:00:16:16", 1, "Blue"],
      [1000, "01:00:41:16", 48, "Yellow"],
    ]);
    expect(sc.markers[1].custom_data).toBe(sc.markers[1].note_ids.join(","));
    expect(sc.render.frame_count).toBe(3149);
    expect(sc.placement.join(" ")).toMatch(/start timecode/);
    expect(sc.edl).toMatch(/ResolveColorBlue/);
    expect(sc.edl).toMatch(/\|D:48/);
  });

  test("notes that start on the same frame share one marker (Resolve allows one per frame)", async () => {
    const { t, me, key, versionId } = await setup();
    await me.mutation(api.notes.create, { versionId, kind: "range", inFrame: 400, outFrame: 423, text: "Hold this a second" });
    await me.mutation(api.notes.create, { versionId, kind: "frame", inFrame: 0, text: "First frame" });
    const m = await call(t, key, "get_resolve_markers", { video: "spirit intro" });
    const sc = m.j.result.structuredContent;
    expect(sc.markers.map((x: Record<string, unknown>) => [x.frame, x.duration_frames, x.color, (x.note_ids as string[]).length])).toEqual([
      [0, 1, "Blue", 2],
      [400, 24, "Yellow", 2],
      [1000, 48, "Yellow", 1],
    ]);
    expect(new Set(sc.markers.map((x: { frame: number }) => x.frame)).size).toBe(sc.markers.length);
    expect(sc.markers[1].custom_data.split(",")).toHaveLength(2);
    expect(sc.markers[1].name).toMatch(/^2 notes: /);
    expect(sc.markers[1].note).toMatch(/Range 24f → 01:00:17:15: Hold this a second/);
  });

  test("reply_to_note and mark_notes write back to the site", async () => {
    const { t, me, key, versionId, notes } = await setup();
    const r = await call(t, key, "reply_to_note", { note_id: notes[0], text: "Logo scaled up 20%." });
    expect(r.j.result.isError).toBeUndefined();
    const m = await call(t, key, "mark_notes", { note_ids: [notes[0], "nope"], status: "done" });
    expect(m.j.result.structuredContent).toMatchObject({ status: "done", changed: [notes[0]], missing: ["nope"] });
    const list = await me.query(api.notes.forVersion, { versionId });
    const n = list.find((x) => x._id === notes[0])!;
    expect(n.status).toBe("done");
    expect(n.replies.map((x: { authorName: string; text: string }) => [x.authorName, x.text])).toEqual([["Claude", "Logo scaled up 20%."]]);
    const open = await call(t, key, "get_notes", { video: "spirit intro" });
    expect(open.j.result.structuredContent.notes).toHaveLength(2);
    const bad = await call(t, key, "reply_to_note", { note_id: "not-a-note", text: "x" });
    expect(bad.j.result.isError).toBe(true);
    const unknown = await rpc(t, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "delete_everything", arguments: {}, _meta: META } }, { key });
    expect(unknown.j.error.code).toBe(-32602);
  });
});

describe("acceptance test data", () => {
  test("seed copies the real notes, adds 11, and leaves the real video alone; remove cleans up", async () => {
    const { t, videoId } = await setup();
    const res = await t.mutation(internal.testdata.seedConnectorTest, { sourceVideoId: videoId as never });
    expect(res).toMatchObject({ already: false, copied: 3, added: 11, total: 14 });
    const again = await t.mutation(internal.testdata.seedConnectorTest, { sourceVideoId: videoId as never });
    expect(again.already).toBe(true);
    const counts = await t.run(async (ctx) => {
      const notes = await ctx.db.query("notes").collect();
      return { all: notes.length, real: notes.filter((n) => n.videoId === videoId).length };
    });
    expect(counts).toEqual({ all: 17, real: 3 });
    expect((await t.mutation(internal.testdata.removeConnectorTest, {})).removed).toBe(14);
    expect(await t.run(async (ctx) => (await ctx.db.query("notes").collect()).length)).toBe(3);
  });
});
