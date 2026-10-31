// Estimate (P3 / Owner / Estimate: 264:1872 new, 264:2474 with a travel day). The 12 lines from the business's rates
// (Settings › Estimate rates): what the client sees, then what only you see. The numbers are worked out here with the
// same code the server uses (convex/lib/estimate), so what you see is what Save keeps. Saved estimates move the card
// to Quoted; Make contract draft opens a Sign draft from the Service Agreement template. Back office only.
import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { estimate, primaryKind, type EstimateInput, type Rates } from "../../../convex/lib/estimate";
import { Button, ButtonLink, Card, Checkbox, EmptyState, SectionHead, Segmented, SkeletonRows, TextArea, TextField, Toggle } from "../../ui/wp";
import { useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { money } from "../payments/common";

type Input = { unit: "days" | "hours"; amount: number; levels: Record<string, string>; extra: Record<string, number>; travelOver: boolean; travelDays: number; travelWaived: boolean };
const num = (s: string) => { const n = Number(s); return Number.isFinite(n) && n >= 0 ? n : 0; };
const q = (n: number) => String(Math.round(n * 100) / 100);
const DEPOSIT = 25; // the Service Agreement's deposit (me-wrangler § 4)

function toEngine(r: Rates, i: Input): EstimateInput {
  const k = primaryKind(r);
  return { base: k ? { [k.id]: i.unit === "days" ? i.amount * r.fullDayHours : i.amount } : {}, levels: i.levels, extra: i.extra, travelOver: i.travelOver, travelDays: i.travelDays, travelWaived: i.travelWaived };
}

export default function EstimatePage({ estimateId, dealId, clientId, projectId }: { estimateId?: string; dealId?: string | null; clientId?: string | null; projectId?: string | null }) {
  const rates = useQuery(api.crm.rates, {});
  const saved = useQuery(api.crm.getEstimate, estimateId ? { estimateId } : "skip");
  const deal = useQuery(api.crm.deal, !estimateId && dealId ? { dealId } : "skip");
  const company = useQuery(api.crm.company, !estimateId && !dealId && clientId ? { clientId } : "skip");
  const save = useMutation(api.crm.saveEstimate);
  const makeContract = useAction(api.crm.makeContract);
  const [toast, show] = useToast();
  const [title, setTitle] = useState(""), [scope, setScope] = useState("");
  const [input, setInput] = useState<Input>({ unit: "days", amount: 0, levels: {}, extra: {}, travelOver: false, travelDays: 1, travelWaived: false });
  const [amountText, setAmountText] = useState("");
  const [extraText, setExtraText] = useState<Record<string, string>>({});
  const [travelText, setTravelText] = useState("1");
  // Review (Oct 31): once a new estimate is saved, later saves (and Make contract) update that one, even if the
  // contract step then fails.
  const [savedId, setSavedId] = useState<Id<"estimates"> | null>((estimateId as Id<"estimates"> | undefined) ?? null);
  const [ready, setReady] = useState(!estimateId);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "contract">(null);
  useEffect(() => {
    if (!saved || ready) return;
    const i = saved.input as Partial<Input> & { unit: "days" | "hours"; amount: number };
    setTitle(saved.title); setScope(saved.scope);
    setInput({ unit: i.unit, amount: i.amount, levels: i.levels ?? {}, extra: i.extra ?? {}, travelOver: !!i.travelOver, travelDays: i.travelDays ?? 1, travelWaived: !!i.travelWaived });
    setAmountText(q(i.amount)); setTravelText(String(i.travelDays ?? 1));
    setExtraText(Object.fromEntries(Object.entries(i.extra ?? {}).map(([key, val]) => [key, q(val)]))); setReady(true);
  }, [saved, ready]);
  useEffect(() => { if (deal && !title) setTitle(deal.title); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [deal]);
  const r = rates?.rates as Rates | undefined;
  const k = r ? primaryKind(r) : null;
  const result = useMemo(() => (r ? estimate(r, toEngine(r, input)) : null), [r, input]);
  const set = (p: Partial<Input>) => { setInput((x) => ({ ...x, ...p })); setDirty(true); };

  const who = saved?.company ?? deal?.company?.name ?? deal?.lead?.company ?? deal?.lead?.name ?? company?.name ?? null;
  const dealRef = (saved?.dealId ?? (dealId || null)) as Id<"deals"> | null;
  const top = (
    <TopBar><a {...linkProps("/clients")}>Clients</a><Sep />
      {dealRef ? <><a {...linkProps("/clients/pipeline")}>Pipeline</a><Sep />{who && <><a {...linkProps(`/clients/deals/${dealRef}`)}>{who}</a><Sep /></>}</> : who && <><a {...linkProps("/clients")}>Companies</a><Sep /></>}
      <span className="here">Estimate</span></TopBar>
  );
  if (rates === undefined || (estimateId && (saved === undefined || !ready && saved))) return <>{top}<div className="wp-page"><Card label="Loading"><SkeletonRows n={5} /></Card></div></>;
  if (estimateId && saved === null) return <>{top}<div className="wp-page"><EmptyState icon="invoice" title="This estimate isn't here." actions={<ButtonLink to="/clients/pipeline">Pipeline</ButtonLink>} /></div></>;
  if (!r || !k || rates.problems.length) {
    return <>{top}<div className="wp-page"><EmptyState icon="invoice" title="Set your rates first." body="Estimates are worked out from your rates: what you charge for each kind of work, what you pay out, and the split." actions={<ButtonLink variant="primary" to="/settings/rates">Settings › Estimate rates</ButtonLink>} /></div></>;
  }

  const doSave = async () => {
    const id = await save({
      ...(savedId ? { estimateId: savedId } : {}), ...(dealRef ? { dealId: dealRef } : {}),
      ...((saved?.clientId ?? clientId) ? { clientId: (saved?.clientId ?? clientId) as Id<"clients"> } : {}),
      ...((saved?.projectId ?? projectId) ? { projectId: (saved?.projectId ?? projectId) as Id<"projects"> } : {}),
      title: title.trim() || "Estimate", scope, input,
    });
    setDirty(false); setSavedId(id);
    return id;
  };
  const onSave = async () => {
    setBusy("save");
    try { const id = await doSave(); show(dealRef ? "Saved. The card is in Quoted." : "Saved. It's on the Pipeline in Quoted."); if (!estimateId) navigate(`/clients/estimates/${id}`); }
    catch (e) { show(errText(e)); } finally { setBusy(null); }
  };
  const onContract = async () => {
    setBusy("contract");
    try {
      const id = dirty || !savedId ? await doSave() : savedId;
      const r = await makeContract({ estimateId: id, depositPercent: DEPOSIT });
      if (r.kept === "signing") { show("This estimate's contract has already gone to signing, so it opens as it is. Changes here don't change it."); setTimeout(() => navigate(`/sign/b/${r.buildId}`), 1600); return; }
      navigate(`/sign/b/${r.buildId}`);
    } catch (e) { show(errText(e)); setBusy(null); }
  };

  const unitWord = (u: "hour" | "day") => (u === "hour" ? "hours" : "days");
  const lines = result!.lines;
  const qtyOf = (id: string) => lines.find((l) => l.kindId === id)?.qty ?? 0;
  const baseHours = input.unit === "days" ? input.amount * r.fullDayHours : input.amount;
  const travelKind = r.travel.on ? r.kinds.find((x) => x.id === r.travel.kindId) : null;
  const shown = r.kinds.filter((x) => x.id === k.id || r.links.some((l) => l.target === x.id) || x.id === travelKind?.id || qtyOf(x.id) > 0);
  let n = 1;
  return (
    <>
      {top}
      <div className="wp-page crm-est">
        <header className="wp-pagehead">
          <div className="txt">
            <span className="wp-eyebrow">Estimate{who ? ` · ${who}` : ""}</span>
            <h1 className="wp-h2">{(title.trim() || "New estimate").replace(/\.$/, "")}.</h1>
            <p className="wp-body">Saved estimates move the card to Quoted.</p>
          </div>
          <div className="acts">
            <Button loading={busy === "save"} disabled={!!busy || !result!.priceCents} onClick={() => void onSave()}>Save estimate</Button>
            <Button variant="primary" loading={busy === "contract"} disabled={!!busy || !result!.priceCents} onClick={() => void onContract()}>Make contract draft in Sign</Button>
          </div>
        </header>
        <div className="crm-estcols">
          <div className="col">
            <Card label="Scope" head={<SectionHead label="Scope" />}>
              <div className="crm-pad">
                <TextField label="Name" value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} placeholder="Brand film" />
                <TextArea label="Project scope summary" value={scope} rows={4} onChange={(e) => { setScope(e.target.value); setDirty(true); }} placeholder="What you'll make, how many cuts, where you'll shoot." />
              </div>
            </Card>
            <Card label="Time" head={<SectionHead label="Time" />}>
              <div className="crm-pad">
                <div className="crm-time">
                  <div className="wp-field"><span className="wp-field-label">{k.name} in</span>
                    <Segmented label={`${k.name} in`} value={input.unit} onChange={(u) => set({ unit: u })} items={[{ key: "days", label: "Days" }, { key: "hours", label: "Hours" }]} />
                  </div>
                  <div className="wp-field"><span className="wp-field-label">{input.unit === "days" ? `${k.name === "Shooting" ? "Shoot" : k.name} days` : `${k.name} hours`}</span>
                    <span className="crm-inline"><input className="input" inputMode="decimal" value={amountText} placeholder="0" aria-label="Amount"
                      onChange={(e) => { setAmountText(e.target.value); set({ amount: num(e.target.value) }); }} />
                      {input.unit === "days" && <span className="wp-small">= {q(baseHours)} hours</span>}</span>
                    {input.unit === "days" && <span className="wp-small">A full day is {r.fullDayHours} hours; half a day is {r.halfDayHours}.</span>}
                  </div>
                </div>
                {r.links.map((l) => {
                  const target = r.kinds.find((x) => x.id === l.target)!, base = r.kinds.find((x) => x.id === l.base)!;
                  const level = l.levels.find((x) => x.id === (input.levels[l.id] ?? l.defaultLevel)) ?? l.levels[0];
                  return (
                    <div key={l.id} className="crm-link">
                      <div className="wp-field"><span className="wp-field-label">{target.name === "Editing" ? "Edit level" : `${target.name} level`}</span>
                        <Segmented label={`${target.name} level`} value={level.id} onChange={(v) => set({ levels: { ...input.levels, [l.id]: v } })}
                          items={l.levels.map((x) => ({ key: x.id, label: `${x.name.split(",")[0]} ${q(x.mult)}×` }))} />
                      </div>
                      <div className="crm-time">
                        <TextField label={`Extra ${target.name.toLowerCase()} hours`} inputMode="decimal" value={extraText[target.id] ?? ""} placeholder="0"
                          hint="For extra cuts, graphics, versions" onChange={(e) => { setExtraText({ ...extraText, [target.id]: e.target.value }); set({ extra: { ...input.extra, [target.id]: num(e.target.value) } }); }} />
                        <span className="wp-small crm-calc">{target.name} = {q(qtyOf(base.id))} × {q(level.mult)}{input.extra[target.id] ? ` + ${q(input.extra[target.id])}` : ""} = {q(qtyOf(target.id))} hours</span>
                      </div>
                    </div>
                  );
                })}
                {travelKind && (
                  <div className="crm-travel">
                    <div className="row">
                      <span><span className="wp-body">Travel over {q(r.travel.thresholdHours)} hours on this project</span><span className="wp-small">{input.travelOver ? (input.travelWaived ? "Travel day fee waived." : `${travelKind.name} fee applies.`) : "Under the threshold: no travel day."}</span></span>
                      <Toggle label={`Travel over ${r.travel.thresholdHours} hours`} checked={input.travelOver} onChange={(v) => set({ travelOver: v })} />
                    </div>
                    {input.travelOver && (
                      <div className="crm-time">
                        <TextField label="Travel days" inputMode="numeric" value={travelText} onChange={(e) => { setTravelText(e.target.value); set({ travelDays: Math.floor(num(e.target.value)) }); }} />
                        <Checkbox checked={input.travelWaived} onChange={(v) => set({ travelWaived: v })} label="Waive the travel day fee" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>
          </div>
          <div className="col right">
            <Card label="Estimate" head={<SectionHead label="Estimate" />}>
              <dl className="crm-lines">
                <span className="grp">The client sees</span>
                <dt>{n++} · Scope</dt><dd>{title.trim() || "—"}</dd>
                {shown.map((x) => <span key={x.id} className="crm-pair"><dt>{n++} · {x.name.replace(/ day$/i, "")} {unitWord(x.unit)}</dt><dd>{x.unit === "hour" ? `${q(qtyOf(x.id))} h` : q(qtyOf(x.id))}</dd></span>)}
                <dt className="big">{n++} · Client project price</dt><dd className="big">{money(result!.priceCents)}</dd>
                <span className="grp line">Only you see</span>
                {shown.map((x) => <span key={x.id} className="crm-pair"><dt>{n++} · {x.name.replace(/ day$/i, "")} expense</dt><dd>{money(lines.find((l) => l.kindId === x.id)?.costCents ?? 0)}</dd></span>)}
                <dt>{n++} · Total expenses</dt><dd>{money(result!.expenseCents)}</dd>
                <dt className="big">{n++} · Net profit</dt><dd className="big">{money(result!.netCents)}</dd>
                <dt>{n++} · Business reserve {q(r.reservePct)}%</dt><dd>{money(result!.reserveCents)}</dd>
                <dt>{n++} · Owner income {q(100 - r.reservePct)}%</dt><dd>{money(result!.ownerCents)}</dd>
              </dl>
            </Card>
            <Card label="Contract draft" head={<SectionHead label="Contract draft" />}>
              <dl className="crm-lines">
                <dt>Line items</dt><dd>{lines.length ? lines.map((l) => `${l.name.replace(/ day$/i, "")} ${l.unit === "hour" ? `${q(l.qty)} h` : `${q(l.qty)} day${l.qty === 1 ? "" : "s"}`}`).join(" · ") : "—"}</dd>
                <dt className="big">Deposit ({DEPOSIT}%)</dt><dd className="big">{money(Math.round((result!.priceCents * DEPOSIT) / 100))}</dd>
              </dl>
              <p className="crm-note">Make contract draft opens a Sign draft from your Service agreement template with these lines and the deposit.{saved?.buildId ? " This estimate already has one; it opens that draft." : ""}</p>
            </Card>
          </div>
        </div>
      </div>
      {toast}
    </>
  );
}
