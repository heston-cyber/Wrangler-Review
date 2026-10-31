// The client page (P1 / Owner / Client page): tabs Overview · Projects · Shared · Documents · Their Inbox. Their Inbox
// shows exactly what one of their people sees. Phase 3 (P3 / Owner / Company, 262:32550) makes it the company page:
// Add follow-up and New estimate in the header, billed · paid · outstanding, and Deals and Follow-ups on Overview.
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Avatar, Button, ButtonLink, Card, Checkbox, Divider, EmptyState, InboxItem, ListRow, SectionHead, Segmented, SkeletonRows, StatusChip, Tabs, TextField, Toggle } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { ShareDialog } from "../review/Share";
import { errText } from "../docs/pages/common";
import { INBOX_ICON, dayWord, firstName, itemDetail, monthDay, type InboxKind } from "../inbox/common";
import { money } from "../payments/common";
import { AddFollowUp, FollowUpRow } from "../crm/common";
import { BrandKitEditor } from "../settings/BrandKit";

type Page = NonNullable<ReturnType<typeof useQuery<typeof api.clients.page>>>;
type Person = Page["people"][number];
type Shared = Page["shared"][number];
type Doc = Page["documents"][number];
type Event = NonNullable<ReturnType<typeof useQuery<typeof api.inbox.forClient>>>[number];
export type ClientTab = "overview" | "projects" | "shared" | "documents" | "inbox" | "brand" | "settings";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const ROLE = { signer: "Signs documents", contact: "Contact" } as const;
const rows = <T,>(list: T[], render: (x: T, i: number) => React.ReactNode, key: (x: T, i: number) => string) =>
  list.map((x, i) => <div key={key(x, i)} className="wp-rowwrap">{i > 0 && <Divider />}{render(x, i)}</div>);

// ---------- People ----------
function accessText(p: Person) {
  if (p.access.state === "active") return "Active";
  if (p.access.state === "invited") return <><span className="pc-only">invited {monthDay(p.access.at)}</span><span className="ph-only">Invited</span></>;
  return "not invited";
}
function PersonRow({ p, show }: { p: Person; show: (m: string) => void }) {
  const invite = useMutation(api.clients.invitePerson);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { const r = await invite({ personId: p._id }); show(r.already ? `Invite kept for ${p.email}.` : `${p.name ?? p.email} is invited.`); }
    catch (e) { show(errText(e)); } finally { setBusy(false); }
  };
  return (
    <ListRow lead={{ avatar: p.name ?? p.email, two: true }} title={<a className="cp-person" {...linkProps(`/clients/people/${p._id}`)}>{p.name ?? p.email}</a>} meta={<>{ROLE[p.role]} · {accessText(p)}</>}
      chip={p.access.state === "active" ? <span className="pc-only"><StatusChip tone="success">Active</StatusChip></span> : undefined}
      action={p.access.state === "active" ? undefined : (
        <Button size="sm" loading={busy} onClick={() => void go()}>
          {p.access.state === "invited" ? <><span className="pc-only">Resend invite</span><span className="ph-only">Resend</span></> : <><span className="pc-only">Invite to the portal</span><span className="ph-only">Invite</span></>}
        </Button>
      )} />
  );
}
function AddPerson({ clientId, client, onClose, show }: { clientId: Id<"clients">; client: string; onClose: () => void; show: (m: string) => void }) {
  const add = useMutation(api.clients.addPerson);
  const invite = useMutation(api.clients.invitePerson);
  const [name, setName] = useState(""), [email, setEmail] = useState("");
  const [role, setRole] = useState<"signer" | "contact">("contact");
  const [portal, setPortal] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  return (
    <Modal onClose={onClose} label="Add a person" width={520}>
      <form style={{ display: "grid", gap: 18 }} onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try {
          const personId = await add({ clientId, email, name: name || undefined, role });
          if (portal) await invite({ personId });
          show(portal ? `${name.trim() || email.trim()} is added and invited.` : `${name.trim() || email.trim()} is added.`); onClose();
        } catch (err) { setError(errText(err)); setBusy(false); }
      }}>
        <div className="dhead">
          <div style={{ display: "grid", gap: 6 }}>
            <span className="eyebrow">{client}</span>
            <h2 className="headline">Add a person.</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoFocus />
        <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
        <div className="wp-field"><span className="wp-field-label">Role</span>
          <Segmented label="Role" value={role} onChange={setRole} items={[{ key: "signer", label: "Signs documents" }, { key: "contact", label: "Contact" }]} />
        </div>
        <Checkbox checked={portal} onChange={setPortal} label="Invite to the portal" hint="They can make an account with this email and see what you share with them." />
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" type="submit" loading={busy} disabled={!email.trim()}>Add person</Button>
        </div>
      </form>
    </Modal>
  );
}
function PeopleCard({ page, show, onAdd }: { page: Page; show: (m: string) => void; onAdd: () => void }) {
  return (
    <Card className="cp-people" label="People" head={<SectionHead label="People" count={page.people.length} action={<Button size="sm" variant="ghost" icon="plus" onClick={onAdd}>Add a person</Button>} />}>
      {page.people.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "users" }} title="No one yet. Add the people who sign documents or get updates." />
        : rows(page.people, (p) => <PersonRow p={p} show={show} />, (p) => p._id)}
    </Card>
  );
}

