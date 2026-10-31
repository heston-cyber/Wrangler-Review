// The back-office Home (P1 / Owner / Home, page "S5 · Phase 1"): what needs you today, your clients, and recent
// activity across Review, Docs and the Inbox.
import { Suspense, lazy, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, ButtonLink, Card, Divider, InboxItem, ListRow, PageHeader, SectionHead, SkeletonRows, StatusChip } from "../../ui/wp";
import type { IconName } from "../../ui/Icon";
import { useToast } from "../../ui/kit";
import { errText } from "../docs/pages/common";
import { FollowUpRow } from "../crm/common";

// Phase 2b: monthly recurring and any past-due subscription (loaded with the Payments code).
const Recurring = lazy(() => import("../payments/PaymentsOverview").then((m) => ({ default: m.Recurring })));

const TZ = "America/Chicago";
const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const first = (who: string) => who.trim().split(/\s+/)[0] || who;
const ymd = (t: number) => new Date(t).toLocaleDateString("en-CA", { timeZone: TZ });
const monthDay = (t: number) => new Date(t).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" });
const DAY = 86_400_000;

/** "today", "yesterday", "Oct 26": for the line under a row. */
function dayWord(t: number, now = Date.now()) {
  if (ymd(t) === ymd(now)) return "today";
  if (ymd(t) === ymd(now - DAY)) return "yesterday";
  return monthDay(t);
}
/** "10 min", "1h", "Yesterday", "Oct 20": the time on a Recent activity row. */
export function activityWhen(t: number, now = Date.now()) {
  const m = Math.max(0, (now - t) / 60_000);
  if (m < 1) return "Just now";
  if (m < 60) return `${Math.round(m)} min`;
  if (ymd(t) === ymd(now)) return `${Math.round(m / 60)}h`;
  if (ymd(t) === ymd(now - DAY)) return "Yesterday";
  return monthDay(t);
}
function headline(n: number) {
  if (n === 0) return "Nothing needs you today.";
  const w = n < WORDS.length ? WORDS[n] : String(n);
  return n === 1 ? `${w} thing needs you.` : `${w} things need you.`;
}

type Need = NonNullable<ReturnType<typeof useQuery<typeof api.home.needs>>>[number];
type Recent = NonNullable<ReturnType<typeof useQuery<typeof api.activity.recent>>>[number];
type ClientRow = NonNullable<ReturnType<typeof useQuery<typeof api.clients.directory>>>[number];

const VERB = { approve: "approve", send: "send", cancel: "cancel signing of" } as const;

