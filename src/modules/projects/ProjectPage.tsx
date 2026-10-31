// Phase 2 Part A (Oct 29): the owner's project page (S5 · Phase 2 › P2 / Owner / Project): header with the client,
// tags and actions; tabs Overview · Cuts · Documents · Delivery (Invoices arrive with Part B). Overview holds the
// stage bar, next step, cuts with their rounds, key dates, rounds, documents, final delivery and people.
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, ButtonLink, Card, Checkbox, EmptyState, ListRow, SectionHead, Segmented, SkeletonRows, StatusChip, Tabs, TextArea, TextField } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Menu, MenuItem, Modal, useConfirm, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { ShareDialog } from "../review/Share";
import { errText } from "../docs/pages/common";
import Projects from "../review/Projects";
import { ProjectInvoices } from "../payments/InvoicesPage";
import { LedgerTab } from "../crm/Ledger";
import { StageBar, STAGES, stageName, type Stage, dateText, bytes, openFileLink } from "./common";

type Page = NonNullable<ReturnType<typeof useQuery<typeof api.projects.page>>>;
export type ProjectTab = "overview" | "cuts" | "documents" | "invoices" | "delivery" | "ledger";
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function cutChip(v: Page["videos"][number]) {
  if (v.final) return <StatusChip tone="success">Final</StatusChip>;
  if (!v.latest) return <StatusChip tone="neutral">No versions</StatusChip>;
  if (v.latest.status !== "ready") return <StatusChip tone="neutral">Converting</StatusChip>;
  if (v.openNotes) return <StatusChip tone="warning">Open notes</StatusChip>;
  return <StatusChip tone="neutral">Ready</StatusChip>;
}

// ---------- dialogs ----------
function MoveStage({ page, to, post: post0, onClose, show }: { page: Page; to: Stage; post: boolean; onClose: () => void; show: (m: string) => void }) {
  const setStage = useMutation(api.projects.setStage);
  const [post, setPost] = useState(post0 && !!page.client);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const client = page.client?.name ?? "The client";
  return (
    <Modal onClose={onClose} label={`Move to ${stageName(to)}`} width={560}>
      <form style={{ display: "grid", gap: 18 }} onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try {
          const r = await setStage({ projectId: page._id, stage: to, post, note: note.trim() || undefined });
          show(post ? (r.posted ? `Moved to ${stageName(to)} and posted to ${plural(r.posted, "Inbox", "Inboxes")}.` : `Moved to ${stageName(to)}. No one at ${client} has portal access yet.`) : `Moved to ${stageName(to)}.`);
          onClose();
        } catch (err) { setError(errText(err)); setBusy(false); }
      }}>
        <div className="dhead">
          <div style={{ display: "grid", gap: 6 }}>
            <span className="eyebrow">{page.label}</span>
            <h2 className="headline">Move to {stageName(to)}?</h2>
            <p className="secondary" style={{ margin: 0 }}>{page.client ? `${client} sees the new stage on the project page.` : "This project has no client yet."}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        {page.client && <Checkbox checked={post} onChange={setPost} label={`Post it to ${client}'s Inbox`} hint={`"Stage moved to ${stageName(to)}"`} />}
        {post && <TextArea label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={400} placeholder="Final files are next. The final invoice comes with them." />}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" type="submit" loading={busy}>Move to {stageName(to)}</Button>
        </div>
      </form>
    </Modal>
  );
}