// ---------- Projects, Shared, Documents ----------
function ProjectRows({ page, max }: { page: Page; max?: number }) {
  const list = max ? page.projects.slice(0, max) : page.projects;
  if (!list.length) return <ListRow className="ilead quiet" lead={{ icon: "folder" }} title="No projects yet." />;
  return <>{rows(list, (p) => (
    <ListRow to={`/projects/${p._id}`} lead={{ thumb: p.thumbUrl, size: 64 }} title={p.jobNumber ? `${p.jobNumber} ${p.name}` : p.name}
      meta={p.shared ? `${plural(p.videos, "video", "videos")} · updated ${dayWord(p.updatedAt)}` : "Nothing shared yet"} chevron />
  ), (p) => p._id)}</>;
}
function sharedChip(s: Shared) {
  if (s.state === "approved") return <StatusChip tone="success">Approved</StatusChip>;
  if (s.state === "notes") return <StatusChip tone="accent">{plural(s.notes, "note", "notes")}</StatusChip>;
  if (s.state === "watched") return <StatusChip tone="neutral">Watched</StatusChip>;
  return <StatusChip tone="neutral">Not watched</StatusChip>;
}
const sharedShort = (s: Shared) => (s.state === "approved" ? "approved" : s.state === "notes" ? plural(s.notes, "note", "notes") : s.state === "watched" ? "watched" : "not watched");
function SharedRows({ page, max }: { page: Page; max?: number }) {
  const list = max ? page.shared.slice(0, max) : page.shared;
  if (!list.length) return <ListRow className="ilead quiet" lead={{ icon: "send" }} title="Nothing shared with them yet." />;
  return <>{rows(list, (s) => (
    <ListRow to={`/v/${s.videoId}?version=${s.number}`} lead={{ thumb: s.thumbUrl, size: 64 }}
      title={<><span className="pc-only">{s.title} · v{s.number}</span><span className="ph-only">{s.title}</span></>}
      meta={<><span className="pc-only">{s.fileName ? `${s.fileName.replace(/\.[a-z0-9]+$/i, "")} · ` : ""}shared {dayWord(s.sharedAt)}</span><span className="ph-only">v{s.number} · {sharedShort(s)}</span></>}
      chip={<span className="pc-only">{sharedChip(s)}</span>} trailing={<span className="ph-only"><Icon name="chevron-right" size={16} className="chev" /></span>} />
  ), (s) => s.versionId)}</>;
}
function docChip(d: Doc) {
  if (d.status === "completed") return <StatusChip tone="success">Signed</StatusChip>;
  if (d.status === "voided") return <StatusChip tone="neutral">Cancelled</StatusChip>;
  return <StatusChip tone="warning">To sign</StatusChip>;
}
function docMeta(d: Doc) {
  if (d.status === "completed") return { pc: `Signed ${monthDay(d.completedAt ?? d.sentAt ?? 0)}`, ph: `${d.label} · signed ${monthDay(d.completedAt ?? d.sentAt ?? 0)}` };
  if (d.status === "voided") return { pc: `Cancelled ${monthDay(d.voidedAt ?? d.sentAt ?? 0)}`, ph: `${d.label} · cancelled` };
  const waiting = d.waitingOn.length ? ` · waiting on ${d.waitingOn.map(firstName).join(" and ")}` : "";
  return { pc: `Sent ${monthDay(d.sentAt ?? 0)}${waiting}`, ph: `${d.label} · to sign` };
}
function DocRows({ page, max }: { page: Page; max?: number }) {
  const list = max ? page.documents.slice(0, max) : page.documents;
  if (!list.length) return <ListRow className="ilead quiet" lead={{ icon: "document" }} title="No documents sent to them yet." />;
  return <>{rows(list, (d) => {
    const m = docMeta(d);
    return (
      <ListRow to={`/sign/d/${d._id}`} className="ilead" lead={{ icon: d.status === "completed" ? "check-circle" : d.status === "voided" ? "close" : "sign" }}
        title={<><span className="pc-only">{d.label} · {d.title}</span><span className="ph-only">{d.title}</span></>}
        meta={<><span className="pc-only">{m.pc}</span><span className="ph-only">{m.ph}</span></>} chip={docChip(d)} />
    );
  }, (d) => d._id)}</>;
}

