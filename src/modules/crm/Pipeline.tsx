// Clients › Pipeline (P3 / Owner / Pipeline: 262:31733 board, 262:32142 dragging, 265:3246 empty, 267:2931 phone).
// Seven fixed columns (D59). Cards move on their own on real events, forward only (D60); dragging a card puts it where
// you drop it. Back office only.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, DialogHeader, EmptyState, PageHeader, PillTabs, TextField } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { MoneyInput, dateShort, money } from "../payments/common";
import { STAGES, type Stage, todayLocal } from "./common";

type Board = NonNullable<ReturnType<typeof useQuery<typeof api.crm.board>>>;
type Deal = Board["deals"][number];
type Filter = "all" | "website" | "due";

function Card({ d, onDragStart, dragging }: { d: Deal; onDragStart: (id: Id<"deals"> | null) => void; dragging: boolean }) {
  const due = d.followUp && d.followUp <= todayLocal(2);
  return (
    <a {...linkProps(`/clients/deals/${d._id}`)} className={`crm-card${dragging ? " dragging" : ""}`} draggable
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", d._id); e.dataTransfer.effectAllowed = "move"; onDragStart(d._id); }}
      onDragEnd={() => onDragStart(null)}>
      {d.website && <span className="wp-tag crm-web">From the website</span>}
      <span className="co">{d.company ?? d.title}</span>
      <span className="sub">{d.project ?? (d.company ? d.title : d.website ? "Website form" : "")}</span>
      <span className="foot">
        <span className="val">{d.valueCents ? money(d.valueCents) : "—"}</span>
        {d.followUp && <span className={`fu${due ? " due" : ""}`}><Icon name="bell" size={12} />{dateShort(d.followUp).toUpperCase()}</span>}
      </span>
    </a>
  );
}

function AddLead({ onClose, show }: { onClose: () => void; show: (m: string) => void }) {
  const add = useMutation(api.crm.addDeal);
  const companies = useQuery(api.crm.companies, {});
  const [title, setTitle] = useState(""), [clientId, setClientId] = useState(""), [cents, setCents] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  return (
    <Modal onClose={onClose} label="Add a lead" width={520}>
      <form className="crm-dialog" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try {
          const id = await add({ title, ...(clientId ? { clientId: clientId as Id<"clients"> } : {}), ...(cents ? { valueCents: cents } : {}) });
          show("Lead added."); onClose(); navigate(`/clients/deals/${id}`);
        } catch (err) { setError(errText(err)); setBusy(false); }
      }}>
        <DialogHeader eyebrow="Pipeline" title="Add a lead" body="It starts in Lead. Saving an estimate moves it to Quoted." onClose={onClose} />
        <TextField label="What it is" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Brand film" autoFocus />
        <label className="wp-field"><span className="wp-field-label">Company (optional)</span>
          <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Not a client yet</option>
            {(companies ?? []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
        </label>
        <div className="wp-field"><span className="wp-field-label">Value (optional)</span><MoneyInput label="Value" value={cents} onChange={setCents} /></div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" type="submit" loading={busy} disabled={!title.trim()}>Add lead</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function Pipeline() {
  const board = useQuery(api.crm.board, {});
  const move = useMutation(api.crm.moveDeal);
  const [toast, show] = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);
  const [drag, setDrag] = useState<Id<"deals"> | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const [phoneStage, setPhoneStage] = useState<Stage>("lead");
  const today2 = todayLocal(2);
  const deals = useMemo(() => (board?.deals ?? []).filter((d) => filter === "all" || (filter === "website" ? d.website : !!d.followUp && d.followUp <= today2)), [board, filter, today2]);
  const drop = async (stage: Stage) => {
    const id = drag; setDrag(null); setOver(null);
    const d = board?.deals.find((x) => x._id === id);
    if (!id || !d || d.stage === stage) return;
    try { await move({ dealId: id, stage }); show(`Moved to ${STAGES.find((s) => s.key === stage)!.name}.`); } catch (e) { show(errText(e)); }
  };
  const nWeb = (board?.deals ?? []).filter((d) => d.website).length;
  const nDue = (board?.deals ?? []).filter((d) => d.followUp && d.followUp <= today2).length;
  return (
    <>
      <TopBar><a {...linkProps("/clients")}>Clients</a><Sep /><span className="here">Pipeline</span></TopBar>
      <div className="wp-page crm-pipe">
        <PageHeader eyebrow="Clients" title="Pipeline." sub="Every lead and job, from first contact to paid." actions={<Button variant="primary" onClick={() => setAdding(true)}>Add lead</Button>} />
        {board === undefined ? <div className="crm-cols"><div className="crm-col skel" /><div className="crm-col skel" /><div className="crm-col skel" /></div>
          : board.deals.length === 0 ? (
            <EmptyState icon="activity" title="No leads yet." body="Leads from your website land here, and so do cards you add. Saving an estimate moves a card to Quoted; contracts, project stages and payments move it on from there."
              actions={<Button variant="primary" onClick={() => setAdding(true)}>Add lead</Button>} />
          ) : (
            <>
              <div className="crm-sums" role="list">
                {board.stages.map((s) => (
                  <button type="button" role="listitem" key={s.key} className={`crm-sum${phoneStage === s.key ? " on" : ""}`} onClick={() => setPhoneStage(s.key as Stage)}>
                    <span className="lbl">{s.name}</span><span className="n">{s.n} · {money(s.cents).replace(/\.00$/, "")}</span>
                  </button>
                ))}
              </div>
              <PillTabs label="Show" value={filter} onChange={setFilter} items={[{ key: "all", label: "All" }, { key: "website", label: "From the website", count: nWeb }, { key: "due", label: "Follow-up due", count: nDue }]} />
              <div className="crm-cols">
                {STAGES.map((s) => {
                  const list = deals.filter((d) => d.stage === s.key);
                  return (
                    <section key={s.key} className={`crm-col${over === s.key ? " over" : ""}${phoneStage === s.key ? " ph-on" : ""}`} aria-label={s.name}
                      onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(s.key); } }} onDragLeave={() => setOver((o) => (o === s.key ? null : o))}
                      onDrop={(e) => { e.preventDefault(); void drop(s.key); }}>
                      <h2 className="crm-colhead">{s.name} <span>{list.length}</span></h2>
                      {list.map((d) => <Card key={d._id} d={d} dragging={drag === d._id} onDragStart={setDrag} />)}
                      {s.key === "lead" && <button type="button" className="crm-addlead" onClick={() => setAdding(true)}><Icon name="plus" size={14} />Add lead</button>}
                      {/* Phones can't drag: each card's page has Move to. */}
                    </section>
                  );
                })}
              </div>
            </>
          )}
      </div>
      {adding && <AddLead onClose={() => setAdding(false)} show={show} />}
      {toast}
    </>
  );
}
