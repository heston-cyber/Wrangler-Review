// The project's Ledger tab (P3 / Owner / Project · Ledger, 266:2628): the estimate against what actually happened,
// with Log hours or a cost (266:3453) and Export to Google Sheet (266:3402, D58: the Settings Sheet's "Job ledger"
// tab). Hours cost what the rates say that subcontractor costs. Claude can draft an entry from your notes (D67); it
// counts once you confirm it. Only the owner sees this.
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, ButtonLink, Card, Checkbox, DialogHeader, Divider, EmptyState, ListRow, SectionHead, SkeletonRows, StatusChip, TextField } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal } from "../../ui/kit";
import { linkProps } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { MoneyInput, dateLong, dateShort, money } from "../payments/common";
import { todayLocal } from "./common";

type L = NonNullable<ReturnType<typeof useQuery<typeof api.crm.ledger>>>;
const q = (n: number) => String(Math.round(n * 100) / 100);
const OTHER = "__other";

function Diff({ v, unit, goodWhenUp = false }: { v: number; unit: "money" | "h" | "d"; goodWhenUp?: boolean }) {
  if (!v) return <span className="dim">—</span>;
  const bad = goodWhenUp ? v < 0 : v > 0;
  const txt = unit === "money" ? `${v > 0 ? "+" : "−"}${money(Math.abs(v))}` : `${v > 0 ? "+" : "−"}${q(Math.abs(v))}${unit === "h" ? " h" : ""}`;
  return <span className={bad ? "bad" : "ok"}>{txt}</span>;
}

function LogDialog({ l, onClose, show }: { l: L; onClose: () => void; show: (m: string) => void }) {
  const log = useMutation(api.crm.logEntry);
  const [workId, setWorkId] = useState(l.kinds[0]?.id ?? "");
  const costsFor = l.costs.filter((c) => c.kindId === workId);
  const [costId, setCostId] = useState(costsFor[0]?.id ?? "");
  const [hours, setHours] = useState(""), [cents, setCents] = useState(0), [date, setDate] = useState(todayLocal()), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const other = costId === OTHER;
  const unit = l.kinds.find((k) => k.id === workId)?.unit ?? "hour";
  const pickWork = (id: string) => { setWorkId(id); setCostId(l.costs.find((c) => c.kindId === id)?.id ?? (costId === OTHER ? OTHER : "")); };
  return (
    <Modal onClose={onClose} label="Log hours or a cost" width={560}>
      <form className="crm-dialog" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try {
          if (other) await log({ projectId: l.project._id, kind: "cost", ...(workId ? { workId } : {}), cents, date, ...(note.trim() ? { note } : {}) });
          else await log({ projectId: l.project._id, kind: "hours", workId, ...(costId ? { costId } : {}), hours: Number(hours), date, ...(note.trim() ? { note } : {}) });
          show("Logged."); onClose();
        } catch (err) { setError(errText(err)); setBusy(false); }
      }}>
        <DialogHeader eyebrow={l.project.label} title="Log hours or a cost" body="Goes into the ledger's actuals." onClose={onClose} />
        <div className="crm-grid2">
          <label className="wp-field"><span className="wp-field-label">Kind of work</span>
            <select className="input" value={workId} onChange={(e) => pickWork(e.target.value)}>{l.kinds.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select></label>
          {other ? <div className="wp-field"><span className="wp-field-label">Amount</span><MoneyInput label="Amount" value={cents} onChange={setCents} /></div>
            : <TextField label={unit === "day" ? "Days" : "Hours"} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="0" autoFocus />}
          <label className="wp-field"><span className="wp-field-label">Cost</span>
            <select className="input" value={costId} onChange={(e) => setCostId(e.target.value)}>
              {costsFor.map((c) => <option key={c.id} value={c.id}>{c.name} · {money(c.cents).replace(/\.00$/, "")} / {unit}</option>)}
              {!costsFor.length && <option value="">No subcontractor cost</option>}
              <option value={OTHER}>Other cost (an amount)</option>
            </select></label>
          <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <TextField label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={other ? "Drone rental" : "Second pass on the 15 s cut"} />
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" type="submit" loading={busy} disabled={other ? !cents : !(Number(hours) > 0)}>Log it</Button>
        </div>
      </form>
    </Modal>
  );
}