// ---------- Their Inbox ----------
function readLine(e: Event, names: Map<string, string>) {
  const readers = e.people.filter((p) => p.readAt).map((p) => firstName(names.get(p.email) ?? p.email));
  const emailed = e.people.some((p) => p.emailed);
  const read = readers.length === 0 ? "Unread" : readers.length === 1 ? `Read by ${readers[0]}` : `Read by ${readers.length}`;
  return [read, emailed && "emailed", dayWord(e.createdAt)].filter(Boolean).join(" · ");
}
function InboxSummary({ events, names, onOpen }: { events: Event[] | undefined; names: Map<string, string>; onOpen: () => void }) {
  return (
    <Card className="cp-inbox" label="Their Inbox" head={<SectionHead label="Their Inbox" count={events?.length || undefined} action={<Button size="sm" variant="ghost" onClick={onOpen} iconEnd="arrow-right">Open</Button>} />}>
      {events === undefined ? <SkeletonRows n={3} /> : events.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "inbox" }} title="Nothing in their Inbox yet." />
        : rows(events.slice(0, 3), (e) => <InboxItem icon={INBOX_ICON[e.kind as InboxKind]} title={e.title} detail={readLine(e, names)} />, (e) => e._id)}
    </Card>
  );
}
function TheirInbox({ page, events, business, show, onAdd }: { page: Page; events: Event[] | undefined; business: string; show: (m: string) => void; onAdd: () => void }) {
  const viewers = page.people.filter((p) => p.access.state !== "none" || (events ?? []).some((e) => e.people.some((x) => x.email === p.email)));
  const [who, setWho] = useState<string | null>(null);
  const email = who ?? viewers[0]?.email ?? null;
  const person = viewers.find((p) => p.email === email);
  const mine = (events ?? []).flatMap((e) => { const me = e.people.find((p) => p.email === email); return me ? [{ e, me }] : []; });
  const unread = mine.filter((x) => !x.me.readAt).length;
  const cuts = page.shared.length, projects = new Set(page.shared.map((s) => s.projectId)).size;
  const toSign = page.documents.filter((d) => d.status === "sent").length;
  return (
    <div className="wp-homecols">
      <div className="col">
        <div className="cp-viewing">
          <span className="wp-label">Viewing as</span>
          {viewers.length > 0 && <Segmented label="Viewing as" value={email ?? ""} onChange={(k) => setWho(k)} items={viewers.map((p) => ({ key: p.email, label: p.name ?? p.email }))} />}
          <span className="sp" />
          <ButtonLink size="sm" to={`/sent/new?client=${page.client._id}`}>Post a note</ButtonLink>
        </div>
        {events === undefined ? <Card label="Their Inbox"><SkeletonRows n={4} /></Card>
          : !person ? <EmptyState icon="inbox" title="No one here has portal access yet." body="Use Add a person (People, on Overview) to give someone an Inbox." />
          : mine.length === 0 ? <EmptyState icon="inbox" title="Nothing in their Inbox yet." body={`New cuts, documents and your notes show up here for ${firstName(person.name ?? person.email)}.`} />
          : (
            <Card label={`${person.name ?? person.email}'s Inbox`}>
              {rows(mine, ({ e, me }) => (
                <InboxItem icon={INBOX_ICON[e.kind as InboxKind]} title={e.title} detail={`${itemDetail(e, business)} · ${dayWord(e.createdAt)}`} unread={!me.readAt}
                  status={<span className={me.readAt ? "" : "cp-unread"}>{[me.readAt ? "Read" : "Unread", me.emailed && "emailed"].filter(Boolean).join(" · ")}</span>} />
              ), (x) => x.e._id)}
            </Card>
          )}
        {person && <p className="cp-foot"><Icon name="eye" size={16} />This is exactly what {firstName(person.name ?? person.email)} sees. Their replies come to you by email.</p>}
      </div>
      <div className="col right">
        <Card label="What they can see" head={<SectionHead label="What they can see" />}>
          <dl className="cp-see">
            <dt>Review</dt><dd>{cuts ? `${plural(cuts, "cut", "cuts")} in ${plural(projects, "project", "projects")}` : "Nothing shared yet"}</dd>
            <dt>Documents</dt><dd>{page.documents.length}{toSign ? ` (${toSign} to sign)` : ""}</dd>
            <dt>Inbox</dt><dd>{person ? `${plural(mine.length, "item", "items")} · ${unread} unread` : "—"}</dd>
          </dl>
        </Card>
        <PeopleCard page={page} show={show} onAdd={onAdd} />
      </div>
    </div>
  );
}

