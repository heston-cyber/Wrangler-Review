// Phase 3c · Vendors, the owner's side (D95: its own layer): All vendors (730:2, empty 730:653), the vendor page
// (730:1153) and Add vendor (732:2909). Bookings, briefings and payments fill the vendor page's cards in the next steps.
import { Fragment, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Avatar, Button, ButtonLink, Card, Checkbox, DialogHeader, Divider, EmptyState, ListRow, PageHeader, PillTabs, SectionHead, SkeletonRows, StatusChip } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal, useConfirm, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { MoneyInput, money } from "../payments/common";

export const VENDOR_ROLES = ["Shooter", "Editor", "Drone pilot", "Sound", "Colourist", "Production assistant"];
type Rate = { role: string; unit: "day" | "hour"; cents: number };
type Details = { name: string; email: string; roles: string[]; rates: Rate[]; basedIn?: string; phone?: string; portfolio?: string; gear?: string[]; notes?: string };
const perUnit = (r: { cents: number; unit: "day" | "hour" }) => `${money(r.cents)} / ${r.unit}`;

// ---------- All vendors ----------

export default function VendorsPage() {
  const rows = useQuery(api.vendors.list, {});
  const [pill, setPill] = useState("all");
  const [adding, setAdding] = useState(false);
  const roles = [...new Set((rows ?? []).flatMap((r) => r.roles))].sort((a, b) => (rows ?? []).filter((r) => r.roles.includes(b)).length - (rows ?? []).filter((r) => r.roles.includes(a)).length).slice(0, 3);
  const shown = (rows ?? []).filter((r) => pill === "all" || (pill === "w9" ? !r.w9 : r.roles.includes(pill)));
  return (
    <>
      <TopBar><a {...linkProps("/vendors")}>Vendors</a><Sep /><span className="here">All vendors</span></TopBar>
      <div className="wp-page">
        <PageHeader eyebrow="Vendors" title="All vendors." sub="Shooters, editors and anyone else you hire. They get their own portal to accept bookings and send invoices." actions={<Button variant="primary" onClick={() => setAdding(true)}>Add vendor</Button>} />
        {rows === undefined ? <Card label="Loading"><SkeletonRows n={4} /></Card> : rows.length === 0 ? (
          <EmptyState icon="user" title="No vendors yet." body="Add the shooters, editors and crew you hire. Book them on projects, send briefings, and track their invoices and 1099 totals here." actions={<Button variant="primary" onClick={() => setAdding(true)}>Add vendor</Button>} />
        ) : (
          <>
            <PillTabs label="Show" value={pill} onChange={setPill} items={[{ key: "all", label: "All", count: rows.length }, ...roles.map((r) => ({ key: r, label: `${r}s`, count: rows.filter((x) => x.roles.includes(r)).length })), { key: "w9", label: "W-9 missing", count: rows.filter((r) => !r.w9).length }]} />
            <Card label="Vendors" className="q-list">
              {shown.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "user" }} title="None here." /> : shown.map((r, i) => (
                <div key={r._id} className="wp-rowwrap">{i > 0 && <Divider />}
                  <ListRow lead={{ avatar: r.name }} to={`/vendors/${r._id}`} title={r.name} meta={[r.roles.join(", ") || "No role yet", r.basedIn, r.portal].filter(Boolean).join(" · ")}
                    trailing={`${money(r.paidThisYearCents)} this year`} chip={r.w9 ? <StatusChip tone="success">W-9 on file</StatusChip> : <StatusChip tone="warning">W-9 missing</StatusChip>} chevron />
                </div>
              ))}
            </Card>
          </>
        )}
      </div>
      {adding && <VendorDialog onClose={() => setAdding(false)} />}
    </>
  );
}

// ---------- Add vendor / edit details (732:2909) ----------

