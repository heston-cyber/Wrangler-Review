// Phase 3 (Oct 31): pieces the CRM pages share. Follow-up rows and the Add follow-up dialog (267:2848), stage names,
// and small date words. Back office only (T3.5).
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, DialogHeader, ListRow, StatusChip, TextField } from "../../ui/wp";
import { Modal } from "../../ui/kit";
import { errText } from "../docs/pages/common";
import { dateLong, dateShort } from "../payments/common";

export type Stage = "lead" | "quoted" | "contract_sent" | "signed" | "in_production" | "delivered" | "paid";
export const STAGES: Array<{ key: Stage; name: string }> = [
  { key: "lead", name: "Lead" }, { key: "quoted", name: "Quoted" }, { key: "contract_sent", name: "Contract sent" }, { key: "signed", name: "Signed" },
  { key: "in_production", name: "In production" }, { key: "delivered", name: "Delivered" }, { key: "paid", name: "Paid" },
];
export const stageName = (s: Stage) => STAGES.find((x) => x.key === s)?.name ?? s;

/** Today in the owner's own time zone, as yyyy-mm-dd. */
export const todayLocal = (plus = 0) => { const d = new Date(Date.now() + plus * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const hrs = (n: number) => `${Math.round(n * 100) / 100} h`;

export type FollowUp = { _id: Id<"followUps">; who: string; about: string; due: string; note?: string; draft?: boolean; company?: string | null; createdBy?: string };

export function dueWord(due: string) {
  const today = todayLocal();
  if (due < today) return `was due ${dateShort(due)}`;
  if (due === today) return "due today";
  return `due ${dateShort(due)}`;
}
export function dueChip(due: string) {
  const today = todayLocal();
  if (due < today) return <StatusChip tone="danger">Overdue</StatusChip>;
  if (due === today) return <StatusChip tone="warning">Today</StatusChip>;
  if (due <= todayLocal(2)) return <StatusChip tone="warning">Due</StatusChip>;
  return null;
}

/** "Follow up with Maya · Social clips add-on · due Nov 2", with Done (or Confirm for one Claude drafted). */
export function FollowUpRow({ f, show, context }: { f: FollowUp; show: (m: string) => void; context?: string | null }) {
  const done = useMutation(api.crm.doneFollowUp);
  const [busy, setBusy] = useState(false);
  const act = async (args: { confirm?: boolean; remove?: boolean }, msg: string) => {
    setBusy(true);
    try { await done({ followUpId: f._id, ...args }); show(msg); } catch (e) { show(errText(e)); } finally { setBusy(false); }
  };
  const title = /^(follow up|reply|check in|call|email)/i.test(f.who) ? f.who : `Follow up with ${f.who}`;
  const meta = [context, f.about, f.draft ? "drafted by Claude" : dueWord(f.due)].filter(Boolean).join(" · ");
  return (
    <ListRow className="ilead" lead={{ icon: "bell" }} title={title} meta={meta}
      chip={f.draft ? <StatusChip tone="neutral">Draft</StatusChip> : <span className="pc-only">{dueChip(f.due)}</span>}
      action={f.draft
        ? <span className="crm-acts"><Button size="sm" variant="ghost" disabled={busy} onClick={() => void act({ remove: true }, "Removed.")}>Remove</Button><Button size="sm" loading={busy} onClick={() => void act({ confirm: true }, "Follow-up added.")}>Confirm</Button></span>
        : <Button size="sm" loading={busy} onClick={() => void act({}, "Done.")}>Done</Button>} />
  );
}

/** Add a follow-up (P3 / Owner / Dialog · Add follow-up, 267:2848). */
export function AddFollowUp({ onClose, show, eyebrow, who: who0 = "", email, clientId, dealId, about: about0 = "" }: {
  onClose: () => void; show: (m: string) => void; eyebrow?: string | null; who?: string; email?: string | null; clientId?: Id<"clients"> | null; dealId?: Id<"deals"> | null; about?: string;
}) {
  const add = useMutation(api.crm.addFollowUp);
  const [who, setWho] = useState(who0), [about, setAbout] = useState(about0), [due, setDue] = useState(todayLocal(2)), [note, setNote] = useState("");
  const [remind, setRemind] = useState<"morning_of" | "day_before">("morning_of");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  return (
    <Modal onClose={onClose} label="Add a follow-up" width={560}>
      <form className="crm-dialog" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try {
          await add({ who, about, due, remind, ...(note.trim() ? { note } : {}), ...(email ? { email } : {}), ...(clientId ? { clientId } : {}), ...(dealId ? { dealId } : {}) });
          show(`Follow-up added for ${dateLong(due)}.`); onClose();
        } catch (err) { setError(errText(err)); setBusy(false); }
      }}>
        <DialogHeader eyebrow={eyebrow ?? undefined} title="Add a follow-up" body="Claude checks follow-ups each morning, and due ones can show in your daily brief." onClose={onClose} />
        <div className="crm-grid2">
          <TextField label="Who" value={who} onChange={(e) => setWho(e.target.value)} placeholder="Name" autoFocus={!who0} />
          <TextField label="About (optional)" value={about} onChange={(e) => setAbout(e.target.value)} placeholder="What it's about" />
          <TextField label="Due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <label className="wp-field"><span className="wp-field-label">Remind me</span>
            <select className="input" value={remind} onChange={(e) => setRemind(e.target.value as typeof remind)}>
              <option value="morning_of">Morning of</option><option value="day_before">The day before</option>
            </select>
          </label>
        </div>
        <TextField label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything to remember" />
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" type="submit" loading={busy} disabled={!who.trim() || !due}>Add follow-up</Button>
        </div>
      </form>
    </Modal>
  );
}