// ---------- Settings tab (Phase 2 Part A, frame 145:1521) ----------
function ClientSettings({ clientId, name, settings, show }: { clientId: Id<"clients">; name: string; settings: { rounds: number | null; watermarkOff: boolean; businessRounds: number; businessRoundsOff: boolean }; show: (m: string) => void }) {
  const save = useMutation(api.clients.setSettings);
  type Mode = "default" | "custom" | "off";
  const [mode, setMode] = useState<Mode>(settings.rounds === 0 ? "off" : settings.rounds ? "custom" : "default");
  const [n, setN] = useState(String(settings.rounds || settings.businessRounds));
  const err = (e: unknown) => show((e as Error).message.replace(/^.*ConvexError: /, "").split("\n")[0]);
  const pick = (k: Mode) => {
    setMode(k);
    if (k === "default" && settings.rounds !== null) void save({ clientId, rounds: null }).then(() => show("Back to the business default."), err);
    if (k === "off" && settings.rounds !== 0) void save({ clientId, rounds: 0 }).then(() => show(`Rounds are off for ${name}.`), err);
  };
  const saveN = () => { const v = Number(n); if (!Number.isFinite(v) || v < 1) { show("1 or more."); return; } void save({ clientId, rounds: v }).then(() => show("Saved."), err); };
  const on = !settings.watermarkOff;
  return (
    <div className="wp-bizextra cp-settings">
      <div className="panel">
        <span className="wp-eyebrow">Revision rounds</span>
        {settings.businessRoundsOff
          ? <div className="prow"><span className="pl">Rounds per video</span><span className="pr">Off for your whole business.<a className="linkbtn" {...linkProps("/settings/business")}>Settings › Business<Icon name="arrow-right" size={14} /></a></span></div>
          : <div className="prow"><span className="pl">Rounds per video</span><span className="pr">
          <Segmented label="Rounds per video" value={mode} onChange={pick} items={[{ key: "default", label: `Business default (${settings.businessRounds})` }, { key: "custom", label: "Custom" }, { key: "off", label: "Off" }]} />
          {mode === "custom" && <><input className="input sm" type="number" min={1} max={20} value={n} onChange={(e) => setN(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveN(); }} aria-label="Rounds per video for this client" style={{ width: 80 }} />
            {Number(n) !== settings.rounds && <Button size="sm" variant="primary" onClick={saveN}>Save</Button>}</>}
        </span></div>}
        <div className="prow"><span className="pl">Projects</span><span className="pr">A project can still set its own.</span></div>
      </div>
      <div className="panel">
        <span className="wp-eyebrow">Watermark</span>
        <div className="prow"><span className="pl">Review copies</span><span className="pr"><Toggle label="Watermark" checked={on} onChange={(v) => void save({ clientId, watermarkOff: !v }).catch(err)} /><span className="wmtxt">{on ? `On · ${name} sees your watermark on review copies` : `Off · review copies for ${name} have no watermark`}</span></span></div>
        <div className="prow"><span className="pl">Look</span><span className="pr">Set in Settings › Business<a className="linkbtn" {...linkProps("/settings/business")}>Open<Icon name="arrow-right" size={14} /></a></span></div>
      </div>
      <SubFailRow clientId={clientId} name={name} show={show} />
    </div>
  );
}