function RoundsDialog({ page, onClose, show }: { page: Page; onClose: () => void; show: (m: string) => void }) {
  const setRounds = useMutation(api.projects.setRounds);
  const inherited = page.rounds.client ?? page.rounds.business;
  const inheritedText = inherited === 0 ? "off" : String(inherited);
  const fromName = page.rounds.client !== null ? `${page.client?.name ?? "the client"}'s setting` : "your business setting";
  const [mode, setMode] = useState<"inherit" | "custom" | "off">(page.rounds.project === 0 ? "off" : page.rounds.project ? "custom" : "inherit");
  const [n, setN] = useState(String(page.rounds.project || inherited || 2));
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  return (
    <Modal onClose={onClose} label="Rounds included" width={560}>
      <form style={{ display: "grid", gap: 18 }} onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try {
          const num = Number(n);
          if (mode === "custom" && (!Number.isFinite(num) || num < 1)) throw new Error("Rounds per video: 1 or more.");
          await setRounds({ projectId: page._id, rounds: mode === "custom" ? num : mode === "off" ? 0 : null });
          show(mode === "custom" ? `${plural(Math.round(num), "round", "rounds")} per video on this project.` : mode === "off" ? "Rounds are off for this project." : `Back to ${fromName} (${inheritedText}).`);
          onClose();
        } catch (err) { setError(errText(err)); setBusy(false); }
      }}>
        <div className="dhead">
          <div style={{ display: "grid", gap: 6 }}>
            <span className="eyebrow">{page.label}</span>
            <h2 className="headline">Rounds included.</h2>
            <p className="secondary" style={{ margin: 0 }}>{page.rounds.businessOff ? "Rounds are off for your whole business (Settings › Business)." : `Each version is a round. Starts from ${fromName}.`}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <Segmented label="Rounds" value={mode} onChange={setMode} items={[{ key: "inherit", label: `Use ${page.rounds.client !== null ? "client" : "business"} setting (${inheritedText})` }, { key: "custom", label: "Custom" }, { key: "off", label: "Off" }]} />
        {mode === "custom" && <TextField label="Rounds per video" type="number" min={1} max={20} value={n} onChange={(e) => setN(e.target.value)} autoFocus />}
        {mode === "off" && <p className="secondary" style={{ margin: 0 }}>No round chips, no last-round notice and no change-order prompt on this project.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" type="submit" loading={busy}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function NextStepDialog({ page, onClose, show }: { page: Page; onClose: () => void; show: (m: string) => void }) {
  const save = useMutation(api.projects.setNextStep);
  const [text, setText] = useState(page.nextStep ?? "");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  return (
    <Modal onClose={onClose} label="Next step" width={560}>
      <form style={{ display: "grid", gap: 18 }} onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try { await save({ projectId: page._id, text }); show("Next step saved."); onClose(); } catch (err) { setError(errText(err)); setBusy(false); }
      }}>
        <div className="dhead">
          <div style={{ display: "grid", gap: 6 }}>
            <span className="eyebrow">{page.label}</span>
            <h2 className="headline">Next step.</h2>
            <p className="secondary" style={{ margin: 0 }}>{page.client ? `${page.client.name} sees it on their project page.` : "Shown on the project page."}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <TextField label="Next step" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder="Notes on Harbor Coffee 30s v2 by Nov 4." autoFocus />
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" type="submit" loading={busy}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function KeyDatesDialog({ page, onClose, show }: { page: Page; onClose: () => void; show: (m: string) => void }) {
  const save = useMutation(api.projects.setKeyDates);
  const [rows, setRows] = useState(page.keyDates.length ? page.keyDates.map((d) => ({ ...d })) : [{ label: "Kickoff", date: "" }, { label: "Shoot", date: "" }, { label: "First cut", date: "" }, { label: "Final due", date: "" }]);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const set = (i: number, k: "label" | "date", val: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: val } : x)));
  return (
    <Modal onClose={onClose} label="Key dates" width={600}>
      <form style={{ display: "grid", gap: 18 }} onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try { await save({ projectId: page._id, dates: rows.filter((r) => r.label.trim() || r.date) }); show("Key dates saved."); onClose(); } catch (err) { setError(errText(err)); setBusy(false); }
      }}>
        <div className="dhead">
          <div style={{ display: "grid", gap: 6 }}>
            <span className="eyebrow">{page.label}</span>
            <h2 className="headline">Key dates.</h2>
            <p className="secondary" style={{ margin: 0 }}>Shown on the project page, in date order. Leave a date empty to drop it.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className="pj-dates">
          {rows.map((r, i) => (
            <div className="row" key={i}>
              <input className="input" aria-label="Name" value={r.label} maxLength={40} onChange={(e) => set(i, "label", e.target.value)} placeholder="Name" />
              <input className="input" aria-label={`${r.label || "Date"}: date`} type="date" value={r.date} onChange={(e) => set(i, "date", e.target.value)} />
              <button type="button" className="icon-btn" aria-label="Remove" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><Icon name="close" size={16} /></button>
            </div>
          ))}
          {rows.length < 12 && <Button size="sm" variant="ghost" icon="plus" onClick={() => setRows((x) => [...x, { label: "", date: "" }])}>Add a date</Button>}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" type="submit" loading={busy}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function AddFiles({ page, onClose, show }: { page: Page; onClose: () => void; show: (m: string) => void }) {
  const add = useMutation(api.projects.addDeliveryFile);
  const list = useAction(api.projects.dropboxFiles);
  const [dbx, setDbx] = useState<{ path: string; name: string; size: number }[] | null | "error">(null);
  const [dbxErr, setDbxErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const have = new Set(page.delivery.files.map((f) => f.name));
  const loadDropbox = async () => {
    setLoading(true); setDbxErr(null);
    try { setDbx(await list({ projectId: page._id })); } catch (e) { setDbx("error"); setDbxErr(errText(e)); } finally { setLoading(false); }
  };
  const addOne = async (file: Parameters<typeof add>[0]["file"], label: string) => {
    try { await add({ projectId: page._id, file }); show(`Added ${label}.`); } catch (e) { show(errText(e)); }
  };
  const versions = page.videos.filter((x) => x.latest && x.latest.status === "ready");
  return (
    <Modal onClose={onClose} label="Add final files" width={640}>
      <div style={{ display: "grid", gap: 18 }}>
        <div className="dhead">
          <div style={{ display: "grid", gap: 6 }}>
            <span className="eyebrow">{page.label}</span>
            <h2 className="headline">Add final files.</h2>
            <p className="secondary" style={{ margin: 0 }}>{page.client?.name ?? "The client"} can download them once the final files are unlocked.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <section className="pj-addsec">
          <span className="wp-eyebrow">From Dropbox</span>
          {!page.dropbox ? <p className="secondary">This project has no Dropbox folder. Files in its folder under Apps/Wrangler Review show here.</p>
            : dbx === null ? <Button size="sm" loading={loading} onClick={() => void loadDropbox()}>Show the project's Dropbox files</Button>
            : dbx === "error" ? <p className="error">{dbxErr}</p>
            : dbx.length === 0 ? <p className="secondary">No video, audio, image or zip files in the project's folder.</p>
            : <div className="pj-picklist">{dbx.map((f) => (
              <div className="pj-pick" key={f.path}>
                <span className="txt"><b>{f.name}</b><span>{f.path} · {bytes(f.size)}</span></span>
                <Button size="sm" disabled={have.has(f.name)} onClick={() => void addOne({ kind: "dropbox", path: f.path, name: f.name, size: f.size }, f.name)}>{have.has(f.name) ? "Added" : "Add"}</Button>
              </div>
            ))}</div>}
        </section>
        <section className="pj-addsec">
          <span className="wp-eyebrow">From this project's cuts</span>
          {versions.length === 0 ? <p className="secondary">No finished cuts yet.</p> : (
            <div className="pj-picklist">{versions.map((x) => (
              <div className="pj-pick" key={x._id}>
                <span className="txt"><b>{x.title} · v{x.latest!.number}</b><span>The file Download saves (the render, or its largest MP4 copy)</span></span>
                <Button size="sm" onClick={() => void addOne({ kind: "version", versionId: x.latest!.versionId }, `${x.title} v${x.latest!.number}`)}>Add</Button>
              </div>
            ))}</div>
          )}
        </section>
        <div className="dfoot"><Button variant="primary" onClick={onClose}>Done</Button></div>
      </div>
    </Modal>
  );
}

