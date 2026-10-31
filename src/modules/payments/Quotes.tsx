// Phase 3b · Quick quotes, the owner's side: Payments › Quotes (719:6320 list, 719:7024 empty), New quote (719:7567, with
// its quick questions and suggested prices from Settings › Pricing; type a different number to override, D76) and the
// quote page (720:7076 sent, 720:7671 accepted, 720:8275 declined, 720:8867 expired) with its prompts (D84): "Move
// {company} to Quoted?" once it's out, and "Draft from this quote" (721:7737) once it's accepted.
import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { estimate, formulaPrice, primaryKind, type Rates } from "../../../convex/lib/estimate";
import { Button, ButtonLink, Card, Checkbox, DialogHeader, Divider, EmptyState, ListRow, PageHeader, PillTabs, SectionHead, Segmented, SkeletonRows, StatusChip, TextArea, TextField } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Menu, MenuItem, Modal, useConfirm, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { MoneyInput, dateShort, money, newId } from "./common";
import { downloadPdf } from "./pdfDownload";
import { QuotePaper, longIso, longMs, quotePdf, type QuoteDoc } from "./QuotePaper";

type Status = "draft" | "sent" | "accepted" | "declined" | "expired" | "void";
const CHIP: Record<Status, { tone: "neutral" | "accent" | "success" | "danger"; text: string }> = {
  draft: { tone: "neutral", text: "Draft" }, sent: { tone: "accent", text: "Sent" }, accepted: { tone: "success", text: "Accepted" },
  declined: { tone: "danger", text: "Declined" }, expired: { tone: "neutral", text: "Expired" }, void: { tone: "neutral", text: "Void" },
};
export const QuoteChip = ({ status }: { status: Status }) => <StatusChip tone={CHIP[status].tone}>{CHIP[status].text}</StatusChip>;
const isoIn = (days: number) => { const d = new Date(Date.now() + days * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const daysFromToday = (iso: string) => Math.round((Date.parse(`${iso}T12:00:00`) - Date.parse(`${isoIn(0)}T12:00:00`)) / 86_400_000);
const q2 = (n: number) => String(Math.round(n * 100) / 100);

function totalsOf(lines: Array<{ qty: number; unitCents: number }>, discountCents: number, taxPercent: number, deposit: { kind: "percent" | "amount"; value: number }) {
  const subtotal = lines.reduce((t, l) => t + Math.round(l.qty * l.unitCents), 0);
  const discount = Math.min(Math.max(0, discountCents), subtotal);
  const tax = Math.round(((subtotal - discount) * Math.max(0, taxPercent)) / 100);
  const total = subtotal - discount + tax;
  const dep = deposit.kind === "percent" ? Math.round((total * Math.max(0, Math.min(100, deposit.value))) / 100) : Math.min(Math.max(0, deposit.value), total);
  return { subtotal, discount, tax, total, deposit: dep };
}

// ---------- Payments › Quotes ----------

type Pill = "all" | Status;
export default function QuotesPage() {
  const rows = useQuery(api.quotes.list, {});
  const [pill, setPill] = useState<Pill>("all");
  const n = (s: Status) => (rows ?? []).filter((r) => r.status === s).length;
  const shown = (rows ?? []).filter((r) => pill === "all" || r.status === pill);
  const meta = (r: NonNullable<typeof rows>[number]) => {
    const s = r.status as Status;
    if (s === "draft") return `${r.title} · draft · updated ${dateShort(r.updatedAt)}`;
    if (s === "accepted") return `${r.title} · accepted ${dateShort(r.response!.at)} by ${r.response!.name}`;
    if (s === "declined") return `${r.title} · declined ${dateShort(r.response!.at)}`;
    if (s === "expired") return `${r.title} · expired ${dateShort(r.validUntil)}`;
    if (s === "void") return `${r.title} · void`;
    return [r.title, r.sentAt ? `sent ${dateShort(r.sentAt)}` : null, r.viewedAt ? `viewed ${dateShort(r.viewedAt)}` : null, `valid until ${dateShort(r.validUntil)}`].filter(Boolean).join(" · ");
  };
  return (
    <>
      <TopBar><span className="secondary">Payments</span><Sep /><span className="here">Quotes</span></TopBar>
      <div className="wp-page">
        <PageHeader eyebrow="Payments" title="Quotes." sub="Quick prices for small jobs. Clients accept them online, no account needed." actions={<ButtonLink variant="primary" to="/payments/quotes/new">New quote</ButtonLink>} />
        {rows === undefined ? <Card label="Loading"><SkeletonRows n={4} /></Card> : rows.length === 0 ? (
          <EmptyState icon="invoice" title="No quotes yet." body="A quote is a quick price for a small job. It looks like your invoices, and the client accepts it online without an account." actions={<ButtonLink variant="primary" to="/payments/quotes/new">New quote</ButtonLink>} />
        ) : (
          <>
            <PillTabs label="Show" value={pill} onChange={setPill} items={[{ key: "all", label: "All", count: rows.length }, { key: "draft", label: "Draft", count: n("draft") }, { key: "sent", label: "Sent", count: n("sent") },
              { key: "accepted", label: "Accepted", count: n("accepted") }, { key: "declined", label: "Declined", count: n("declined") }, { key: "expired", label: "Expired", count: n("expired") }]} />
            <Card label="Quotes" className="q-list">
              {shown.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "invoice" }} title="None here." /> : shown.map((r, i) => (
                <div key={r._id} className="wp-rowwrap">{i > 0 && <Divider />}
                  <ListRow className="ilead" lead={{ icon: "invoice" }} to={`/payments/quotes/${r._id}`} title={`${r.number} · ${r.company}`} meta={meta(r)}
                    trailing={money(r.totalCents)} chip={<QuoteChip status={r.status as Status} />} chevron />
                </div>
              ))}
            </Card>
          </>
        )}
      </div>
    </>
  );
}