/** Phase 2b (D64): what happens to this client's subscriptions when Stripe's last retry fails. */
function SubFailRow({ clientId, name, show }: { clientId: Id<"clients">; name: string; show: (m: string) => void }) {
  const rules = useQuery(api.subscriptions.failRules, { clientId });
  const pay = useQuery(api.payments.settings, {});
  const save = useMutation(api.subscriptions.setClientFailRule);
  if (!rules || !pay?.stripe) return null;
  type R = "business" | "past_due" | "cancel";
  const biz = rules.business === "cancel" ? "Cancel" : "Keep past due";
  return (
    <div className="panel">
      <span className="wp-eyebrow">Subscriptions</span>
      <div className="prow"><span className="pl">When a payment fails for good</span><span className="pr">
        <Segmented<R> label="When a subscription payment fails for good" value={rules.client as R} onChange={(k) => void save({ clientId, rule: k }).then(() => show(k === "business" ? "Back to the business setting." : `Saved for ${name}.`), (e) => show(errText(e)))}
          items={[{ key: "business", label: `Business setting (${biz})` }, { key: "past_due", label: "Keep past due" }, { key: "cancel", label: "Cancel it" }]} />
      </span></div>
      <div className="prow"><span className="pl">Means</span><span className="pr">After Stripe's last retry. Past due waits for you; Cancel ends the subscription and emails {name}.</span></div>
    </div>
  );
}

// ---------- Phase 3: money, deals, follow-ups ----------
type Crm = NonNullable<ReturnType<typeof useQuery<typeof api.crm.company>>>;
function MoneyTiles({ crm }: { crm: Crm | undefined }) {
  if (!crm) return null;
  const open = crm.outstandingCents > 0;
  return (
    <div className="pov-stats crm-money">
      <div className="pov-stat"><span className="lbl">Billed</span><b>{money(crm.billedCents)}</b><span className="sub">all invoices sent</span></div>
      <div className="pov-stat"><span className="lbl">Paid</span><b>{money(crm.paidCents)}</b><span className="sub">received through Stripe</span></div>
      <div className="pov-stat"><span className="lbl">Outstanding</span><b>{money(crm.outstandingCents)}</b><span className="sub">{open ? "on open invoices" : "nothing due"}</span></div>
    </div>
  );
}
const TONE: Record<string, "accent" | "neutral" | "success" | "warning"> = { lead: "neutral", quoted: "neutral", contract_sent: "warning", signed: "accent", in_production: "accent", delivered: "success", paid: "success" };
function DealsCard({ crm, clientId }: { crm: Crm | undefined; clientId: Id<"clients"> }) {
  if (!crm) return null;
  return (
    <Card label="Deals" head={<SectionHead label="Deals" count={crm.deals.length} action={<ButtonLink size="sm" variant="ghost" icon="plus" to={`/clients/estimates/new?client=${clientId}`}>New estimate</ButtonLink>} />}>
      {crm.deals.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "activity" }} title="No deals on the pipeline." />
        : rows(crm.deals, (d) => <ListRow className="ilead" lead={{ icon: "activity" }} to={`/clients/deals/${d._id}`} title={d.title} meta={d.valueCents ? money(d.valueCents) : "No value yet"}
          chip={<StatusChip tone={TONE[d.stage]}>{d.stageName}</StatusChip>} chevron />, (d) => d._id)}
    </Card>
  );
}
function FollowUpsCard({ crm, show, onAdd }: { crm: Crm | undefined; show: (m: string) => void; onAdd: () => void }) {
  if (!crm) return null;
  return (
    <Card label="Follow-ups" head={<SectionHead label="Follow-ups" count={crm.followUps.length} action={<Button size="sm" variant="ghost" icon="plus" onClick={onAdd}>Add</Button>} />}>
      {crm.followUps.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "bell" }} title="None set." />
        : rows(crm.followUps, (f) => <FollowUpRow f={f} show={show} />, (f) => f._id)}
    </Card>
  );
}