// ---------- tabs ----------
function Overview({ page, onMove, onRounds, onNext, onDates, postDefault, setPostDefault, goTab, onAddFiles }: {
  page: Page; onMove: (s: Stage) => void; onRounds: () => void; onNext: () => void; onDates: () => void;
  postDefault: boolean; setPostDefault: (b: boolean) => void; goTab: (t: ProjectTab) => void; onAddFiles: () => void;
}) {
  const i = STAGES.indexOf(page.stage);
  const next = STAGES[i + 1] as Stage | undefined;
  const client = page.client?.name ?? "the client";
  const from = page.rounds.from === "project" ? "This project" : page.rounds.from === "client" ? `${client}'s setting` : "Your business setting";
  return (
    <div className="wp-homecols pj-overview">
      <div className="col">
        <Card className="pj-stage" label="Stage" head={<SectionHead label="Stage" action={next ? <Button variant="primary" size="sm" onClick={() => onMove(next)}>Move to {stageName(next)}</Button> : undefined} />}>
          <div className="pj-stagebody">
            <StageBar stage={page.stage} onPick={(s) => s !== page.stage && onMove(s)} />
            <span className="pj-stageph">{stageName(page.stage)} · stage {i + 1} of 5</span>
            {next && <Button variant="primary" className="pj-movebig" onClick={() => onMove(next)}>Move to {stageName(next)}</Button>}
            {page.client && <Checkbox checked={postDefault} onChange={setPostDefault} label={`Post stage moves to ${client}'s Inbox`} hint={next ? `They see "Stage moved to ${stageName(next)}" with your note.` : "They see the new stage with your note."} />}
          </div>
        </Card>
        <Card className="pj-next" label="Next step" head={<SectionHead label="Next step" action={<Button size="sm" variant="ghost" onClick={onNext} iconEnd="edit">Edit</Button>} />}>
          <p className="pj-nexttext">{page.nextStep || <span className="secondary">No next step yet.</span>}</p>
        </Card>
        <Card className="pj-cuts" label="Cuts" head={<SectionHead label="Cuts" count={page.videos.length} action={<Button size="sm" variant="ghost" onClick={() => goTab("cuts")} iconEnd="arrow-right">Open Cuts</Button>} />}>
          {page.videos.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "video" }} title="No cuts yet." />
            : page.videos.slice(0, 6).map((v) => (
              <ListRow key={v._id} to={`/v/${v._id}`} lead={{ thumb: v.thumbUrl, size: 64 }} chevron
                title={<>{v.number && <span className="chip num mono">{String(v.number).padStart(5, "0")}</span>} {v.title}</>}
                meta={v.latest ? `${v.final ? `Final v${v.final.version}` : `v${v.latest.number}`}${v.round ? ` · ${v.round.label}` : ""}` : "No versions yet"}
                chip={cutChip(v)} />
            ))}
        </Card>
      </div>
      <div className="col right">
        <Card className="pj-dates-card" label="Key dates" head={<SectionHead label="Key dates" action={<Button size="sm" variant="ghost" onClick={onDates} iconEnd="edit">Edit</Button>} />}>
          {page.keyDates.length === 0 ? <p className="pj-pad secondary">No dates yet.</p>
            : <dl className="cp-see">{page.keyDates.map((d) => <div key={d.label + d.date} style={{ display: "contents" }}><dt>{d.label}</dt><dd>{dateText(d.date)}</dd></div>)}</dl>}
        </Card>
        <Card className="pj-rounds" label="Revision rounds" head={<SectionHead label="Revision rounds" action={<Button size="sm" variant="ghost" onClick={onRounds} iconEnd="edit">Change</Button>} />}>
          <dl className="cp-see"><dt>Included</dt><dd>{page.rounds.off ? "Off" : `${plural(page.rounds.included, "round", "rounds")} per video`}</dd><dt>From</dt><dd>{from}</dd></dl>
        </Card>
        <Card className="pj-docs" label="Documents" head={<SectionHead label="Documents" count={page.documents.length} />}>
          {page.documents.length === 0 ? <p className="pj-pad secondary">No documents sent to {client} yet.</p>
            : page.documents.slice(0, 4).map((d) => (
              <ListRow key={d._id} to={`/sign/d/${d._id}`} title={<><span className="secondary">{d.label}</span> {d.title}</>}
                chip={d.status === "completed" ? <StatusChip tone="success">Signed</StatusChip> : d.status === "voided" ? <StatusChip tone="neutral">Cancelled</StatusChip> : <StatusChip tone="warning">To sign</StatusChip>} />
            ))}
        </Card>
        <Card className="pj-final" label="Final delivery" head={<SectionHead label="Final delivery" action={<Button size="sm" onClick={onAddFiles}>Add files</Button>} />}>
          <button type="button" className="pj-lockline" onClick={() => goTab("delivery")}>
            <Icon name={page.delivery.open ? "download" : "lock"} size={18} />
            <span>{page.delivery.open ? `Open for ${client} until ${new Date(page.delivery.expiresAt!).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`
              : page.delivery.files.length ? `${plural(page.delivery.files.length, "file", "files")} ready. ${client} can download them once you unlock them.`
              : `Add the final files, then unlock them for ${client}.`}</span>
          </button>
        </Card>
        <Card className="pj-people" label="People" head={<SectionHead label="People" count={page.people.length} action={page.client ? <ButtonLink size="sm" variant="ghost" to={`/clients/${page.client._id}`}>Open client</ButtonLink> : undefined} />}>
          {page.people.length === 0 ? <p className="pj-pad secondary">{page.client ? `No one at ${client} yet.` : "This project has no client."}</p>
            : page.people.map((p) => <ListRow key={p._id} lead={{ avatar: p.name ?? p.email, two: true }} title={p.name ?? p.email} meta={p.name ? p.email : undefined} />)}
        </Card>
      </div>
    </div>
  );
}