function NeedRow({ n, remind }: { n: Need; remind: (n: Extract<Need, { kind: "doc" }>) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  if (n.kind === "notes") {
    return (
      <ListRow lead={{ avatar: n.who, two: true }} title={`${n.count} new note${n.count === 1 ? "" : "s"} from ${first(n.who)}`}
        meta={`${n.video} · v${n.version} · ${dayWord(n.at)}`}
        action={<ButtonLink size="sm" to={`/v/${n.videoId}?version=${n.version}`}>Open</ButtonLink>} />
    );
  }
  if (n.kind === "doc") {
    const days = Math.floor((Date.now() - n.sentAt) / DAY);
    const dayText = days >= 1 ? `${days} day${days === 1 ? "" : "s"}` : null;
    return (
      <ListRow className="ilead" lead={{ icon: "sign" }}
        title={<><span className="pc-only">{n.title} waiting on {n.waitingOn.map(first).join(" and ")}</span><span className="ph-only">{n.title} waiting</span></>}
        meta={<><span className="pc-only">{n.label} · sent {monthDay(n.sentAt)}{n.client ? ` · ${n.client}` : ""}</span><span className="ph-only">{n.label} · on {n.waitingOn.map(first).join(" and ")}{dayText ? ` · ${dayText}` : ""}</span></>}
        chip={dayText ? <span className="pc-only"><StatusChip tone="warning">{dayText}</StatusChip></span> : undefined}
        action={<Button size="sm" loading={busy} onClick={async () => { setBusy(true); try { await remind(n); } finally { setBusy(false); } }}>Remind</Button>} />
    );
  }
  if (n.kind === "quote") {
    return (
      <ListRow className="ilead" lead={{ icon: n.what === "accepted" ? "check-circle" : "close" }}
        title={`${first(n.who)} ${n.what} quote ${n.number}`} meta={`${n.company} · ${n.title} · ${dayWord(n.at)}`}
        titleChip={<span className="pc-only"><StatusChip tone={n.what === "accepted" ? "success" : "danger"}>{n.what === "accepted" ? "Accepted" : "Declined"}</StatusChip></span>}
        action={<ButtonLink size="sm" variant={n.what === "accepted" ? "primary" : "secondary"} to={`/payments/quotes/${n.quoteId}`}>Open</ButtonLink>} />
    );
  }
  if (n.kind === "proposal") { // Phase 3b: an answered proposal, until the contract starts / Not now, or it's seen
    return (
      <ListRow className="ilead" lead={{ icon: n.what === "accepted" ? "check-circle" : "close" }}
        title={`${first(n.who)} ${n.what} proposal ${n.number}`} meta={`${n.company} · ${n.title} · ${dayWord(n.at)}`}
        titleChip={<span className="pc-only"><StatusChip tone={n.what === "accepted" ? "success" : "danger"}>{n.what === "accepted" ? "Accepted" : "Declined"}</StatusChip></span>}
        action={<ButtonLink size="sm" variant={n.what === "accepted" ? "primary" : "secondary"} to={`/proposals/${n.proposalId}`}>{n.what === "accepted" ? "Start the contract" : "Open"}</ButtonLink>} />
    );
  }
  if (n.kind === "draft") {
    return (
      <ListRow className="ilead" lead={{ icon: "mail" }}
        title={<><span className="pc-only">Note drafted by Claude: confirm to send</span><span className="ph-only">Note drafted by Claude</span></>}
        titleChip={<span className="pc-only"><StatusChip tone="accent">Draft</StatusChip></span>}
        meta={<><span className="pc-only">To {n.client ?? "a client"} · “{n.title}”</span><span className="ph-only">Confirm to send · {n.client ?? "a client"}</span></>}
        action={<ButtonLink size="sm" variant="primary" to={`/sent/new?note=${n.noteId}`}>Review</ButtonLink>} />
    );
  }
  return (
    <ListRow className="ilead" lead={{ icon: "sign" }} title={`Claude asks to ${VERB[n.what]} ${n.label}: confirm`}
      meta={`${n.title} · nothing happens unless you confirm`}
      action={<ButtonLink size="sm" variant="primary" to={`/sign/d/${n.documentId}`}>Review</ButtonLink>} />
  );
}

const RECENT_ICON: Record<Recent["what"], IconName> = {
  watched: "eye", opened: "eye", notes: "note", read: "mail", approved: "check-circle", doc_viewed: "eye", doc_signed: "check-circle", doc_all_signed: "check-circle",
};
function recentTitle(r: Recent) {
  const who = first(r.who);
  switch (r.what) {
    case "watched": return `${who} watched ${r.subject}`;
    case "opened": return `${who} opened ${r.subject}`;
    case "notes": return `${who} left ${r.count ?? 1} note${(r.count ?? 1) === 1 ? "" : "s"}`;
    case "read": return `${who} read your note`;
    case "approved": return `${who} approved ${r.subject}`;
    case "doc_viewed": return `${who} opened ${r.subject}`;
    case "doc_signed": return `${r.subject} signed by ${who}`;
    case "doc_all_signed": return `${r.subject} signed by everyone`;
  }
}
function recentLink(r: Recent) {
  const ref = r.ref as { kind: string; id: string; version?: number };
  if (ref.kind === "video") return `/v/${ref.id}${ref.version ? `?version=${ref.version}` : ""}`;
  if (ref.kind === "document") return `/sign/d/${ref.id}`;
  if (ref.kind === "note") return `/sent/${ref.id}`;
  return "/settings/shares";
}

function waitingChip(c: ClientRow) {
  const parts = [c.toSign > 0 && `${c.toSign} to sign`, c.toReview > 0 && `${c.toReview} to review`].filter(Boolean);
  return parts.length ? <StatusChip tone="warning">{parts.join(" · ")}</StatusChip> : undefined;
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function OwnerHome() {
  const needs = useQuery(api.home.needs);
  const recent = useQuery(api.activity.recent, { limit: 8 });
  const clients = useQuery(api.clients.directory);
  const due = useQuery(api.crm.due, {}); // Phase 3: follow-ups due today or overdue
  const resend = useMutation(api.sign.resend);
  const [toast, show] = useToast();
  const now = Date.now();
  const remind = async (n: Extract<Need, { kind: "doc" }>) => {
    try { await resend({ documentId: n.documentId as Id<"wsDocuments">, signerKey: n.signerKey }); show(`Reminder sent to ${first(n.waitingOn[0])}.`); }
    catch (e) { show(errText(e)); }
  };
  const shownClients = (clients ?? []).slice().sort((a, b) => Number(b.toSign + b.toReview > 0) - Number(a.toSign + a.toReview > 0) || a.name.localeCompare(b.name)).slice(0, 5);
  return (
    <div className="wp-page notop wp-home">
      <PageHeader eyebrow={new Date(now).toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "short", day: "numeric" })} title={needs === undefined ? " " : headline(needs.length)} />
      <div className="wp-homecols">
        <div className="col">
          <Card label="Needs you today" head={<SectionHead label="Needs you today" count={needs?.length ? needs.length : undefined} />}>
            {needs === undefined ? <SkeletonRows n={3} />
              : needs.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "check-circle" }} title="New client notes, documents waiting on clients and drafts to confirm show up here." />
              : needs.map((n, i) => <div key={i} className="wp-rowwrap">{i > 0 && <Divider />}<NeedRow n={n} remind={remind} /></div>)}
          </Card>
          {due && due.length > 0 && (
            <Card label="Follow-ups" head={<SectionHead label="Follow-ups" count={due.length} action={<ButtonLink size="sm" variant="ghost" to="/clients/follow-ups">All follow-ups</ButtonLink>} />}>
              {due.map((f, i) => <div key={f._id} className="wp-rowwrap">{i > 0 && <Divider />}<FollowUpRow f={f} show={show} /></div>)}
            </Card>
          )}
          {clients && clients.length > 0 && (
            <Card className="wp-homeclients" label="Your clients" head={<SectionHead label="Your clients" count={clients.length} action={<ButtonLink size="sm" variant="ghost" to="/clients">All clients</ButtonLink>} />}>
              {shownClients.map((c, i) => (
                <div key={c._id} className="wp-rowwrap">{i > 0 && <Divider />}
                  <ListRow to={`/clients/${c._id}`} lead={{ avatar: c.name, two: true }} title={c.name} meta={`${plural(c.people, "person", "people")} · ${plural(c.projects, "project", "projects")}`} chip={waitingChip(c)} chevron />
                </div>
              ))}
            </Card>
          )}
        </div>
        <div className="col right">
          <Card label="Recent activity" head={<SectionHead label="Recent activity" action={<ButtonLink size="sm" variant="ghost" to="/activity">See all</ButtonLink>} />}>
            {recent === undefined ? <SkeletonRows n={4} />
              : recent.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "activity" }} title="Client views, notes and signatures show up here." />
              : recent.slice(0, 5).map((r, i) => (
                <div key={i} className="wp-rowwrap">{i > 0 && <Divider />}
                  <InboxItem icon={RECENT_ICON[r.what]} title={recentTitle(r)} detail={r.detail ?? undefined} time={activityWhen(r.at, now)} to={recentLink(r)} />
                </div>
              ))}
          </Card>
          <Suspense fallback={null}><Recurring withPastDue /></Suspense>
        </div>
      </div>
      {toast}
    </div>
  );
}