export function VendorDialog({ onClose, vendor }: { onClose: () => void; vendor?: Details & { _id: Id<"vendors"> } }) {
  const add = useMutation(api.vendors.add);
  const update = useMutation(api.vendors.update);
  const [d, setD] = useState<Details>(vendor ? { ...vendor } : { name: "", email: "", roles: [], rates: [] });
  const [invite, setInvite] = useState(true);
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const first = d.name.trim().split(" ")[0] || "them";
  const toggle = (r: string) => setD({ ...d, roles: d.roles.includes(r) ? d.roles.filter((x) => x !== r) : [...d.roles, r] });
  const rate0 = d.rates[0] ?? { role: d.roles[0] ?? "", unit: "hour" as const, cents: 0 };
  const setRate0 = (p: Partial<Rate>) => setD({ ...d, rates: [{ ...rate0, ...p }, ...d.rates.slice(1)] });
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const body = { ...d, rates: d.rates.filter((r) => r.cents > 0).map((r) => ({ ...r, role: r.role || d.roles[0] || "Rate" })) };
      if (vendor) { await update({ vendorId: vendor._id, ...body }); onClose(); }
      else { const id = await add({ ...body, invite }); navigate(`/vendors/${id}`); }
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label={vendor ? "Edit vendor" : "Add a vendor"} width={600}>
      <div className="crm-dialog">
        <DialogHeader eyebrow="Vendors" title={vendor ? `Edit ${vendor.name}.` : "Add a vendor."} body={vendor ? undefined : "Save their details. Invite them to their own portal now or later."} onClose={onClose} />
        <div className="qz-grid">
          <label className="wp-field qz-q"><span className="wp-field-label">Name</span><input className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
          <label className="wp-field qz-q"><span className="wp-field-label">Email</span><span className="qz-icon-in"><Icon name="mail" size={16} /><input className="input" type="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} /></span></label>
          <div className="wp-field qz-q wide"><span className="wp-field-label">Roles</span>
            <div className="qz-chips">
              {[...VENDOR_ROLES, ...d.roles.filter((r) => !VENDOR_ROLES.includes(r))].map((r) => <button key={r} type="button" className={`qz-chip${d.roles.includes(r) ? " on" : ""}`} aria-pressed={d.roles.includes(r)} onClick={() => toggle(r)}>{r}</button>)}
              <span className="qz-addword"><input className="input sm" placeholder="+ Other" aria-label="Another role" value={other} onChange={(e) => setOther(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && other.trim()) { e.preventDefault(); if (!d.roles.includes(other.trim())) toggle(other.trim()); setOther(""); } }} /></span>
            </div></div>
          <div className="wp-field qz-q"><span className="wp-field-label">Their rate (optional)</span>
            <span className="vd-rate"><MoneyInput label="Their rate" value={rate0.cents} onChange={(c) => setRate0({ cents: c })} />
              <select className="input" aria-label="Per" value={rate0.unit} onChange={(e) => setRate0({ unit: e.target.value as "day" | "hour" })}><option value="hour">/ hour</option><option value="day">/ day</option></select></span></div>
          <label className="wp-field qz-q"><span className="wp-field-label">Based in (optional)</span><input className="input" value={d.basedIn ?? ""} onChange={(e) => setD({ ...d, basedIn: e.target.value })} /></label>
          {vendor && <>
            <label className="wp-field qz-q"><span className="wp-field-label">Phone</span><input className="input" type="tel" value={d.phone ?? ""} onChange={(e) => setD({ ...d, phone: e.target.value })} /></label>
            <label className="wp-field qz-q"><span className="wp-field-label">Portfolio</span><input className="input" value={d.portfolio ?? ""} onChange={(e) => setD({ ...d, portfolio: e.target.value })} /></label>
            <label className="wp-field qz-q wide"><span className="wp-field-label">Gear (comma between items)</span><input className="input" value={(d.gear ?? []).join(", ")} onChange={(e) => setD({ ...d, gear: e.target.value.split(",").map((x) => x.trim()) })} /></label>
            <label className="wp-field qz-q wide"><span className="wp-field-label">Notes</span><textarea className="input" rows={3} value={d.notes ?? ""} onChange={(e) => setD({ ...d, notes: e.target.value })} /></label>
          </>}
        </div>
        {!vendor && <><hr className="wp-divider" /><Checkbox checked={invite} onChange={setInvite} label={`Invite ${first} to the vendor portal`} hint="They get an email to set up a login. If they already work with another business on the portal, they use the same login." /></>}
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" loading={busy} disabled={!d.name.trim() || !d.email.trim()} onClick={() => void save()}>{vendor ? "Save" : invite ? "Add and invite" : "Add vendor"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- the vendor page (730:1153) ----------