function Delivery({ page, show, onAddFiles }: { page: Page; show: (m: string) => void; onAddFiles: () => void }) {
  const setDelivery = useMutation(api.projects.setDelivery);
  const remove = useMutation(api.projects.removeDeliveryFile);
  const link = useAction(api.projects.deliveryLink);
  const [confirm, confirmDialog] = useConfirm();
  const [days, setDays] = useState<string | null>(null);
  const client = page.client?.name ?? "the client";
  const d = page.delivery;
  const until = d.expiresAt ? new Date(d.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  const unlock = async () => {
    if (!(await confirm({ title: `Unlock the final files for ${client}?`, body: `They can download them for ${plural(d.linkDays, "day", "days")}${page.client ? ", and get a \"Final files ready\" item in their Inbox" : ""}. Once Payments is set up, a paid final invoice does this by itself.`, yes: "Unlock", danger: false }))) return;
    try { const r = await setDelivery({ projectId: page._id, unlocked: true }); show(r.posted ? `Unlocked. ${plural(r.posted, "person was", "people were")} told.` : "Unlocked."); } catch (e) { show(errText(e)); }
  };
  return (
    <div className="pj-delivery">
      <section className={`wp-notice pj-lock${d.open ? " open" : ""}`}>
        <Icon name={d.open ? "download" : "lock"} size={20} />
        <div className="txt">
          <b>{d.open ? `Open for ${client} until ${until}` : d.unlockedAt ? `The links for ${client} expired on ${until}` : `Locked for ${client}`}</b>
          <span>{d.open ? "They download each file from their project page. Links work until the date above." : "Unlock when you're ready: they get expiring download links to the files below. Once Payments is set up, a paid final invoice unlocks them by itself."}</span>
        </div>
        <span className="acts">
          {d.open ? <Button size="sm" onClick={() => void setDelivery({ projectId: page._id, unlocked: false }).then(() => show("Locked again."))}>Lock again</Button>
            : <Button size="sm" variant="primary" disabled={!d.files.length} onClick={() => void unlock()} title={d.files.length ? undefined : "Add the final files first"}>{d.unlockedAt ? "Unlock again" : "Unlock now"}</Button>}
        </span>
      </section>
      <Card label="Final files" head={<SectionHead label="Final files" count={d.files.length} action={<Button size="sm" onClick={onAddFiles}>Add files</Button>} />}>
        {d.files.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "video" }} title="No final files yet. Add them from Dropbox or from the project's cuts." />
          : d.files.map((f) => (
            <ListRow key={f._id} lead={{ icon: "video" }} title={f.name} meta={f.note ?? undefined}
              trailing={f.size ? <span className="secondary">{bytes(f.size)}</span> : undefined}
              action={<span className="pj-filebtns">
                <button type="button" className="icon-btn" aria-label={`Download ${f.name}`} title="Download (your copy)" onClick={() => void openFileLink(() => link({ fileId: f._id }), (e) => show(errText(e)))}><Icon name="download" size={16} /></button>
                <button type="button" className="icon-btn" aria-label={`Remove ${f.name}`} title="Remove" onClick={() => void remove({ fileId: f._id })}><Icon name="close" size={16} /></button>
              </span>} />
          ))}
      </Card>
      <Card label="Links" head={<SectionHead label="Links" />}>
        <dl className="cp-see pj-links">
          <dt>Link lasts</dt>
          <dd>{days === null ? <>{plural(d.linkDays, "day", "days")} after unlock <button type="button" className="linkbtn" onClick={() => setDays(String(d.linkDays))}>Change<Icon name="edit" size={14} /></button></> : (
            <span className="pj-days"><input className="input sm" type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} aria-label="Days" autoFocus /> days
              <Button size="sm" variant="primary" onClick={() => void setDelivery({ projectId: page._id, linkDays: Number(days) || 7 }).then(() => { setDays(null); show("Saved."); })}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setDays(null)}>Cancel</Button></span>
          )}</dd>
          <dt>Dropbox files</dt><dd>A fresh Dropbox link on every click (each lasts about 4 hours)</dd>
        </dl>
      </Card>
      {confirmDialog}
    </div>
  );
}