// Phase 3b (718:7002): this company's proposals and quick quotes.
function PitchesCard({ clientId }: { clientId: Id<"clients"> }) {
  const list = useQuery(api.proposals.forCompany, { clientId });
  if (!list) return null;
  const day = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const word: Record<string, string> = { draft: "Draft", waiting: "Waiting for Claude", ready: "Ready", sent: "Sent", accepted: "Accepted", declined: "Declined", void: "Withdrawn" };
  const tone = (s: string): "neutral" | "accent" | "success" | "danger" | "warning" => (s === "accepted" ? "success" : s === "declined" ? "danger" : s === "waiting" ? "warning" : s === "sent" || s === "ready" ? "accent" : "neutral");
  return (
    <Card label="Proposals and quotes" head={<SectionHead label="Proposals and quotes" count={list.length} action={<ButtonLink size="sm" variant="ghost" to={`/proposals/new?client=${clientId}`} icon="plus">New proposal</ButtonLink>} />}>
      {list.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "document" }} title="None yet." />
        : rows(list, (x) => <ListRow className="ilead" lead={{ icon: x.kind === "proposal" ? "document" : "invoice" }} to={x.kind === "proposal" ? `/proposals/${x._id}` : `/payments/quotes/${x._id}`} title={x.title}
          meta={[`${x.kind === "proposal" ? "Proposal" : "Quote"} ${x.number}`, x.response ? `${x.response.kind} ${day(x.response.at)}` : x.sentAt ? `sent ${day(x.sentAt)}` : null, x.validUntil && x.status === "sent" ? `valid until ${day(Date.parse(`${x.validUntil}T12:00:00`))}` : null].filter(Boolean).join(" · ")}
          trailing={money(x.totalCents)} chip={<StatusChip tone={tone(x.status)}>{word[x.status] ?? x.status}</StatusChip>} chevron />, (x) => x._id)}
    </Card>
  );
}