// ---------- New quote / edit a draft ----------

type QLine = { id: string; description: string; qty: number; unitCents: number; suggestedCents?: number; note?: string; auto?: string };
type Answers = { jobs: string[]; days: string; level: string };

export function QuoteEditor({ quoteId, clientId, dealId }: { quoteId?: string | null; clientId?: string | null; dealId?: string | null }) {
  const options = useQuery(api.quotes.options, {});
  const ratesQ = useQuery(api.crm.rates, {});
  const existing = useQuery(api.quotes.get, quoteId ? { quoteId } : "skip");
  const save = useMutation(api.quotes.save);
  const send = useAction(api.quotes.send);
  const [toast, show] = useToast();
  const [loaded, setLoaded] = useState(!quoteId);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [whoKey, setWhoKey] = useState<string>("");
  const [person, setPerson] = useState({ name: "", email: "", company: "" });
  const [title, setTitle] = useState("");
  const [answers, setAnswers] = useState<Answers>({ jobs: [], days: "1", level: "" });
  const [lines, setLines] = useState<QLine[]>([]);
  const [discountOn, setDiscountOn] = useState(false), [discountCents, setDiscountCents] = useState(0);
  const [taxOn, setTaxOn] = useState(false), [taxPercent, setTaxPercent] = useState("0");
  const [deposit, setDeposit] = useState<{ kind: "percent" | "amount"; value: number }>({ kind: "percent", value: 25 });
  const [depositText, setDepositText] = useState("25");
  const [validUntil, setValidUntil] = useState(isoIn(30));
  const [terms, setTerms] = useState("");
  const [savedId, setSavedId] = useState<Id<"quotes"> | null>((quoteId as Id<"quotes"> | null) ?? null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState<null | "save" | "send">(null);
  const [confirm, setConfirm] = useState(false);
  const r = ratesQ?.rates as Rates | undefined;

  // Load a draft, or start from the company or lead the page was opened for.
  useEffect(() => {
    if (!quoteId || loaded || !existing || !options) return;
    const q = existing;
    const match = options.who.find((w) => (q.clientId && w.clientId === q.clientId && w.email === q.contact.email) || (q.dealId && w.dealId === q.dealId));
    if (match) { setMode("existing"); setWhoKey(match.key); } else { setMode("new"); setPerson({ name: q.contact.name, email: q.contact.email, company: q.contact.company ?? "" }); }
    setTitle(q.title); setLines(q.lines.map((l) => ({ ...l }))); setDiscountOn(!!q.discountCents); setDiscountCents(q.discountCents ?? 0);
    setTaxOn(!!q.taxPercent); setTaxPercent(String(q.taxPercent ?? 0)); setDeposit(q.deposit); setDepositText(q2(q.deposit.kind === "percent" ? q.deposit.value : q.deposit.value / 100));
    setValidUntil(q.validUntil); setTerms(q.terms ?? "");
    if (q.questions) setAnswers(q.questions as Answers);
    setLoaded(true);
  }, [quoteId, loaded, existing, options]);
  useEffect(() => {
    if (quoteId || !options || whoKey) return;
    const m = options.who.find((w) => (clientId && w.clientId === clientId) || (dealId && w.dealId === dealId));
    if (m) setWhoKey(m.key);
  }, [quoteId, options, clientId, dealId, whoKey]);
  useEffect(() => { if (r && !answers.level && r.links[0]) setAnswers((a) => ({ ...a, level: r.links[0].defaultLevel })); }, [r, answers.level]);

  const who = mode === "existing" ? options?.who.find((w) => w.key === whoKey) ?? null : null;
  const contact = mode === "existing" ? (who ? { name: who.name, email: who.email, company: who.company ?? "" } : { name: "", email: "", company: "" }) : person;
  const k0 = r ? primaryKind(r) : null;
  const link0 = r?.links[0];
  const level = link0?.levels.find((x) => x.id === answers.level) ?? link0?.levels.find((x) => x.id === link0.defaultLevel);
  const days = Math.max(0, Number(answers.days) || 0);

  // The quick questions' estimate: suggested lines for the kinds of work picked (D76).
  const est = useMemo(() => {
    if (!r || !k0) return null;
    const travelKind = r.travel.on ? r.travel.kindId : null;
    return estimate(r, { base: answers.jobs.includes(k0.id) || r.links.some((l) => answers.jobs.includes(l.target)) ? { [k0.id]: days * r.fullDayHours } : {}, levels: link0 && level ? { [link0.id]: level.id } : {}, travelOver: !!travelKind && answers.jobs.includes(travelKind), travelDays: 1 });
  }, [r, k0, link0, level, answers.jobs, days]);
  const suggestedLines = useMemo((): QLine[] => {
    if (!r || !est || !k0) return [];
    return est.lines.filter((l) => answers.jobs.includes(l.kindId)).map((l) => {
      const kind = r.kinds.find((k) => k.id === l.kindId)!;
      const isLinked = r.links.some((x) => x.target === l.kindId);
      const lvl = isLinked && level ? level.name.split(",")[0].toLowerCase() : null;
      const description = l.kindId === k0.id ? `${kind.name} · ${q2(days)} day${days === 1 ? "" : "s"} (${q2(l.qty)} h)` : lvl ? `${kind.name} · ${lvl} (${q2(l.qty)} h)` : kind.unit === "day" ? `${kind.name}${l.qty > 1 ? ` × ${q2(l.qty)}` : ""}` : `${kind.name} (${q2(l.qty)} h)`;
      const note = kind.unit === "hour" ? `Suggested · ${q2(l.qty)} h${lvl && level ? ` (${q2(l.qty / level.mult)} h × ${q2(level.mult)})` : ""} × your ${kind.name} rate` : `Suggested · your ${kind.name} rate`;
      return { id: `auto-${l.kindId}`, description, qty: 1, unitCents: l.clientCents, suggestedCents: l.clientCents, note, auto: l.kindId };
    });
  }, [r, est, k0, level, days, answers.jobs]);
  // Answering the questions refreshes the suggested lines; a price you typed over stays (with its suggestion shown).
  const applyAnswers = (a: Answers) => {
    setAnswers(a);
  };
  useEffect(() => {
    if (!loaded) return;
    setLines((cur) => {
      const manual = cur.filter((l) => !l.auto);
      const next = suggestedLines.map((s) => {
        const old = cur.find((l) => l.auto === s.auto);
        return old && old.unitCents !== old.suggestedCents ? { ...s, description: old.description, unitCents: old.unitCents } : s;
      });
      return [...next, ...manual];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(suggestedLines), loaded]);

  const discountSuggestion = est?.discounts?.filter((d) => answers.jobs.length > 0) ?? [];
  const formula = r?.formula?.on && est && answers.jobs.length ? formulaPrice(r, est) : null;
  const tax = taxOn ? Math.max(0, Number(taxPercent) || 0) : 0;
  const t = totalsOf(lines, discountOn ? discountCents : 0, tax, deposit);
  const contactOk = !!contact.name.trim() && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(contact.email.trim());
  const doc: QuoteDoc = {
    business: existing?.business ?? { name: "", legalName: null }, number: existing?.number ?? options?.next ?? "", issued: longMs(Date.now()), validUntil: longIso(validUntil),
    contact: { name: contact.name, email: contact.email, ...(contact.company ? { company: contact.company } : {}) }, project: title || null,
    lines, totals: t, taxPercent: tax, deposit, terms: terms || null,
  };
  const biz = useQuery(api.business.settings, {});
  if (!existing && biz) doc.business = { name: biz.name, legalName: biz.legalName, logoUrl: biz.logoUrl, logoLightUrl: biz.logoLightUrl, email: biz.replyTo ?? biz.ownerEmail, address: biz.address, privacyUrl: biz.privacyUrl };

  const doSave = async () => {
    const w = mode === "existing" && who ? { ...(who.clientId ? { clientId: who.clientId as Id<"clients"> } : {}), ...(who.dealId ? { dealId: who.dealId as Id<"deals"> } : {}), name: who.name, email: who.email, ...(who.company ? { company: who.company } : {}) }
      : { name: person.name, email: person.email, ...(person.company.trim() ? { company: person.company } : {}) };
    const id = await save({
      ...(savedId ? { quoteId: savedId } : {}), who: w, title, deposit, validUntil, terms, questions: answers,
      lines: lines.map((l) => ({ id: l.id, description: l.description, qty: l.qty, unitCents: l.unitCents, ...(l.suggestedCents !== undefined ? { suggestedCents: l.suggestedCents } : {}), ...(l.note ? { note: l.note } : {}) })),
      ...(discountOn && discountCents ? { discountCents } : {}), ...(tax ? { taxPercent: tax } : {}),
    });
    setSavedId(id); setSavedAt(Date.now());
    return id;
  };
  const onSave = async () => {
    setBusy("save");
    try { const id = await doSave(); show("Draft saved."); if (!quoteId) history.replaceState(null, "", `/payments/quotes/${id}`); } catch (e) { show(errText(e)); } finally { setBusy(null); }
  };
  const onReview = async () => {
    setBusy("save");
    try { await doSave(); setConfirm(true); } catch (e) { show(errText(e)); } finally { setBusy(null); }
  };
  const onSend = async () => {
    setBusy("send");
    try { const id = savedId!; const r2 = await send({ quoteId: id }); setConfirm(false); navigate(`/payments/quotes/${id}`); if (r2.held) show("Sent. (The preview only emails allowed addresses.)"); } catch (e) { show(errText(e)); setBusy(null); }
  };

  const setLine = (i: number, p: Partial<QLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  if (!options || !ratesQ || (quoteId && !loaded)) return <><TopBar><span className="secondary">Payments</span><Sep /><a {...linkProps("/payments/quotes")}>Quotes</a></TopBar><div className="wp-page"><Card label="Loading"><SkeletonRows n={5} /></Card></div></>;
  const company = contact.company || contact.name;
  const kinds = r?.kinds ?? [];
  return (
    <>
      <TopBar right={savedAt ? <span className="wp-small">Saved · {new Date(savedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span> : undefined}>
        <span className="secondary">Payments</span><Sep /><a {...linkProps("/payments/quotes")}>Quotes</a><Sep /><span className="here">{quoteId ? doc.number : "New quote"}</span>
      </TopBar>
      <div className="wp-page q-new">
        <header className="wp-pagehead">
          <div className="txt">
            <span className="wp-eyebrow">{quoteId ? "Draft" : "New quote"} · {doc.number}</span>
            <h1 className="wp-h2">{company ? `Quote for ${company}.` : "New quote."}</h1>
            <p className="wp-body">Prices are suggested from Settings › Pricing. Type a different number to override one.</p>
          </div>
          <div className="acts">
            <Button loading={busy === "save"} disabled={!!busy || !contactOk} onClick={() => void onSave()}>Save draft</Button>
            <Button variant="primary" disabled={!!busy || !contactOk || !lines.length || t.total <= 0} onClick={() => void onReview()}>Review and send</Button>
          </div>
        </header>
        <div className="q-cols">
          <div className="col">
            <Card label="Who it's for" head={<SectionHead label="Who it's for" />}>
              <div className="crm-pad">
                <Segmented label="Who it's for" value={mode} onChange={setMode} items={[{ key: "existing", label: "Existing client or lead" }, { key: "new", label: "New person" }]} />
                {mode === "existing" ? (
                  <label className="wp-field"><span className="wp-field-label">Client</span>
                    <select className="input" value={whoKey} onChange={(e) => setWhoKey(e.target.value)}>
                      <option value="">Pick a person</option>
                      {options.who.map((w) => <option key={w.key} value={w.key}>{[w.company, w.name].filter(Boolean).join(" · ")}{"lead" in w && w.lead ? " (lead)" : ""}</option>)}
                    </select>
                  </label>
                ) : (
                  <div className="crm-grid2">
                    <TextField label="Name" value={person.name} onChange={(e) => setPerson({ ...person, name: e.target.value })} placeholder="Full name" />
                    <TextField label="Email" type="email" value={person.email} onChange={(e) => setPerson({ ...person, email: e.target.value })} placeholder="name@company.com" />
                    <TextField label="Company (optional)" value={person.company} onChange={(e) => setPerson({ ...person, company: e.target.value })} />
                  </div>
                )}
                <TextField label="Project title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Menu board refresh" />
              </div>
            </Card>

            {kinds.length > 0 && (
              <Card label="Quick questions" head={<SectionHead label="Quick questions" />}>
                <div className="crm-pad">
                  <div className="wp-field"><span className="wp-field-label">What's the job?</span>
                    <div className="bk-tones">{kinds.map((k) => { const on = answers.jobs.includes(k.id); return <button type="button" key={k.id} className={`bk-tone${on ? " on" : ""}`} aria-pressed={on} onClick={() => applyAnswers({ ...answers, jobs: on ? answers.jobs.filter((x) => x !== k.id) : [...answers.jobs, k.id] })}>{k.name}</button>; })}</div>
                  </div>
                  <div className="crm-grid2">
                    {k0 && <TextField label={`${k0.name === "Shooting" ? "Shoot" : k0.name} days`} inputMode="decimal" value={answers.days} onChange={(e) => applyAnswers({ ...answers, days: e.target.value })} hint={`A day is ${r!.fullDayHours} hours; 0.5 for half a day.`} />}
                    {link0 && <label className="wp-field"><span className="wp-field-label">{kinds.find((k) => k.id === link0.target)?.name ?? "Editing"} level</span>
                      <select className="input" value={answers.level} onChange={(e) => applyAnswers({ ...answers, level: e.target.value })}>{link0.levels.map((x) => <option key={x.id} value={x.id}>{x.name.split(",")[0]} · {q2(x.mult)}×</option>)}</select></label>}
                  </div>
                </div>
              </Card>
            )}

            <Card label="Line items" head={<SectionHead label="Line items" count={lines.length} />}>
              <div className="crm-pad">
                {lines.map((l, i) => (
                  <div key={l.id} className="q-line">
                    <div className="row">
                      <input className="input" aria-label="Description" value={l.description} placeholder="Description" onChange={(e) => setLine(i, { description: e.target.value })} />
                      <input className="input qty" aria-label="Quantity" inputMode="decimal" value={q2(l.qty)} onChange={(e) => setLine(i, { qty: Math.max(0, Number(e.target.value) || 0) })} />
                      <MoneyInput label="Unit price" value={l.unitCents} onChange={(c) => setLine(i, { unitCents: c })} />
                      <button type="button" className="rt-x icon-btn" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Icon name="close" size={16} /></button>
                    </div>
                    {l.suggestedCents !== undefined && l.unitCents !== l.suggestedCents
                      ? <p className="wp-small q-note">Changed from the suggested {money(l.suggestedCents)} · <button type="button" className="linkbtn" onClick={() => setLine(i, { unitCents: l.suggestedCents! })}>Use suggested</button></p>
                      : l.note ? <p className="wp-small q-note">{l.note}</p> : null}
                  </div>
                ))}
                {discountSuggestion.length > 0 && !discountOn && (
                  <p className="wp-small q-sugg">{discountSuggestion.map((d) => `${d.name} −${money(d.cents)}`).join(" · ")} suggested · <button type="button" className="linkbtn" onClick={() => { setDiscountOn(true); setDiscountCents(discountSuggestion.reduce((s, d) => s + d.cents, 0)); }}>Apply</button></p>
                )}
                {formula !== null && (typeof formula === "string"
                  ? <p className="wp-small q-sugg">Your formula needs a fix in Settings › Pricing: {formula}</p>
                  : formula !== t.subtotal ? <p className="wp-small q-sugg">Your formula suggests {money(formula)} for this job · <button type="button" className="linkbtn" onClick={() => setLines([{ id: newId(), description: title.trim() || "This job", qty: 1, unitCents: formula, suggestedCents: formula, note: "Suggested · your custom formula" }])}>Use it</button></p> : null)}
                <div className="q-adds">
                  <Menu label="Add from Pricing" trigger={(p) => <button type="button" className="rt-add" {...p}><Icon name="plus" size={14} />Add from Pricing</button>}>
                    {kinds.map((k) => <MenuItem key={k.id} onSelect={() => setLines([...lines, { id: newId(), description: k.name, qty: 1, unitCents: k.clientCents, suggestedCents: k.clientCents, note: `Suggested · your ${k.name} rate, per ${k.unit}` }])}>{k.name} · {money(k.clientCents)} / {k.unit}</MenuItem>)}
                    {r?.defaults?.hourlyCents ? <MenuItem onSelect={() => setLines([...lines, { id: newId(), description: "Hourly", qty: 1, unitCents: r.defaults!.hourlyCents, suggestedCents: r.defaults!.hourlyCents, note: "Suggested · your hourly rate" }])}>Hourly rate · {money(r.defaults.hourlyCents)}</MenuItem> : null}
                    {r?.defaults?.dailyCents ? <MenuItem onSelect={() => setLines([...lines, { id: newId(), description: "Day rate", qty: 1, unitCents: r.defaults!.dailyCents, suggestedCents: r.defaults!.dailyCents, note: "Suggested · your daily rate" }])}>Daily rate · {money(r.defaults.dailyCents)}</MenuItem> : null}
                  </Menu>
                  <button type="button" className="rt-add" onClick={() => setLines([...lines, { id: newId(), description: "", qty: 1, unitCents: 0 }])}><Icon name="plus" size={14} />Add a line</button>
                  {!discountOn && <button type="button" className="rt-add plain" onClick={() => setDiscountOn(true)}><Icon name="plus" size={14} />Discount</button>}
                  {!taxOn && <button type="button" className="rt-add plain" onClick={() => setTaxOn(true)}><Icon name="plus" size={14} />Tax</button>}
                </div>
                {(discountOn || taxOn) && (
                  <div className="crm-grid2">
                    {discountOn && <div className="wp-field"><span className="wp-field-label">Discount <button type="button" className="linkbtn" onClick={() => { setDiscountOn(false); setDiscountCents(0); }}>Remove</button></span><MoneyInput label="Discount" value={discountCents} onChange={setDiscountCents} /></div>}
                    {taxOn && <label className="wp-field"><span className="wp-field-label">Tax % <button type="button" className="linkbtn" onClick={() => { setTaxOn(false); setTaxPercent("0"); }}>Remove</button></span><input className="input" inputMode="decimal" value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)} /></label>}
                  </div>
                )}
              </div>
            </Card>

            <Card label="Deposit, dates and terms" head={<SectionHead label="Deposit, dates and terms" />}>
              <div className="crm-pad">
                <div className="crm-grid2">
                  <div className="wp-field"><span className="wp-field-label">Deposit</span>
                    <span className="rt-amt">
                      <Segmented label="Deposit as" value={deposit.kind} onChange={(k) => { setDeposit({ kind: k, value: 0 }); setDepositText(""); }} items={[{ key: "percent", label: "%" }, { key: "amount", label: "$" }]} />
                      <input className="input" inputMode="decimal" aria-label="Deposit" value={depositText} onChange={(e) => { setDepositText(e.target.value); const n = Math.max(0, Number(e.target.value) || 0); setDeposit({ ...deposit, value: deposit.kind === "percent" ? n : Math.round(n * 100) }); }} />
                    </span>
                  </div>
                  <label className="wp-field"><span className="wp-field-label">Valid until</span>
                    <span className="q-valid"><input className="input" type="date" value={validUntil} min={isoIn(0)} onChange={(e) => setValidUntil(e.target.value)} /><span className="wp-small">{daysFromToday(validUntil)} days</span></span></label>
                </div>
                <TextArea label="Notes and terms" rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Includes one round of changes. Shoot date to be set once accepted." />
              </div>
            </Card>
          </div>
          <div className="col right">
            <span className="q-preview-label"><Icon name="eye" size={14} />What {contact.name.split(" ")[0] || "they"} will see</span>
            <QuotePaper q={doc} />
            <p className="wp-small">Updates as you type. The quote page and the PDF match it.</p>
          </div>
        </div>
      </div>
      {confirm && savedId && (
        <Modal onClose={() => setConfirm(false)} label="Send quote" width={520}>
          <div className="crm-dialog">
            <DialogHeader eyebrow={doc.number} title={`Send this quote to ${contact.name.split(" ")[0]}?`} body={`It goes to ${contact.email} from ${doc.business.name || "your business"}, with a link to accept or decline. No account needed.`} onClose={() => setConfirm(false)} />
            <dl className="crm-dl crm-box">
              <dt className="big">Total</dt><dd className="big">{money(t.total)}</dd>
              <dt>Deposit to book</dt><dd>{money(t.deposit)}</dd>
              <dt>Valid until</dt><dd>{longIso(validUntil)}</dd>
            </dl>
            <p className="wp-small">Nothing moves on your pipeline until you say so.</p>
            <div className="dfoot">
              <button className="btn ghost" type="button" onClick={() => setConfirm(false)}>Not yet</button>
              <Button variant="primary" loading={busy === "send"} onClick={() => void onSend()}>Send quote</Button>
            </div>
          </div>
        </Modal>
      )}
      {toast}
    </>
  );
}

// ---------- a quote ----------

type Q = NonNullable<ReturnType<typeof useQuery<typeof api.quotes.get>>>;
const HIST: Record<string, (h: { detail?: string; by?: string }, q: Q) => string> = {
  created: () => "Created", sent: (h) => `Sent to ${h.detail ?? ""}`, resent: (h) => `Sent again to ${h.detail ?? ""}`, viewed: (h) => `Viewed by ${h.detail ?? "them"}`,
  accepted: (h) => `Accepted by ${h.detail ?? ""}`, declined: (h) => `Declined by ${h.detail ?? ""}`, voided: () => "Voided", email_held: () => "Email held (preview)",
  contract_drafted: () => "Contract drafted", invoice_drafted: (h) => `Invoice drafted (${h.detail === "full" ? "full total" : "deposit"})`,
};

function DraftFrom({ q, onClose, show }: { q: Q; onClose: () => void; show: (m: string) => void }) {
  const draft = useAction(api.quotes.draftFrom);
  const [contract, setContract] = useState(!q.made.build);
  const [invoice, setInvoice] = useState(!q.made.invoice);
  const [what, setWhat] = useState<"deposit" | "full">(q.totals.deposit > 0 ? "deposit" : "full"); // D87: the deposit by default
  const [busy, setBusy] = useState(false);
  const n = (contract ? 1 : 0) + (invoice ? 1 : 0);
  return (
    <Modal onClose={onClose} label="Draft from this quote" width={560}>
      <div className="crm-dialog">
        <DialogHeader eyebrow={`Accepted · ${q.number}`} title="Draft from this quote." body={`${q.response?.name.split(" ")[0] ?? "They"} accepted on ${dateShort(q.response?.at ?? Date.now())}. Pick what to draft. Each one opens as a draft for you to check; nothing is sent.`} onClose={onClose} />
        <Checkbox checked={contract} disabled={!!q.made.build} onChange={setContract} label="Contract" hint={q.made.build ? "Already drafted." : "A Service Agreement draft in Docs, with the lines, deposit and client filled in."} />
        <Checkbox checked={invoice} disabled={!!q.made.invoice} onChange={setInvoice} label="Invoice" hint={q.made.invoice ? "Already drafted." : "An invoice draft in Payments › Invoices, ready to check and send."} />
        {invoice && !q.made.invoice && (
          <div className="q-invfor"><span className="wp-small">Invoice for</span>
            <Segmented label="Invoice for" value={what} onChange={setWhat} items={[...(q.totals.deposit > 0 ? [{ key: "deposit" as const, label: `Deposit · ${money(q.totals.deposit)}` }] : []), { key: "full", label: `Full total · ${money(q.totals.total)}` }]} />
          </div>
        )}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" loading={busy} disabled={n === 0} onClick={async () => {
            setBusy(true);
            try {
              const r = await draft({ quoteId: q._id, contract, ...(invoice ? { invoice: what } : {}) });
              show(n === 2 ? "Contract and invoice drafted. Check each before sending." : r.buildId ? "Contract drafted. Check it before sending." : "Invoice drafted. Check it before sending.");
              onClose();
            } catch (e) { show(errText(e)); setBusy(false); }
          }}>{n === 2 ? "Make 2 drafts" : "Make the draft"}</Button>
        </div>
      </div>
    </Modal>
  );
}

export function QuoteDetail({ quoteId }: { quoteId: string }) {
  const q = useQuery(api.quotes.get, { quoteId });
  const send = useAction(api.quotes.send);
  const answerMove = useMutation(api.quotes.answerMove);
  const later = useMutation(api.quotes.later);
  const voidQuote = useMutation(api.quotes.voidQuote);
  const del = useMutation(api.quotes.deleteDraft);
  const [toast, show] = useToast();
  const [ask, confirmNode] = useConfirm();
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const top = (here?: string) => <TopBar><span className="secondary">Payments</span><Sep /><a {...linkProps("/payments/quotes")}>Quotes</a>{here && <><Sep /><span className="here">{here}</span></>}</TopBar>;
  if (q === undefined) return <>{top()}<div className="wp-page"><Card label="Loading"><SkeletonRows n={5} /></Card></div></>;
  if (q === null) return <>{top()}<div className="wp-page"><EmptyState icon="invoice" title="This quote isn't here." actions={<ButtonLink to="/payments/quotes">Quotes</ButtonLink>} /></div></>;
  if (q.status === "draft") return <QuoteEditor key={q._id} quoteId={q._id} />;
  const s = q.display as Status;
  const company = q.contact.company || q.contact.name;
  const doc: QuoteDoc = { business: q.business, number: q.number, issued: longMs(q.sentAt ?? q.createdAt), validUntil: longIso(q.validUntil), contact: q.contact, project: q.title, lines: q.lines, totals: q.totals, taxPercent: q.taxPercent, deposit: q.deposit, terms: q.terms ?? null, acceptUrl: q.link };
  const copy = async () => { try { await navigator.clipboard.writeText(q.link ?? ""); show("Link copied."); } catch { show("Couldn't copy. The link is on the quote."); } };
  const run = async (f: () => Promise<unknown>, msg: string) => { setBusy(true); try { await f(); show(msg); } catch (e) { show(errText(e)); } finally { setBusy(false); } };
  const viewed = q.viewedAt ? ` · viewed ${dateShort(q.viewedAt)}` : "";
  return (
    <>
      {top(q.number)}
      <div className="wp-page q-detail">
        <header className="wp-pagehead">
          <div className="txt">
            <span className="wp-eyebrow">Quote · {company}</span>
            <h1 className="wp-h2">{q.number}.</h1>
            <p className="wp-body">{q.title} · {money(q.totals.total)} · valid until {longIso(q.validUntil)}</p>
          </div>
          <div className="acts"><QuoteChip status={s} /></div>
        </header>
        {s === "sent" && !q.asked?.move && (
          <div className="q-banner">
            <Icon name="info" size={18} />
            <span><b>Sent to {q.contact.name} · {dateShort(q.sentAt ?? q.createdAt)}{viewed}</b><small>Move {company} to Quoted in your pipeline? Nothing moves unless you say so.</small></span>
            <span className="sp" />
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void run(() => answerMove({ quoteId: q._id, yes: false }), "Left as it is.")}>No</button>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void run(() => answerMove({ quoteId: q._id, yes: true }), `${company} is in Quoted.`)}>Yes, move it</Button>
          </div>
        )}
        {s === "accepted" && !q.asked?.draft && (
          <div className="q-banner success">
            <Icon name="check-circle" size={18} />
            <span><b>Accepted by {q.response?.name} · {longMs(q.response?.at ?? 0)}, {new Date(q.response?.at ?? 0).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</b><small>Draft a contract, an invoice, or both from this quote? You check each draft before anything is sent.</small></span>
            <span className="sp" />
            <button type="button" className="btn ghost sm" onClick={() => void run(() => later({ quoteId: q._id, what: "draft" }), "OK. Draft from it any time.")}>Not now</button>
            <Button size="sm" variant="primary" onClick={() => setDrafting(true)}>Draft from this quote</Button>
          </div>
        )}
        {s === "accepted" && q.asked?.draft && !q.asked?.move && (
          <div className="q-banner">
            <Icon name="info" size={18} />
            <span><b>Move {company} on your pipeline?</b><small>It was accepted. Nothing moves unless you say so.</small></span><span className="sp" />
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void run(() => answerMove({ quoteId: q._id, yes: false }), "Left as it is.")}>No</button>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void run(() => answerMove({ quoteId: q._id, yes: true }), `${company} is in Quoted.`)}>Yes, to Quoted</Button>
          </div>
        )}
        {s === "declined" && !q.asked?.seen && (
          <div className="q-banner danger">
            <Icon name="close" size={18} />
            <span><b>Declined by {q.response?.name} · {longMs(q.response?.at ?? 0)}</b><small>{q.response?.reason ? `“${q.response.reason}”` : "No reason given."}</small></span><span className="sp" />
            <Button size="sm" onClick={() => void run(() => later({ quoteId: q._id, what: "seen" }), "OK.")}>OK</Button>
          </div>
        )}
        <div className="q-cols">
          <div className="col"><QuotePaper q={doc} /></div>
          <div className="col right">
            <Card label="Actions" head={<SectionHead label="Actions" />}>
              <div className="crm-steps">
                {s === "accepted" && <Button variant="primary" onClick={() => setDrafting(true)}>Draft from this quote</Button>}
                {s === "sent" && <Button disabled={busy} onClick={() => void run(() => send({ quoteId: q._id, resend: true }), `Sent again to ${q.contact.email}.`)}>Resend</Button>}
                {q.link && s !== "void" && <Button onClick={() => void copy()}>Copy link</Button>}
                <Button onClick={() => void downloadPdf(quotePdf(doc))}>Download PDF</Button>
                {s === "sent" && <button type="button" className="btn ghost" onClick={async () => { if (await ask({ title: `Void ${q.number}?`, body: "Its link stops working and it can't be accepted. You can make a new quote.", yes: "Void quote" })) void run(() => voidQuote({ quoteId: q._id }), "Voided."); }}>Void quote</button>}
                {(s === "expired" || s === "declined" || s === "void") && <ButtonLink to={`/payments/quotes/new${q.clientId ? `?client=${q.clientId}` : ""}`}>New quote</ButtonLink>}
              </div>
            </Card>
            <Card label="History" head={<SectionHead label="History" />}>
              <dl className="crm-dl q-hist">
                {[...q.history].reverse().filter((h) => HIST[h.kind]).map((h, i) => <span key={i} className="crm-pair"><dt>{HIST[h.kind](h, q)}{h.kind === "accepted" ? " (typed name)" : ""}</dt><dd>{longMs(h.at).replace(/, \d{4}$/, "")}, {new Date(h.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</dd></span>)}
              </dl>
            </Card>
            {(s === "accepted" || q.made.build || q.made.invoice) && (
              <Card label="Made from this quote" head={<SectionHead label="Made from this quote" />}>
                {!q.made.build && !q.made.invoice ? <p className="crm-note">Nothing yet. Drafts you make show here.</p> : <>
                  {q.made.build && <ListRow className="ilead" lead={{ icon: "sign" }} to={`/sign/b/${q.made.build._id}`} title={q.made.build.title} meta="Contract draft" chevron />}
                  {q.made.build && q.made.invoice && <Divider />}
                  {q.made.invoice && <ListRow className="ilead" lead={{ icon: "invoice" }} to={`/payments/invoices/${q.made.invoice._id}`} title={q.made.invoice.title} meta={`${money(q.made.invoice.totalCents)} · ${q.made.invoice.status === "draft" ? "draft" : q.made.invoice.status}`} chevron />}
                </>}
              </Card>
            )}
            {q.response?.kind === "accepted" && <p className="wp-small q-proof">Accepted by typing “{q.response.name}”{q.response.ip ? ` from ${q.response.ip}` : ""} on {longMs(q.response.at)}.</p>}
            {s === "draft" && <button type="button" className="btn ghost" onClick={() => void run(() => del({ quoteId: q._id }).then(() => navigate("/payments/quotes")), "Deleted.")}>Delete draft</button>}
          </div>
        </div>
      </div>
      {drafting && <DraftFrom q={q} onClose={() => setDrafting(false)} show={show} />}
      {confirmNode}
      {toast}
    </>
  );
}
