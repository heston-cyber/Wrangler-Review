// Settings › Pricing (Phase 3b, D76: Estimate rates grown; P3b / Owner / Settings · Pricing 707:1178, 707:1774, 705:2;
// first drawn as Settings › Estimate rates, 263:1382). Every card folds to one summary line. How a business prices a job, built
// from general pieces: kinds of work (per hour or per day), subcontractor costs (expenses only, never added to the
// client's price), links (D53: one kind's hours from one base kind × a level, no chains), day lengths (D55), the travel
// rule (D54) and the profit split. Wrangler starts from me-wrangler § 4; other businesses start empty. Clients never
// see any of this.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { estimate, formulaNames, formulaPrice, primaryKind, quantityNames, ratesProblems, type Cost, type Discount, type Kind, type Link, type Rates } from "../../../convex/lib/estimate";
import { Button, Card, IconButton, SectionHead, Segmented, SkeletonRows, StatusChip, Toggle } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { errText } from "../docs/pages/common";
import { MoneyInput, money, newId } from "../payments/common";
import { SetHead } from "./Frame";

const num = (s: string) => { const n = Number(s); return Number.isFinite(n) ? n : 0; };
const q = (n: number) => String(Math.round(n * 100) / 100);

function NumIn({ value, onChange, label, suffix, width = 140 }: { value: number; onChange: (n: number) => void; label: string; suffix?: string; width?: number }) {
  const [t, setT] = useState(q(value));
  useEffect(() => { if (num(t) !== value) setT(q(value)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [value]);
  return <span className="rt-num" style={{ width }}><input className="input" inputMode="decimal" aria-label={label} value={t} onChange={(e) => { setT(e.target.value); onChange(num(e.target.value)); }} />{suffix && <span className="sfx">{suffix}</span>}</span>;
}
const Add = ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => <button type="button" className="rt-add" onClick={onClick}><Icon name="plus" size={14} />{children}</button>;
/** A card that folds to one line (Section head · fold, 707:492): label, count and a summary when closed. */
function Fold({ label, count, summary, children, defaultOpen = false }: { label: string; count?: number; summary?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`wp-card glass rt fold${open ? " open" : ""}`} aria-label={label}>
      <button type="button" className="rt-fold" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="wp-eyebrow">{label}</span>{count !== undefined && <span className="cnt">{count}</span>}
        {!open && summary && <span className="sum">{summary}</span>}
        <Icon name="chevron-down" size={16} className="chev" />
      </button>
      {open && <div className="rt-foldbody">{children}</div>}
    </section>
  );
}
const Remove = ({ label, onClick }: { label: string; onClick: () => void }) => <IconButton icon="close" label={label} bare iconSize={16} className="rt-x" onClick={onClick} />;

export default function RatesSection({ show }: { show: (m: string) => void }) {
  const data = useQuery(api.crm.rates, {});
  const save = useMutation(api.crm.saveRates);
  const [r, setR] = useState<Rates | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data && !r) setR(structuredClone(data.rates as Rates)); }, [data, r]);
  const problems = useMemo(() => (r ? ratesProblems(r) : []), [r]);
  const dirty = !!r && !!data && JSON.stringify(r) !== JSON.stringify(data.rates);
  if (!data || !r) return <><SetHead eyebrow="Pricing" title="How you price a job." /><Card label="Loading"><SkeletonRows n={5} /></Card></>;
  const up = (p: Partial<Rates>) => setR({ ...r, ...p });
  const kind = (id: string) => r.kinds.find((k) => k.id === id);
  const setKind = (i: number, p: Partial<Kind>) => up({ kinds: r.kinds.map((k, j) => (j === i ? { ...k, ...p } : k)) });
  const setCost = (i: number, p: Partial<Cost>) => up({ costs: r.costs.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const setLink = (i: number, p: Partial<Link>) => up({ links: r.links.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  const hourKinds = r.kinds.filter((k) => k.unit === "hour");
  const dayKinds = r.kinds.filter((k) => k.unit === "day");
  const k0 = primaryKind(r);
  const usable = !problems.length && k0;
  const check = usable ? estimate(r, { base: { [k0.id]: 4 * r.fullDayHours } }) : null;
  const travel = usable && r.travel.on ? estimate(r, { base: { [k0.id]: 4 * r.fullDayHours }, travelOver: true, travelDays: 1 }) : null;
  const defaults = r.defaults ?? { hourlyCents: 0, dailyCents: 0 };
  const discounts: Discount[] = r.discounts ?? [];
  const setDisc = (i: number, p: Partial<Discount>) => up({ discounts: discounts.map((d, j) => (j === i ? { ...d, ...p } : d)) });
  const qtyNames = quantityNames(r);
  const formula = r.formula ?? { on: false, text: "" };
  const fNames = formulaNames(r);
  const fCheck = k0 && formula.text.trim() ? formulaPrice({ ...r, formula: { on: true, text: formula.text } }, estimate(r, { base: { [k0.id]: 4 * r.fullDayHours } })) : "";
  const link0 = r.links[0];
  const defLevel = link0?.levels.find((x) => x.id === link0.defaultLevel);
  const onSave = async () => {
    setBusy(true);
    try { await save({ rates: r }); show("Pricing saved. New estimates, quotes and proposals use it; saved ones keep theirs."); } catch (e) { show(errText(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <SetHead eyebrow="Pricing" title="How you price a job." sub="Estimates, quotes and proposals suggest prices from these. You can type a different number on any of them. Clients never see costs, profit or the split." />

      <Fold label="Default rates" summary={`Hourly ${money(defaults.hourlyCents)} · Daily ${money(defaults.dailyCents)}`.replace(/\.00/g, "")}>
        <div className="rt-pad">
          <div className="rt-two">
            <div className="wp-field"><span className="wp-field-label">Hourly rate</span><MoneyInput label="Hourly rate" value={defaults.hourlyCents} onChange={(c) => up({ defaults: { ...defaults, hourlyCents: c } })} /></div>
            <div className="wp-field"><span className="wp-field-label">Daily rate</span><MoneyInput label="Daily rate" value={defaults.dailyCents} onChange={(c) => up({ defaults: { ...defaults, dailyCents: c } })} /></div>
          </div>
          <p className="rt-note">Suggested for any line that isn't one of your kinds of work below.</p>
        </div>
      </Fold>

      <Fold label="Rates by kind of work" count={r.kinds.length} summary={r.kinds.map((k) => k.name).filter(Boolean).join(" · ")}>
        <div className="rt-table">
          <div className="rt-h k"><span>Name</span><span>Billed</span><span>Client rate</span><span /></div>
          {r.kinds.map((k, i) => (
            <div key={k.id} className="rt-row k">
              <input className="input" aria-label="Kind of work" value={k.name} onChange={(e) => setKind(i, { name: e.target.value })} placeholder="Shooting" />
              <Segmented label={`${k.name || "Kind"} billed`} value={k.unit} onChange={(u) => setKind(i, { unit: u })} items={[{ key: "hour", label: "Per hour" }, { key: "day", label: "Per day" }]} />
              <MoneyInput label={`${k.name} client rate`} value={k.clientCents} onChange={(c) => setKind(i, { clientCents: c })} />
              <Remove label={`Remove ${k.name}`} onClick={() => up({ kinds: r.kinds.filter((_, j) => j !== i) })} />
            </div>
          ))}
          <Add onClick={() => up({ kinds: [...r.kinds, { id: newId(), name: "", unit: "hour", clientCents: 0 }] })}>Add rate</Add>
        </div>
      </Fold>

      <Fold label="Subcontractor costs" count={r.costs.length} summary={r.costs.map((c) => c.name).filter(Boolean).join(" · ")}>
        <p className="rt-note">What you pay out, per kind of work. Used for expenses and profit only; never added to the client's price.</p>
        <div className="rt-table">
          <div className="rt-h c"><span>Cost</span><span>For</span><span>Rate</span><span /></div>
          {r.costs.map((c, i) => (
            <div key={c.id} className="rt-row c">
              <input className="input" aria-label="Cost" value={c.name} onChange={(e) => setCost(i, { name: e.target.value })} placeholder="Shooter" />
              <select className="input" aria-label={`${c.name} is for`} value={c.kindId} onChange={(e) => setCost(i, { kindId: e.target.value })}>
                <option value="">Pick a kind of work</option>
                {r.kinds.map((k) => <option key={k.id} value={k.id}>{k.name || "Untitled"}</option>)}
              </select>
              <span className="rt-money"><MoneyInput label={`${c.name} rate`} value={c.cents} onChange={(v) => setCost(i, { cents: v })} /><span className="sfx">/ {kind(c.kindId)?.unit ?? "hour"}</span></span>
              <Remove label={`Remove ${c.name}`} onClick={() => up({ costs: r.costs.filter((_, j) => j !== i) })} />
            </div>
          ))}
          <Add onClick={() => up({ costs: [...r.costs, { id: newId(), name: "", kindId: r.kinds[0]?.id ?? "", cents: 0 }] })}>Add cost</Add>
        </div>
      </Fold>

      <Fold label="Multipliers" count={r.links.reduce((t, l) => t + l.levels.length, 0)} summary={r.links.map((l) => `${kind(l.target)?.name ?? "?"} from ${(kind(l.base)?.name ?? "?").toLowerCase()} · ${l.levels.length} levels`).join(" · ")}>
        {r.links.map((l, i) => (
          <div key={l.id} className="rt-link">
            <span className="rt-sub">Link {i + 1} · {kind(l.target)?.name || "?"} from {kind(l.base)?.name || "?"}</span>
            <div className="rt-eq">
              <label className="wp-field"><span className="wp-field-label">Hours of</span>
                <select className="input" value={l.target} onChange={(e) => setLink(i, { target: e.target.value })}>{hourKinds.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select></label>
              <span className="op">=</span>
              <label className="wp-field"><span className="wp-field-label">Hours of</span>
                <select className="input" value={l.base} onChange={(e) => setLink(i, { base: e.target.value })}>{hourKinds.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select></label>
              <span className="op">×</span>
              <label className="wp-field"><span className="wp-field-label">Level</span>
                <select className="input" value={l.defaultLevel} onChange={(e) => setLink(i, { defaultLevel: e.target.value })}>{l.levels.map((x) => <option key={x.id} value={x.id}>{x.name || "Level"} · {q(x.mult)}×</option>)}</select></label>
            </div>
            <p className="rt-note">Each link sets one kind's hours from one base kind (hours of A = hours of B × a level). A linked kind can't be the base of another link.</p>
            <div className="rt-table">
              <div className="rt-h l"><span>Level</span><span>Multiplier</span><span>Default</span><span /></div>
              {l.levels.map((x, j) => (
                <div key={x.id} className="rt-row l">
                  <input className="input" aria-label="Level" value={x.name} onChange={(e) => setLink(i, { levels: l.levels.map((y, m) => (m === j ? { ...y, name: e.target.value } : y)) })} />
                  <NumIn label={`${x.name} multiplier`} value={x.mult} suffix="×" onChange={(v) => setLink(i, { levels: l.levels.map((y, m) => (m === j ? { ...y, mult: v } : y)) })} />
                  <span>{l.defaultLevel === x.id ? <StatusChip tone="accent">Default</StatusChip> : <button type="button" className="linkbtn" onClick={() => setLink(i, { defaultLevel: x.id })}>Make default</button>}</span>
                  <Remove label={`Remove ${x.name}`} onClick={() => setLink(i, { levels: l.levels.filter((_, m) => m !== j) })} />
                </div>
              ))}
              <Add onClick={() => setLink(i, { levels: [...l.levels, { id: newId(), name: "", mult: 1 }] })}>Add level</Add>
            </div>
            <button type="button" className="linkbtn rt-rmlink" onClick={() => up({ links: r.links.filter((_, j) => j !== i) })}>Remove this link</button>
          </div>
        ))}
        <div className="rt-table"><Add onClick={() => { const id = newId(); up({ links: [...r.links, { id: newId(), target: hourKinds[1]?.id ?? "", base: hourKinds[0]?.id ?? "", levels: [{ id, name: "Standard", mult: 1 }], defaultLevel: id }] }); }}>Add link</Add></div>
      </Fold>

      <Fold label="Days and travel" summary={`${q(r.fullDayHours)} h day · ${q(r.halfDayHours)} h half day${r.travel.on ? ` · travel day after ${q(r.travel.thresholdHours)} h` : " · no travel rule"}`}>
        <div className="rt-pad">
          <div className="rt-two">
            <label className="wp-field"><span className="wp-field-label">Full day</span><NumIn label="Full day hours" value={r.fullDayHours} suffix="hours" width={9999} onChange={(v) => up({ fullDayHours: v })} /></label>
            <label className="wp-field"><span className="wp-field-label">Half day</span><NumIn label="Half day hours" value={r.halfDayHours} suffix="hours" width={9999} onChange={(v) => up({ halfDayHours: v })} /></label>
          </div>
          <div className="rt-toggle"><span><span className="wp-body">Travel rule</span><span className="wp-small">Add a travel day fee once a project's travel passes the threshold.</span></span>
            <Toggle label="Travel rule" checked={r.travel.on} onChange={(on) => up({ travel: { ...r.travel, on, kindId: r.travel.kindId || dayKinds[0]?.id || "" } })} /></div>
          {r.travel.on && <>
            <div className="rt-two">
              <label className="wp-field"><span className="wp-field-label">Add a travel day when the whole project's travel is more than</span><NumIn label="Travel threshold" value={r.travel.thresholdHours} suffix="hours" width={9999} onChange={(v) => up({ travel: { ...r.travel, thresholdHours: v } })} /></label>
              <label className="wp-field"><span className="wp-field-label">Charge as</span>
                <select className="input" value={r.travel.kindId} onChange={(e) => up({ travel: { ...r.travel, kindId: e.target.value } })}>
                  <option value="">Pick a kind billed per day</option>{dayKinds.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                </select></label>
            </div>
            <p className="rt-note">On by default once the threshold is passed. Each estimate can waive it.</p>
          </>}
        </div>
      </Fold>

      <Fold label="Discounts" count={discounts.length} summary={discounts.map((d) => d.name).filter(Boolean).join(" · ") || "None"}>
        <div className="rt-table">
          <div className="rt-h d"><span>Name</span><span>Amount</span><span>When</span><span /></div>
          {discounts.map((d, i) => (
            <div key={d.id} className="rt-row d">
              <input className="input" aria-label="Discount name" value={d.name} onChange={(e) => setDisc(i, { name: e.target.value })} placeholder="Multi-day shoot" />
              <span className="rt-amt">
                <Segmented label={`${d.name || "Discount"} as`} value={d.kind} onChange={(k) => setDisc(i, { kind: k, value: 0 })} items={[{ key: "percent", label: "%" }, { key: "amount", label: "$" }]} />
                {d.kind === "percent" ? <NumIn label={`${d.name} percent`} value={d.value} suffix="%" width={110} onChange={(v) => setDisc(i, { value: v })} />
                  : <MoneyInput label={`${d.name} amount`} value={d.value} onChange={(c) => setDisc(i, { value: c })} />}
              </span>
              <span className="rt-when">
                <select className="input" aria-label={`${d.name} depends on`} value={d.qty} onChange={(e) => setDisc(i, { qty: e.target.value })}>
                  {qtyNames.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
                </select>
                <span className="wp-small">at least</span>
                <NumIn label={`${d.name} at least`} value={d.min} width={80} onChange={(v) => setDisc(i, { min: v })} />
              </span>
              <Remove label={`Remove ${d.name}`} onClick={() => up({ discounts: discounts.filter((_, j) => j !== i) })} />
            </div>
          ))}
          <Add onClick={() => up({ discounts: [...discounts, { id: newId(), name: "", kind: "percent", value: 0, qty: qtyNames[0]?.key ?? "", min: 1 }] })}>Add discount</Add>
          <p className="rt-note nopad">A discount is suggested on a quote or proposal when its condition is met, and comes off estimates too. You can remove it there. % comes off the subtotal; $ is a fixed amount.</p>
        </div>
      </Fold>

      <Fold label="Profit split" summary={`${q(r.reservePct)}% reserve · ${q(100 - r.reservePct)}% owner`}>
        <div className="rt-pad">
          <div className="rt-two">
            <label className="wp-field"><span className="wp-field-label">Business reserve</span><NumIn label="Business reserve" value={r.reservePct} suffix="%" width={9999} onChange={(v) => up({ reservePct: v })} /></label>
            <label className="wp-field"><span className="wp-field-label">Owner income</span><NumIn label="Owner income" value={100 - r.reservePct} suffix="%" width={9999} onChange={(v) => up({ reservePct: 100 - v })} /></label>
          </div>
          <p className="rt-note">Of net profit (price minus subcontractor costs). Must add up to 100%.</p>
        </div>
      </Fold>

      <Fold label="Custom formula" summary={formula.on ? `On · ${typeof fCheck === "string" ? "needs a fix" : "works"}` : "Off"}>
        <div className="rt-pad">
          <div className="rt-toggle"><span><span className="wp-body">Use a custom formula</span><span className="wp-small">Optional. Write your own price using the names below, like a spreadsheet. When it's on, quotes and proposals suggest this instead of adding up the rates.</span></span>
            <Toggle label="Use a custom formula" checked={formula.on} onChange={(on) => up({ formula: { ...formula, on } })} /></div>
          <label className="wp-field"><span className="wp-field-label">Formula</span>
            <textarea className="input rt-formula" rows={3} value={formula.text} spellCheck={false} onChange={(e) => up({ formula: { ...formula, text: e.target.value } })} placeholder="Shooting rate × shoot hours + Editing rate × edit hours − Multi-day shoot" /></label>
          <span className="rt-sub nopad">Names you can use</span>
          <div className="rt-chips">{fNames.map((n) => <button type="button" key={n.name} className="wp-tag rt-chip" onClick={() => up({ formula: { ...formula, text: `${formula.text}${formula.text && !/\s$/.test(formula.text) ? " " : ""}${n.name}` } })}>{n.name}</button>)}</div>
          {formula.text.trim() && (typeof fCheck === "string"
            ? <p className="rt-fcheck"><StatusChip tone="warning">Needs a fix</StatusChip><span>{fCheck}</span></p>
            : <p className="rt-fcheck"><StatusChip tone="success">Works</StatusChip><span>Check: 4 {k0 ? (k0.name === "Shooting" ? "shoot" : k0.name.toLowerCase()) : ""} days{defLevel ? `, ${defLevel.name.split(",")[0].toLowerCase()} edit` : ""} → {money(fCheck)}</span></p>)}
        </div>
      </Fold>

      <Card className="rt" label="Check" head={<SectionHead label={k0 ? `Check: 4 ${k0.name === "Shooting" ? "shoot" : k0.name.toLowerCase()} days${defLevel ? `, ${defLevel.name.split(",")[0].toLowerCase()} ${kind(link0!.target)?.name.toLowerCase() ?? ""}` : ""}` : "Check"} />}>
        {check ? (
          <dl className="crm-dl rt-check">
            {check.lines.map((l) => <span key={l.kindId} className="crm-pair"><dt>{l.name}{link0 && l.kindId === link0.target && defLevel ? ` (${q(defLevel.mult)}×)` : ""}</dt><dd>{l.unit === "hour" ? `${q(l.qty)} h` : q(l.qty)}</dd></span>)}
            {check.discounts?.map((d) => <span key={d.id} className="crm-pair"><dt>{d.name}</dt><dd>−{money(d.cents)}</dd></span>)}
            <dt className="big">Client price</dt><dd className="big">{money(check.priceCents)}</dd>
            <dt>Expenses</dt><dd>{money(check.expenseCents)}</dd>
            <dt>Net profit</dt><dd>{money(check.netCents)}</dd>
            <dt>Reserve {q(r.reservePct)}%</dt><dd>{money(check.reserveCents)}</dd>
            <dt>Owner {q(100 - r.reservePct)}%</dt><dd>{money(check.ownerCents)}</dd>
          </dl>
        ) : <p className="rt-note">{problems[0] ?? "Add a kind of work billed per hour to see a check."}</p>}
        {travel && <p className="rt-note">With 1 travel day: {money(travel.priceCents)} price · {money(travel.expenseCents)} expenses · {money(travel.netCents)} net. Updates as you edit the rates above.</p>}
      </Card>

      <div className="rt-bar">
        {problems.length > 0 ? <p className="error" role="alert">{problems[0]}</p> : <span className="wp-small">{dirty ? "Unsaved changes." : "Saved."}</span>}
        <span className="sp" />
        {dirty && <button type="button" className="btn ghost" onClick={() => setR(structuredClone(data.rates as Rates))}>Discard</button>}
        <Button variant="primary" loading={busy} disabled={!dirty || problems.length > 0} onClick={() => void onSave()}>Save rates</Button>
      </div>
    </>
  );
}