function ExportDialog({ l, onClose, show }: { l: L; onClose: () => void; show: (m: string) => void }) {
  const one = useMutation(api.crm.setLedgerExport);
  const all = useMutation(api.crm.setLedgerExportAll);
  const sheet = useQuery(api.register.sheetKey, {});
  const [only, setOnly] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  return (
    <Modal onClose={onClose} label="Export the job ledger" width={560}>
      <form className="crm-dialog" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try {
          if (only) { await one({ projectId: l.project._id, on: true }); show("Added to the Job ledger tab. It shows up the next time your Sheet updates."); }
          else { const n = await all({}); show(`${n} ${n === 1 ? "job" : "jobs"} in the Job ledger tab. They show up the next time your Sheet updates.`); }
          onClose();
        } catch (err) { setError(errText(err)); setBusy(false); }
      }}>
        <DialogHeader eyebrow="Job ledger" title="Export the job ledger to Google Sheets?" body="Adds or updates one row per job, so you can check it against your own Sheet." onClose={onClose} />
        <dl className="crm-dl crm-box">
          <dt>Sheet</dt><dd>{sheet === undefined ? "…" : sheet ? "The Google Sheet set in Settings › Google Sheet copy" : <a {...linkProps("/settings/sheet")}>Set one up in Settings › Google Sheet copy</a>}</dd>
          <dt className="big">Tab</dt><dd className="big">Job ledger</dd>
          <dt>Jobs</dt><dd>{only ? "This job" : "Every job with an estimate"}</dd>
        </dl>
        <Checkbox checked={only} onChange={setOnly} label={`Only this job (${l.project.label})`} />
        {sheet === null && <p className="wp-small">Your Sheet needs the latest script (Settings › Google Sheet copy) for the Job ledger tab.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" type="submit" loading={busy}>Export</Button>
        </div>
      </form>
    </Modal>
  );
}

function EntryRow({ e, show }: { e: L["entries"][number]; show: (m: string) => void }) {
  const act = useMutation(api.crm.entryAction);
  const [busy, setBusy] = useState(false);
  const go = async (action: "confirm" | "remove") => { setBusy(true); try { await act({ entryId: e._id as Id<"ledgerEntries">, action }); show(action === "confirm" ? "Confirmed." : "Removed."); } catch (er) { show(errText(er)); setBusy(false); } };
  const title = e.kind === "cost" ? `${e.note || "Cost"} · ${money(e.cents)}` : `${e.work ?? "Hours"} · ${q(e.hours ?? 0)}${e.unit === "day" ? (e.hours === 1 ? " day" : " days") : " h"}`;
  const meta = e.draft ? `Drafted by Claude${e.note ? ` · ${e.note}` : ""}` : [e.kind === "hours" ? e.cost ?? e.who : e.work, dateShort(e.date), e.kind === "hours" ? money(e.cents) : null, e.kind === "hours" ? e.note : null].filter(Boolean).join(" · ");
  return (
    <ListRow className="ilead" lead={{ icon: e.draft ? "note" : e.kind === "cost" ? "invoice" : "clock" }} title={title} meta={meta}
      chip={e.draft ? <StatusChip tone="neutral">Draft</StatusChip> : undefined}
      action={e.draft ? <span className="crm-acts"><Button size="sm" variant="ghost" disabled={busy} onClick={() => void go("remove")}>Remove</Button><Button size="sm" loading={busy} onClick={() => void go("confirm")}>Confirm</Button></span>
        : <button type="button" className="linkbtn crm-rm" disabled={busy} onClick={() => void go("remove")} aria-label="Remove entry"><Icon name="close" size={14} /></button>} />
  );
}

