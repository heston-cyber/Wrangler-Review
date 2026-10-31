// Wrangler Portal Phase 1 (Oct 29): the back-office Home's "Needs you today" card (P1 / Owner / Home).
// Four kinds, in this order:
//   notes    client and guest notes still open with no reply yet, one row per person per version
//   doc      a sent document waiting on a client signer whose turn it is (with Remind)
//   draft    an Inbox note Claude drafted, waiting for you to confirm it on the site
//   request  something Claude asked to do in Sign (approve, send, cancel), waiting for you to confirm
import { query } from "./lib/functions";
import { requireMe } from "./lib/access";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { docLabel, OWNER_KEY } from "./lib/wsLayout";
import { REQUEST_TTL, stillFits } from "./sign";
import { quoteNeeds } from "./quotes";
import { proposalNeeds } from "./proposals";

const MAX_NOTE_GROUPS = 10;

export type Need =
  | { kind: "notes"; at: number; who: string; count: number; videoId: Id<"videos">; video: string; version: number }
  | { kind: "doc"; at: number; documentId: Id<"wsDocuments">; label: string; title: string; waitingOn: string[]; signerKey: string; sentAt: number; client: string | null; lastEmailAt: number | null }
  | { kind: "draft"; at: number; noteId: Id<"inboxNotes">; title: string; client: string | null }
  | { kind: "request"; at: number; documentId: Id<"wsDocuments">; label: string; title: string; what: "approve" | "send" | "cancel" }
  | { kind: "quote"; at: number; quoteId: Id<"quotes">; number: string; company: string; title: string; what: "accepted" | "declined"; who: string } // Phase 3b
  | { kind: "proposal"; at: number; proposalId: Id<"proposals">; number: string; company: string; title: string; what: "accepted" | "declined"; who: string }; // Phase 3b

/** The client a document belongs to: the client of its first signer that's one of a client's people. */
export async function docClient(ctx: QueryCtx, emails: string[]) {
  for (const e of emails) {
    const p = (await ctx.db.query("clientPeople").withIndex("by_email", (q) => q.eq("email", e)).collect()).find((x) => !x.removedAt);
    if (p) return (await ctx.db.get(p.clientId))?.name ?? null;
  }
  return null;
}

export const needs = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const out: Need[] = [];

    // Notes from clients and guests that are still open and haven't had a reply.
    const notes = (await ctx.db.query("notes").order("desc").take(1000)).filter((n) => n.status === "open" && (n.shareId || n.authorKind === "client" || n.authorKind === "guest") && n.authorKind !== "owner");
    const groups = new Map<string, Extract<Need, { kind: "notes" }>>();
    const versions = new Map<string, Doc<"versions"> | null>();
    const videos = new Map<string, Doc<"videos"> | null>();
    for (const n of notes) {
      if ((await ctx.db.query("replies").withIndex("by_note", (q) => q.eq("noteId", n._id)).collect()).some((r) => !r.hidden)) continue;
      const k = `${n.authorName}|${n.versionId}`;
      const g = groups.get(k);
      if (g) { g.count++; continue; }
      if (groups.size >= MAX_NOTE_GROUPS) continue;
      if (!versions.has(n.versionId)) versions.set(n.versionId, await ctx.db.get(n.versionId));
      if (!videos.has(n.videoId)) videos.set(n.videoId, await ctx.db.get(n.videoId));
      const ver = versions.get(n.versionId), vid = videos.get(n.videoId);
      if (!ver || !vid) continue;
      groups.set(k, { kind: "notes", at: n.createdAt, who: n.authorName, count: 1, videoId: vid._id, video: vid.title, version: ver.number });
    }
    out.push(...groups.values());

    // Sent documents waiting on a client signer whose turn it is.
    const now = Date.now();
    for (const d of (await ctx.db.query("wsDocuments").collect()).filter((x) => x.status === "sent" && !(x.expiresAt && x.expiresAt < now))) {
      const sig = (await ctx.db.query("wsSignings").withIndex("by_document", (q) => q.eq("documentId", d._id)).collect()).filter((s) => s.versionNumber === d.sentVersion);
      const waiting = sig.filter((s) => s.status === "sent" && s.signerKey !== OWNER_KEY);
      if (!waiting.length) continue;
      out.push({
        kind: "doc", at: d.sentAt ?? d.updatedAt, documentId: d._id, label: docLabel(d.number), title: d.title,
        waitingOn: waiting.map((s) => s.name), signerKey: waiting[0].signerKey, sentAt: d.sentAt ?? d.updatedAt,
        client: await docClient(ctx, sig.map((s) => s.email)), lastEmailAt: Math.max(...waiting.map((s) => s.lastEmailAt ?? 0)) || null,
      });
    }

    // Claude's drafts and requests: nothing happens until you confirm them on the site.
    for (const n of await ctx.db.query("inboxNotes").withIndex("by_status", (q) => q.eq("status", "draft")).order("desc").collect()) {
      if (n.draftedBy !== "claude") continue;
      out.push({ kind: "draft", at: n.createdAt, noteId: n._id, title: n.title, client: (await ctx.db.get(n.clientId))?.name ?? null });
    }
    for (const r of await ctx.db.query("wsRequests").withIndex("by_status", (q) => q.eq("status", "pending")).order("desc").take(50)) {
      if (now - r.createdAt >= REQUEST_TTL) continue;
      const d = await ctx.db.get(r.documentId);
      if (d && stillFits(r.what, d.status)) out.push({ kind: "request", at: r.createdAt, documentId: d._id, label: docLabel(d.number), title: d.title, what: r.what });
    }

    // Phase 3b: a quote the client answered, until the owner drafts from it (accepted) or has seen it (declined).
    out.push(...(await quoteNeeds(ctx)));
    out.push(...(await proposalNeeds(ctx))); // and a proposal, until the contract starts / Not now (accepted) or it's seen (declined)
    const order = { proposal: 0, quote: 0, notes: 1, doc: 2, draft: 3, request: 4 } as const;
    return out.sort((a, b) => order[a.kind] - order[b.kind] || b.at - a.at);
  },
});