// ---------- the page ----------
export default function ClientPage({ clientId, tab: tabParam }: { clientId: Id<"clients">; tab: ClientTab }) {
  const page = useQuery(api.clients.page, { clientId });
  const events = useQuery(api.inbox.forClient, { clientId });
  const biz = useQuery(api.business.settings, {});
  const crm = useQuery(api.crm.company, { clientId }) ?? undefined;
  const [following, setFollowing] = useState(false);
  const [toast, show] = useToast();
  const [sharing, setSharing] = useState(false);
  const [adding, setAdding] = useState(false);
  const tab = tabParam;
  const setTab = (k: ClientTab) => navigate(`/clients/${clientId}${k === "overview" ? "" : `?tab=${k}`}`);
  if (page === undefined) return <><TopBar><a {...linkProps("/clients")}>Clients</a></TopBar><div className="wp-page"><Card label="Loading"><SkeletonRows n={4} /></Card></div></>;
  if (page === null) return <><TopBar><a {...linkProps("/clients")}>Clients</a></TopBar><div className="wp-page"><EmptyState icon="users" title="This client isn't here." body="It may have been deleted." actions={<ButtonLink to="/clients">All clients</ButtonLink>} /></div></>;
  const names = new Map(page.people.map((p) => [p.email, p.name ?? p.email]));
  const business = biz?.name ?? "your business";
  const name = page.client.name;
  const actions = (
    <>
      <Button onClick={() => setFollowing(true)}>Add follow-up</Button>
      <ButtonLink to={`/payments/quotes/new?client=${clientId}`}>Quick quote</ButtonLink>
      <ButtonLink to={`/proposals/new?client=${clientId}`}>New proposal</ButtonLink>
      <ButtonLink variant="primary" to={`/clients/estimates/new?client=${clientId}`}>New estimate</ButtonLink>
    </>
  );
  return (
    <>
      <TopBar><a {...linkProps("/clients")}>Clients</a><Sep /><a {...linkProps("/clients")}>Companies</a><Sep /><span className="here">{name}</span></TopBar>
      <div className="wp-page cp">
        <a className="wp-setback" {...linkProps("/clients")}><Icon name="arrow-left" size={20} />Clients</a>
        <header className="cp-head">
          <Avatar name={name} two size={56} />
          <div className="txt">
            <h1 className="wp-h2" title={name}>{name}</h1>
            <div className="tags pc-only"><span className="wp-tag">{plural(page.people.length, "person", "people")}</span><span className="wp-tag">{plural(page.projects.length, "project", "projects")}</span></div>
            <span className="ph-only cp-sub">{plural(page.people.length, "person", "people")} · {plural(page.projects.length, "project", "projects")}</span>
          </div>
          <div className="acts">{actions}</div>
        </header>
        <MoneyTiles crm={crm} />
        <div className="ws-tabs cp-tabs">
          <Tabs label="Client" value={tab} onChange={setTab} items={[
            { key: "overview", label: "Overview" }, { key: "projects", label: "Projects", count: page.projects.length },
            { key: "shared", label: "Shared", count: page.shared.length }, { key: "documents", label: "Documents", count: page.documents.length },
            { key: "inbox", label: "Their Inbox" }, { key: "brand", label: "Brand kit" }, { key: "settings", label: "Settings" },
          ]} />
        </div>
        {tab === "overview" && (
          <div className="wp-homecols cp-overview">
            <div className="col">
              <DealsCard crm={crm} clientId={clientId} />
              <PitchesCard clientId={clientId} />
              <Card className="cp-projects" label="Projects" head={<SectionHead label="Projects" count={page.projects.length} action={<ButtonLink size="sm" variant="ghost" to="/projects" icon="plus">New project</ButtonLink>} />}><ProjectRows page={page} max={4} /></Card>
              <Card className="cp-shared" label="Shared with them" head={<SectionHead label="Shared with them" count={page.shared.length} action={<Button size="sm" variant="ghost" onClick={() => setSharing(true)} iconEnd="chevron-right">Share a cut</Button>} />}><SharedRows page={page} max={5} /></Card>
              <Card className="cp-docs" label="Documents" head={<SectionHead label="Documents" count={page.documents.length} action={<ButtonLink size="sm" variant="ghost" to="/sign/new" icon="plus">New document</ButtonLink>} />}><DocRows page={page} max={5} /></Card>
            </div>
            <div className="col right">
              <FollowUpsCard crm={crm} show={show} onAdd={() => setFollowing(true)} />
              <PeopleCard page={page} show={show} onAdd={() => setAdding(true)} />
              <InboxSummary events={events} names={names} onOpen={() => setTab("inbox")} />
            </div>
          </div>
        )}
        {tab === "projects" && <Card label="Projects"><ProjectRows page={page} /></Card>}
        {tab === "shared" && <Card label="Shared with them"><SharedRows page={page} /></Card>}
        {tab === "documents" && <Card label="Documents"><DocRows page={page} /></Card>}
        {tab === "inbox" && <TheirInbox page={page} events={events} business={business} show={show} onAdd={() => setAdding(true)} />}
        {tab === "brand" && <><p className="wp-body cp-kitnote">{name}'s brand, for decks made in their look. The questionnaire fills it; you can edit it any time.</p><BrandKitEditor clientId={clientId} show={show} /></>}
        {tab === "settings" && <ClientSettings clientId={clientId} name={name} settings={page.settings} show={show} />}
      </div>
      {sharing && <ShareDialog target={{ kind: "client", client: name }} label={name} onClose={() => setSharing(false)} show={show} />}
      {adding && <AddPerson clientId={clientId} client={name} onClose={() => setAdding(false)} show={show} />}
      {following && <AddFollowUp onClose={() => setFollowing(false)} show={show} eyebrow={name} clientId={clientId} />}
      {toast}
    </>
  );
}