export function VendorPage({ vendorId }: { vendorId: string }) {
  const x = useQuery(api.vendors.get, { vendorId });
  const archive = useMutation(api.vendors.archive);
  const [editing, setEditing] = useState(false);
  const [toast, show] = useToast();
  const [confirm, confirmNode] = useConfirm();
  if (x === undefined) return <><TopBar><a {...linkProps("/vendors")}>Vendors</a></TopBar><div className="wp-page"><Card label="Loading"><SkeletonRows n={5} /></Card></div></>;
  if (x === null) return <><TopBar><a {...linkProps("/vendors")}>Vendors</a></TopBar><div className="wp-page"><EmptyState icon="user" title="This vendor isn't here." actions={<ButtonLink to="/vendors">All vendors</ButtonLink>} /></div></>;
  const first = x.name.split(" ")[0];
  const t = x.totals;
  const details: Array<[string, React.ReactNode]> = ([["Email", x.email], ["Phone", x.phone], ["Based in", x.basedIn], ["Portfolio", x.portfolio ? <a href={/^https?:\/\//.test(x.portfolio) ? x.portfolio : `https://${x.portfolio}`} target="_blank" rel="noopener noreferrer">{x.portfolio.replace(/^https?:\/\//, "")}</a> : null]] as Array<[string, React.ReactNode]>).filter(([, v]) => v);
  return (
    <>
      <TopBar><a {...linkProps("/vendors")}>Vendors</a><Sep /><a {...linkProps("/vendors")}>All vendors</a><Sep /><span className="here">{x.name}</span></TopBar>
      <div className="wp-page cp">
        <header className="cp-head">
          <Avatar name={x.name} two size={56} />
          <div className="txt"><h1 className="wp-h2">{x.name}</h1>
            <div className="tags">{x.roles.map((r) => <span key={r} className="wp-tag">{r}</span>)}<span className="wp-tag">{x.portal === "in the portal" ? "In the portal" : x.portal === "not invited" ? "Not invited" : x.portal.replace(/^invited/, "Invited")}</span></div></div>
          <div className="acts">
            <Button disabled title="Briefings arrive in the next build step">Send briefing</Button>
            <Button variant="primary" disabled title="Bookings arrive in the next build step">Book</Button>
          </div>
        </header>
        <div className="vd-tiles">
          <section className="vd-tile glass"><span className="wp-eyebrow">Paid this year</span><b>{money(t.paidThisYearCents)}</b><span className="wp-small secondary">for your 1099 total</span></section>
          <section className="vd-tile glass"><span className="wp-eyebrow">Approved, not paid</span><b>{money(t.approvedCents)}</b><span className="wp-small secondary">{t.approvedCount} invoice{t.approvedCount === 1 ? "" : "s"}</span></section>
          <section className="vd-tile glass"><span className="wp-eyebrow">Waiting for approval</span><b>{money(t.waitingCents)}</b><span className="wp-small secondary">{t.waitingCount} invoice{t.waitingCount === 1 ? "" : "s"}</span></section>
        </div>
        <div className="wp-homecols">
          <div className="col">
            <Card label="Bookings" head={<SectionHead label="Bookings" count={0} />}><ListRow className="ilead quiet" lead={{ icon: "calendar" }} title={`No bookings yet. Book ${first} on a project.`} /></Card>
            <Card label="Briefings" head={<SectionHead label="Briefings" count={0} />}><ListRow className="ilead quiet" lead={{ icon: "note" }} title="No briefings sent yet." /></Card>
            <Card label="Invoices and payments" head={<SectionHead label="Invoices and payments" count={0} />}><ListRow className="ilead quiet" lead={{ icon: "invoice" }} title={`Nothing from ${first} yet.`} /></Card>
          </div>
          <div className="col right">
            <Card label="Rates" head={<SectionHead label="Rates" action={<button type="button" className="btn ghost sm" onClick={() => setEditing(true)}>Edit</button>} />}>
              <div className="vd-pad">
                {x.rates.length === 0 && x.costs.length === 0 && <p className="wp-small secondary">No rates yet.</p>}
                {x.roles.map((role) => {
                  const r = x.rates.find((y) => y.role === role);
                  const c = x.costs.find((y) => y.role === role)?.cost;
                  return <Fragment key={role}><div className="vd-row"><span className="secondary">{role}</span><b>{r ? perUnit(r) : "—"}</b></div>{c && <p className="wp-small secondary vd-cost">Your Pricing cost for {c.name}: {perUnit(c)}</p>}</Fragment>;
                })}
                {x.rates.filter((r) => !x.roles.includes(r.role)).map((r) => <div key={r.role} className="vd-row"><span className="secondary">{r.role}</span><b>{perUnit(r)}</b></div>)}
              </div>
            </Card>
            <Card label="Details" head={<SectionHead label="Details" action={<button type="button" className="btn ghost sm" onClick={() => setEditing(true)}>Edit</button>} />}>
              <dl className="crm-dl vd-pad">{details.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
            </Card>
            {!!x.gear?.length && <Card label="Gear" head={<SectionHead label="Gear" />}><div className="vd-pad vd-gear">{x.gear.map((g) => <span key={g} className="wp-tag">{g}</span>)}</div></Card>}
            <Card label="Tax" head={<SectionHead label="Tax" />}>
              <div className="vd-pad"><div className="vd-row"><span>W-9</span>{x.w9 ? <StatusChip tone="success">On file</StatusChip> : <StatusChip tone="warning">Missing</StatusChip>}</div>
                <p className="wp-small secondary">{x.w9 ? <>Uploaded by {first} {new Date(x.w9.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. {x.w9.url && <a href={x.w9.url} target="_blank" rel="noopener noreferrer">Download it</a>}; it isn't shown to anyone else.</> : `${first} uploads it in their vendor portal. Ask your accountant when you need it before paying them.`}</p></div>
            </Card>
            {x.notes && <Card label="Notes" head={<SectionHead label="Notes" />}><p className="wp-body vd-pad vd-notes">{x.notes}</p></Card>}
            <button type="button" className="btn ghost sm vd-archive" onClick={async () => { if (!(await confirm({ title: `Take ${x.name} off your vendors?`, body: "Their bookings, invoices and 1099 totals stay. You can add them back later.", yes: "Take off" }))) return; try { await archive({ vendorId: x._id, archived: true }); navigate("/vendors"); } catch (e) { show(errText(e)); } }}>Take off the vendor list</button>
          </div>
        </div>
      </div>
      {editing && <VendorDialog onClose={() => setEditing(false)} vendor={x} />}
      {confirmNode}{toast}
    </>
  );
}