function Documents({ page }: { page: Page }) {
  if (!page.documents.length) return <EmptyState icon="document" title={`No documents sent to ${page.client?.name ?? "this client"} yet.`} actions={<ButtonLink to="/sign/new">New document</ButtonLink>} />;
  return (
    <Card label="Documents">
      {page.documents.map((d) => (
        <ListRow key={d._id} to={`/sign/d/${d._id}`} lead={{ icon: "document" }} title={<><span className="secondary">{d.label}</span> {d.title}</>} chevron
          meta={d.completedAt ? `Signed ${new Date(d.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : d.sentAt ? `Sent ${new Date(d.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : undefined}
          chip={d.status === "completed" ? <StatusChip tone="success">Signed</StatusChip> : d.status === "voided" ? <StatusChip tone="neutral">Cancelled</StatusChip> : <StatusChip tone="warning">To sign</StatusChip>} />
      ))}
    </Card>
  );
}

// ---------- the page ----------
export default function ProjectPage({ projectId, tab }: { projectId: Id<"projects">; tab: ProjectTab }) {
  const page = useQuery(api.projects.page, { projectId });
  const [toast, show] = useToast();
  const [moving, setMoving] = useState<Stage | null>(null);
  const [dialog, setDialog] = useState<"rounds" | "next" | "dates" | "files" | "share" | null>(null);
  const [postDefault, setPostDefault] = useState(true);
  const pay = useQuery(api.payments.settings, {});
  const payOn = !!pay?.stripe; // Phase 2 Part B: the Invoices tab once Stripe is connected
  const setTab = (k: ProjectTab) => navigate(`/projects/${projectId}${k === "overview" ? "" : `?tab=${k}`}`);
  if (page === undefined) return <><TopBar><a {...linkProps("/projects")}>Projects</a></TopBar><div className="wp-page"><Card label="Loading"><SkeletonRows n={4} /></Card></div></>;
  if (page === null) return <><TopBar><a {...linkProps("/projects")}>Projects</a></TopBar><div className="wp-page"><EmptyState icon="folder" title="This project doesn't exist any more." actions={<ButtonLink to="/projects">All projects</ButtonLink>} /></div></>;
  return (
    <>
      <TopBar right={<>
        <Menu align="end" label="Project options" trigger={(p) => <button {...p} className="icon-btn" aria-label="Project options"><Icon name="more" size={18} /></button>}>
          <MenuItem icon={<Icon name="calendar" size={16} />} onSelect={() => setDialog("dates")}>Key dates…</MenuItem>
          <MenuItem icon={<Icon name="stage" size={16} />} onSelect={() => setDialog("rounds")}>Rounds included…</MenuItem>
          <MenuItem icon={<Icon name="video" size={16} />} onSelect={() => setTab("cuts")}>Cuts, upload and share</MenuItem>
        </Menu>
        <Button size="sm" onClick={() => setDialog("share")}>Share</Button>
        {page.client && <ButtonLink size="sm" variant="primary" to={`/sent/new?client=${page.client._id}`}>Post a note</ButtonLink>}
      </>}>
        <a {...linkProps("/review")}>Review</a><Sep /><a {...linkProps("/projects")}>Projects</a><Sep /><span className="here">{page.label}</span>
      </TopBar>
      <div className="wp-page cp pj">
        <a className="wp-setback" {...linkProps("/projects")}><Icon name="arrow-left" size={20} />Projects</a>
        <header className="pj-head">
          {page.client && <a className="wp-eyebrow" {...linkProps(`/clients/${page.client._id}`)}>{page.client.name}</a>}
          <h1 className="wp-h2" title={page.label}>{page.label}</h1>
          <div className="tags pc-only">
            <span className="wp-tag">{plural(page.videos.length, "video", "videos")}</span>
            <span className="wp-tag">{stageName(page.stage)}</span>
            {!page.rounds.off && <span className="wp-tag">{plural(page.rounds.included, "round", "rounds")} per video</span>}
          </div>
        </header>
        <div className="ws-tabs cp-tabs">
          <Tabs label="Project" value={tab} onChange={setTab} items={[
            { key: "overview", label: "Overview" }, { key: "cuts", label: "Cuts", count: page.videos.length },
            { key: "documents", label: "Documents", count: page.documents.length },
            ...(payOn ? [{ key: "invoices" as ProjectTab, label: "Invoices" }] : []), { key: "delivery", label: "Delivery" }, { key: "ledger", label: "Ledger" },
          ]} />
        </div>
        {tab === "overview" && <Overview page={page} onMove={setMoving} onRounds={() => setDialog("rounds")} onNext={() => setDialog("next")} onDates={() => setDialog("dates")} postDefault={postDefault} setPostDefault={setPostDefault} goTab={setTab} onAddFiles={() => setDialog("files")} />}
        {tab === "cuts" && <div className="pj-cutsTab"><Projects projectId={projectId} embedded /></div>}
        {tab === "documents" && <Documents page={page} />}
        {tab === "invoices" && <ProjectInvoices projectId={projectId} clientId={page.client?._id ?? null} />}
        {tab === "delivery" && <Delivery page={page} show={show} onAddFiles={() => setDialog("files")} />}
        {tab === "ledger" && <LedgerTab projectId={projectId} show={show} />}
      </div>
      {moving && <MoveStage page={page} to={moving} post={postDefault} onClose={() => setMoving(null)} show={show} />}
      {dialog === "rounds" && <RoundsDialog page={page} onClose={() => setDialog(null)} show={show} />}
      {dialog === "next" && <NextStepDialog page={page} onClose={() => setDialog(null)} show={show} />}
      {dialog === "dates" && <KeyDatesDialog page={page} onClose={() => setDialog(null)} show={show} />}
      {dialog === "files" && <AddFiles page={page} onClose={() => setDialog(null)} show={show} />}
      {dialog === "share" && <ShareDialog target={{ kind: "project", projectId }} label={page.label} onClose={() => setDialog(null)} show={show} />}
      {toast}
    </>
  );
}