export function LedgerTab({ projectId, show }: { projectId: Id<"projects">; show: (m: string) => void }) {
  const l = useQuery(api.crm.ledger, { projectId });
  const [dialog, setDialog] = useState<null | "log" | "export">(null);
  const [all, setAll] = useState(false);
  if (l === undefined) return <Card label="Loading"><SkeletonRows n={5} /></Card>;
  if (l === null) return null;
  const e = l.estimate, a = l.actual;
  const actions = (
    <div className="crm-ledbar">
      <p className="wp-body">Estimate vs actual for {l.project.label}. Only you see this.</p>
      <span className="sp" />
      <Button onClick={() => setDialog("export")}>Export to Google Sheet</Button>
      <Button variant="primary" onClick={() => setDialog("log")} disabled={!l.kinds.length}>Log hours or a cost</Button>
    </div>
  );
  const shown = all ? l.entries : l.entries.slice(0, 4);
  return (
    <>
      {actions}
      <div className="crm-ledcols">
        <Card label="Estimate vs actual" head={<SectionHead label="Estimate vs actual" />}>
          {!e && (
            <div className="crm-pad">
              <EmptyState icon="invoice" title="No estimate for this job yet." body="Make one to compare against. Hours and costs you log count either way."
                actions={<ButtonLink variant="primary" to={`/clients/estimates/new?project=${projectId}${l.project.clientId ? `&client=${l.project.clientId}` : ""}`}>New estimate</ButtonLink>} />
            </div>
          )}
          <table className="crm-led">
            <thead><tr><th /><th>Estimate</th><th>Actual</th><th>Difference</th></tr></thead>
            <tbody>
              <tr className="grp"><td colSpan={4}>Time</td></tr>
              {l.kinds.map((k) => <tr key={k.id}><td>{k.name.replace(/ day$/i, "")} {k.unit === "hour" ? "hours" : "days"}</td><td>{e ? (k.unit === "hour" ? `${q(k.estQty)} h` : q(k.estQty)) : "—"}</td><td>{k.unit === "hour" ? `${q(k.actQty)} h` : q(k.actQty)}</td><td>{e ? <Diff v={k.actQty - k.estQty} unit={k.unit === "hour" ? "h" : "d"} /> : <span className="dim">—</span>}</td></tr>)}
              <tr className="grp line"><td colSpan={4}>Money</td></tr>
              <tr className="strong"><td>Client price</td><td>{e ? money(e.priceCents) : "—"}</td><td>{money(a.priceCents)}</td><td>{e ? <Diff v={a.priceCents - e.priceCents} unit="money" goodWhenUp /> : <span className="dim">—</span>}</td></tr>
              {l.kinds.map((k) => <tr key={k.id}><td>{k.name.replace(/ day$/i, "")} expense</td><td>{e ? money(k.estCents) : "—"}</td><td>{money(k.actCents)}</td><td>{e ? <Diff v={k.actCents - k.estCents} unit="money" /> : <span className="dim">—</span>}</td></tr>)}
              {l.otherCents > 0 && <tr><td>Other costs</td><td>{e ? money(0) : "—"}</td><td>{money(l.otherCents)}</td><td>{e ? <Diff v={l.otherCents} unit="money" /> : <span className="dim">—</span>}</td></tr>}
              <tr><td>Total expenses</td><td>{e ? money(e.expenseCents) : "—"}</td><td>{money(a.expenseCents)}</td><td>{e ? <Diff v={a.expenseCents - e.expenseCents} unit="money" /> : <span className="dim">—</span>}</td></tr>
              <tr className="strong line"><td>Net profit</td><td>{e ? money(e.netCents) : "—"}</td><td>{money(a.netCents)}</td><td>{e ? <Diff v={a.netCents - e.netCents} unit="money" goodWhenUp /> : <span className="dim">—</span>}</td></tr>
              <tr><td>Business reserve {q(l.reservePct)}%</td><td>{e ? money(e.reserveCents) : "—"}</td><td>{money(a.reserveCents)}</td><td>{e ? <Diff v={a.reserveCents - e.reserveCents} unit="money" goodWhenUp /> : <span className="dim">—</span>}</td></tr>
              <tr><td>Owner income {q(100 - l.reservePct)}%</td><td>{e ? money(e.ownerCents) : "—"}</td><td>{money(a.ownerCents)}</td><td>{e ? <Diff v={a.ownerCents - e.ownerCents} unit="money" goodWhenUp /> : <span className="dim">—</span>}</td></tr>
            </tbody>
          </table>
          <p className="crm-note">{a.billed ? `Actual price is what was billed. Paid so far: ${money(l.paidCents)} (from Stripe).` : "Nothing billed yet, so the actual price is the estimate's. Once you send invoices, it's what was billed."}{l.exportedAt ? ` In the Sheet's Job ledger tab since ${dateLong(new Date(l.exportedAt).toISOString().slice(0, 10))}.` : ""}</p>
        </Card>
        <Card label="Logged" head={<SectionHead label="Logged" count={l.entries.length} />}>
          {l.entries.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "clock" }} title="Nothing logged yet." meta="Log hours and costs as the job goes, or ask Claude to draft them from your notes." />
            : shown.map((x, i) => <div key={x._id} className="wp-rowwrap">{i > 0 && <Divider />}<EntryRow e={x} show={show} /></div>)}
          {l.entries.length > 4 && <button type="button" className="crm-more" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show all ${l.entries.length}`}<Icon name="chevron-down" size={14} /></button>}
        </Card>
      </div>
      {dialog === "log" && <LogDialog l={l} onClose={() => setDialog(null)} show={show} />}
      {dialog === "export" && <ExportDialog l={l} onClose={() => setDialog(null)} show={show} />}
    </>
  );
}
