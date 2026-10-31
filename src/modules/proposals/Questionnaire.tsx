// Phase 3b · the proposal questionnaire (S5 · Phase 3b): answering it (711:2231 Client · 711:2873 Project · 713:2647
// Brand kit · 713:3366 Pricing · 714:3765 Timeline · 714:4592 Resources · 714:5274 Special items · 715:3862 Review),
// the "Waiting for Claude" page (715:4525), and the business's own questionnaire editor (718:5483, D70). Answers save
// as they're typed. Pricing suggests lines from Settings › Pricing; typing a different number overrides one (D76).
// At the end the owner picks "Draft with Claude" (through the Sign connector, D89) or "Fill in myself".
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { estimate, primaryKind, type Rates } from "../../../convex/lib/estimate";
import {
  ADDABLE, LOCKED_BINDS, TYPE_LABEL, answerText, bound, linesTotal, type Answers, type ClientAnswer, type FileAnswer, type PLine, type QType, type Question, type Questionnaire, type Step,
} from "../../../convex/lib/questionnaire";
import { Button, ButtonLink, Card, Checkbox, EmptyState, Segmented, SkeletonRows, StatusChip, Toggle } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Menu, MenuItem, Spinner, useConfirm, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { errText, uploadToStorage } from "../docs/pages/common";
import { MoneyInput, money, newId } from "../payments/common";
import type { ProposalInfo } from "../docs/builder/Builder";

const q2 = (n: number) => String(Math.round(n * 100) / 100);
const timeWord = (t: number) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && v !== null && "start" in (v as object) && !(v as { start?: string }).start);

// ---------- the suggested lines (Settings › Pricing) ----------

type Who = { key: string; clientId: string | null; dealId: string | null; name: string; email: string; company: string | null; lead?: boolean };

/** The pricing answers' suggested lines: shooting, editing at the level, a travel day, discounts, and add-ons priced
 *  from a Pricing rate of the same name. */
function suggestions(r: Rates | undefined, qn: Questionnaire, a: Answers): PLine[] {
  if (!r) return [];
  const k0 = primaryKind(r), link0 = r.links[0];
  const days = Math.max(0, Number(bound(qn, a, "pricing.days")) || 0);
  const levelId = String(bound(qn, a, "pricing.level") ?? link0?.defaultLevel ?? "");
  const level = link0?.levels.find((x) => x.id === levelId) ?? link0?.levels.find((x) => x.id === link0.defaultLevel);
  const travel = Math.max(0, Number(bound(qn, a, "pricing.travel")) || 0);
  const out: PLine[] = [];
  if (k0 && days > 0) {
    const est = estimate(r, { base: { [k0.id]: days * r.fullDayHours }, levels: link0 && level ? { [link0.id]: level.id } : {}, travelOver: r.travel.on && travel > r.travel.thresholdHours, travelDays: 1 });
    for (const l of est.lines) {
      const kind = r.kinds.find((k) => k.id === l.kindId)!;
      const linked = r.links.some((x) => x.target === l.kindId);
      const lvl = linked && level ? level.name.split(",")[0].toLowerCase() : null;
      const description = l.kindId === k0.id ? `${kind.name} · ${q2(days)} day${days === 1 ? "" : "s"}` : lvl ? `${kind.name} · ${lvl}` : kind.unit === "day" ? `${kind.name}${l.qty > 1 ? ` × ${q2(l.qty)}` : ""}` : kind.name;
      const note = l.kindId === k0.id ? `${q2(days)} shoot day${days === 1 ? "" : "s"} × ${q2(r.fullDayHours)} h × your ${kind.name} rate` : linked ? `${q2(l.qty)} h × your ${kind.name} rate` : `your ${kind.name} rate`;
      out.push({ id: `auto-${l.kindId}`, description, qty: 1, unitCents: l.clientCents, suggestedCents: l.clientCents, note, auto: l.kindId });
    }
    for (const d of est.discounts ?? []) {
      const rule = r.discounts?.find((x) => x.id === d.id);
      out.push({ id: `auto-d-${d.id}`, description: d.name, qty: 1, unitCents: -d.cents, suggestedCents: -d.cents, note: rule ? `${rule.kind === "percent" ? `${rule.value}% off` : "off"} when the condition is met` : "a discount from Pricing", auto: `discount:${d.id}` });
    }
  }
  for (const name of (bound(qn, a, "special.addons") as string[] | undefined) ?? []) {
    const kind = r.kinds.find((k) => k.name.trim().toLowerCase() === name.trim().toLowerCase());
    out.push({ id: `auto-a-${name}`, description: name, qty: 1, unitCents: kind?.clientCents ?? 0, suggestedCents: kind?.clientCents ?? 0, note: kind ? `your ${kind.name} rate` : "no rate with this name in Settings › Pricing: type a price", auto: `addon:${name}` });
  }
  return out;
}
/** New suggestions in, keeping any price typed over one (it shows as changed, with its suggestion). */
function mergeLines(cur: PLine[], sugg: PLine[]): PLine[] {
  const next = sugg.map((s) => {
    const old = cur.find((l) => l.auto === s.auto);
    return old && old.unitCents !== old.suggestedCents ? { ...s, unitCents: old.unitCents } : s; // the price typed over stays; the wording follows the answers
  });
  return [...next, ...cur.filter((l) => !l.auto)];
}

// ---------- the runner ----------

export function QuestionnaireRunner({ proposalId, preview }: { proposalId?: string; preview?: boolean }) {
  const p = useQuery(api.proposals.get, proposalId ? { proposalId } : "skip");
  const qq = useQuery(api.proposals.questionnaire, {});
  const ratesQ = useQuery(api.crm.rates, {});
  const options = useQuery(api.quotes.options, {});
  const files = useQuery(api.proposals.fileUrls, p ? { proposalId: p._id } : "skip");
  const save = useMutation(api.proposals.saveAnswers);
  const finish = useMutation(api.proposals.finish);
  const [toast, show] = useToast();
  const [a, setA] = useState<Answers | null>(preview ? {} : null);
  const [step, setStep] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [how, setHow] = useState<"claude" | "self">("claude");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const top = useRef<HTMLDivElement | null>(null);
  const r = ratesQ?.rates as Rates | undefined;
  const qn = qq?.questionnaire as Questionnaire | undefined;

  useEffect(() => { if (p && a === null) { setA((p.answers ?? {}) as Answers); setStep(Math.min(p.qStep ?? 0, 20)); } }, [p, a]);
  // Suggested lines follow the answers (a typed-over price stays).
  const sugg = useMemo(() => (qn && a ? suggestions(r, qn, a) : []), [r, qn, a]);
  const suggKey = JSON.stringify(sugg);
  useEffect(() => {
    if (!a || !qn) return;
    // Shoot days cleared to type a new number: keep the lines (and any typed-over price) until there's a number again.
    if (bound(qn, a, "pricing.days") === "") return;
    const next = mergeLines(a.__lines ?? [], sugg);
    if (JSON.stringify(next) !== JSON.stringify(a.__lines ?? [])) { setA({ ...a, __lines: next }); setDirty(true); }
  }, [suggKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Save a moment after the last change.
  const aRef = useRef<Answers | null>(null);
  aRef.current = a;
  useEffect(() => {
    if (!dirty || !a || preview || !p) return;
    const t = setTimeout(async () => {
      const sent = a;
      // A change typed while this save was on its way stays unsaved-and-dirty, so its own save still runs.
      try { await save({ proposalId: p._id, answers: sent, step }); if (aRef.current === sent) setDirty(false); setSavedAt(Date.now()); } catch (e) { show(errText(e)); }
    }, 700);
    return () => clearTimeout(t);
  }, [a, dirty, step]); // eslint-disable-line react-hooks/exhaustive-deps

  if (proposalId && p === null) return <><TopBar><a {...linkProps("/proposals")}>Proposals</a></TopBar><div className="wp-page"><EmptyState icon="quote" title="This proposal isn't here." actions={<ButtonLink to="/proposals">All proposals</ButtonLink>} /></div></>;
  if (!qn || !a || !ratesQ || !options) return <><TopBar><a {...linkProps("/proposals")}>Proposals</a></TopBar><div className="wp-page"><Card label="Loading"><SkeletonRows n={6} /></Card></div></>;
  if (p && !["draft", "waiting", "ready"].includes(p.status)) return <><TopBar><a {...linkProps("/proposals")}>Proposals</a></TopBar><div className="wp-page"><EmptyState icon="lock" title="This proposal has been sent." body="Its answers can't change now." actions={<ButtonLink to={`/proposals/${p._id}`}>Open it</ButtonLink>} /></div></>;

  const steps = qn.steps;
  const reviewAt = steps.length;
  const cur: Step | null = step < reviewAt ? steps[step] : null;
  const set = (id: string, v: unknown) => { setA({ ...a, [id]: v }); setDirty(true); setErr(null); };
  const setLines = (lines: PLine[]) => { setA({ ...a, __lines: lines }); setDirty(true); };
  const go = (n: number) => { setStep(n); setDirty(true); setErr(null); top.current?.scrollIntoView({ block: "start" }); };
  const missing = (s: Step) => s.questions.filter((x) => x.required && isEmpty(a[x.id]));
  const next = () => {
    if (cur) { const m = missing(cur); if (m.length) { setErr(`Answer ${m.map((x) => `"${x.label}"`).join(", ")} first.`); return; } }
    go(step + 1);
  };
  const flush = async () => { if (p && !preview) { await save({ proposalId: p._id, answers: a, step }); setDirty(false); } };
  const later = async () => { try { await flush(); navigate("/proposals"); } catch (e) { show(errText(e)); } };
  const done = async () => {
    if (preview || !p) return;
    const firstMissing = steps.findIndex((s) => missing(s).length);
    if (firstMissing >= 0) { go(firstMissing); setErr(`Answer ${missing(steps[firstMissing]).map((x) => `"${x.label}"`).join(", ")} first.`); return; }
    setBusy(true);
    try { await flush(); await finish({ proposalId: p._id, how }); navigate(`/proposals/${p._id}`); } catch (e) { show(errText(e)); setBusy(false); }
  };

  const client = bound(qn, a, "client") as ClientAnswer | undefined;
  const dep = (bound(qn, a, "pricing.deposit") as { kind: "percent" | "amount"; value: number } | undefined) ?? { kind: "percent" as const, value: 50 };
  const tot = linesTotal(a.__lines, dep);
  const textOf = (b: string) => { const x = steps.flatMap((s) => s.questions).find((y) => y.bind === b); return x ? answerText(x, a[x.id]) : ""; };
  const sofar: Array<[string, string]> = ([
    ["Client", client ? [client.company, client.name].filter(Boolean).join(" · ") : ""], ["Saves as", client?.mode === "new" ? (client.saveAs === "company" ? "New company" : "New lead") : ""],
    ["Project", textOf("project.title")], ["Type", textOf("project.type")], ["Deliverables", textOf("project.deliverables")], ["Total", tot.total ? money(tot.total) : ""],
  ] as Array<[string, string]>).filter(([, v]) => v);

  return (
    <>
      <TopBar right={preview ? <StatusChip tone="warning">Preview · nothing is saved</StatusChip> : savedAt ? <span className="wp-small">Saved · {timeWord(savedAt)}</span> : undefined}>
        <a {...linkProps("/proposals")}>Proposals</a><Sep />{preview ? <><a {...linkProps("/proposals/questionnaire")}>Questionnaire</a><Sep /><span className="here">Preview</span></> : <><a {...linkProps("/proposals/new")}>New proposal</a><Sep /><span className="here">Questionnaire{p ? ` · ${p.number}` : ""}</span></>}
      </TopBar>
      <div className="wp-page qz" ref={top}>
        <header className="wp-pagehead"><div className="txt">
          <span className="wp-eyebrow">Questionnaire · Step {Math.min(step + 1, reviewAt + 1)} of {reviewAt + 1}</span>
          <h1 className="wp-h2">{cur ? cur.heading : "Check your answers."}</h1>
          <p className="wp-body">{cur ? (cur.id === "brand" && client?.company ? cur.sub.replace("the company's", `${client.company}'s`) : cur.sub) : "Change anything with Edit. Then choose how the proposal gets written."}</p>
        </div></header>
        <nav className="qz-steps" aria-label="Steps">
          {[...steps.map((s) => s.title), "Review"].map((t, i) => (
            <span key={t + i} className="qz-stepwrap">{i > 0 && <span className="qz-dash" aria-hidden />}
              <button type="button" className={`qz-step${i === step ? " on" : i < step ? " done" : ""}`} aria-current={i === step ? "step" : undefined} onClick={() => go(i)}>
                <span className="n">{i < step ? <Icon name="check" size={12} plain /> : i + 1}</span>{t}
              </button>
            </span>
          ))}
        </nav>
        {cur ? (
          <div className="qz-cols">
            <div className="col">
              <section className="qz-card glass" aria-label={cur.title}>
                <span className="wp-eyebrow">{cur.title}</span>
                <div className="qz-grid">
                  {cur.questions.map((x) => <Field key={x.id} q={x} v={a[x.id]} set={(v) => set(x.id, v)} r={r} who={options.who as Who[]} proposalId={p?._id ?? null} files={files ?? {}} show={show} preview={!!preview} />)}
                </div>
                {cur.fixed === "pricing" && <PricingLines lines={a.__lines ?? []} setLines={setLines} dep={dep} r={r} />}
              </section>
              {err && <p className="error" role="alert">{err}</p>}
              <div className="qz-foot">
                {!preview && <button type="button" className="btn ghost" onClick={() => void later()}>Save and finish later</button>}
                <span className="sp" />
                {step > 0 && <button type="button" className="btn" onClick={() => go(step - 1)}>Back</button>}
                <Button variant="primary" onClick={next}>{step === reviewAt - 1 ? "Review answers" : "Next"}</Button>
              </div>
            </div>
            <aside className="col right">
              <section className="qz-side glass"><span className="wp-eyebrow">So far</span>
                {sofar.length ? <dl className="crm-dl">{sofar.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl> : <p className="wp-small secondary">Your answers show here as you go.</p>}
              </section>
              <section className="qz-side glass"><span className="wp-eyebrow">What happens next</span>
                <p className="wp-small">At the end you choose: Draft with Claude, or fill it in yourself. Nothing is sent to anyone.</p></section>
            </aside>
          </div>
        ) : (
          <div className="qz-cols">
            <div className="col">
              {steps.map((s, i) => {
                const rows = s.questions.map((x) => [x.label, answerText(x, a[x.id])] as const).filter(([, v]) => v);
                return (
                  <section key={s.id} className="qz-card glass qz-review" aria-label={s.title}>
                    <div className="qz-rhead"><span className="wp-eyebrow">{s.title}</span><button type="button" className="btn ghost sm" onClick={() => go(i)}>Edit</button></div>
                    {rows.length || s.fixed === "pricing" ? <dl className="crm-dl">
                      {rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}
                      {s.fixed === "pricing" && <><dt>Total</dt><dd>{money(tot.total)}{(a.__lines ?? []).some((l) => l.auto && l.unitCents !== l.suggestedCents) ? " (changed)" : ""} · deposit {money(tot.deposit)}</dd></>}
                    </dl> : <p className="wp-small secondary">Nothing answered.</p>}
                    {missing(s).length > 0 && <p className="error">Still to answer: {missing(s).map((x) => x.label).join(", ")}.</p>}
                  </section>
                );
              })}
              {err && <p className="error" role="alert">{err}</p>}
              <div className="qz-foot">
                {!preview && <button type="button" className="btn ghost" onClick={() => void later()}>Save and finish later</button>}
                <span className="sp" />
                <button type="button" className="btn" onClick={() => go(step - 1)}>Back</button>
                <Button variant="primary" loading={busy} disabled={!!preview} title={preview ? "Preview: nothing is saved" : undefined} onClick={() => void done()}>{how === "claude" ? "Draft with Claude" : "Fill in myself"}</Button>
              </div>
            </div>
            <aside className="col right">
              <section className="qz-side glass" aria-label="How should it be written?"><span className="wp-eyebrow">How should it be written?</span>
                <button type="button" className={`qz-how${how === "claude" ? " on" : ""}`} aria-pressed={how === "claude"} onClick={() => setHow("claude")}>
                  <span className="dot" aria-hidden /><span><b>Draft with Claude</b><small>Claude writes it from your answers in your own Claude app, through the connector. You review it before anything is sent.</small></span>
                </button>
                <button type="button" className={`qz-how${how === "self" ? " on" : ""}`} aria-pressed={how === "self"} onClick={() => setHow("self")}>
                  <span className="dot" aria-hidden /><span><b>Fill in myself</b><small>Opens the builder with your answers placed into a plain outline.</small></span>
                </button>
                <p className="wp-small secondary">The portal doesn't write anything by itself.</p>
              </section>
            </aside>
          </div>
        )}
      </div>
      {toast}
    </>
  );
}

/** One question, by its answer type. */
function Field({ q, v, set, r, who, proposalId, files, show, preview }: {
  q: Question; v: unknown; set: (v: unknown) => void; r: Rates | undefined; who: Who[]; proposalId: Id<"proposals"> | null; files: Record<string, string | null>; show: (m: string) => void; preview: boolean;
}) {
  const label = <span className="wp-field-label">{q.label}{q.required && <span className="req" aria-label="required"> *</span>}</span>;
  const help = q.help ? <span className="wp-small secondary">{q.help}</span> : null;
  const wrap = (body: React.ReactNode, wide = !q.half) => <div className={`wp-field qz-q${wide ? " wide" : ""}`}>{label}{body}{help}</div>;
  switch (q.type) {
    case "client": return <div className="qz-q wide"><ClientField v={v as ClientAnswer | undefined} set={set} who={who} /></div>;
    case "short": return wrap(<input className="input" value={(v as string) ?? ""} onChange={(e) => set(e.target.value)} />);
    case "long": return wrap(<textarea className="input" rows={3} value={(v as string) ?? ""} onChange={(e) => set(e.target.value)} />);
    case "number": return wrap(<input className="input" type="number" min={0} inputMode="decimal" value={(v as number | string) ?? ""} onChange={(e) => set(e.target.value === "" ? "" : Number(e.target.value))} />, false);
    case "money": return wrap(<MoneyInput label={q.label} value={(v as number) ?? 0} onChange={(c) => set(c || "")} />, false);
    case "date": return wrap(<input className="input" type="date" value={(v as string) ?? ""} onChange={(e) => set(e.target.value)} />, false);
    case "daterange": { const d = (v as { start?: string; end?: string }) ?? {}; return wrap(<span className="qz-range"><input className="input" type="date" aria-label={`${q.label}: from`} value={d.start ?? ""} onChange={(e) => set({ ...d, start: e.target.value })} /><span>–</span><input className="input" type="date" aria-label={`${q.label}: to`} value={d.end ?? ""} min={d.start} onChange={(e) => set({ ...d, end: e.target.value })} /></span>, false); }
    case "select": {
      if (q.bind === "pricing.level") {
        const link0 = r?.links[0];
        return wrap(<select className="input" value={(v as string) ?? link0?.defaultLevel ?? ""} onChange={(e) => set(e.target.value)} disabled={!link0}>
          {link0 ? link0.levels.map((l) => <option key={l.id} value={l.id}>{l.name.split(",")[0]} · {q2(l.mult)}×</option>) : <option value="">Set levels in Settings › Pricing</option>}
        </select>, false);
      }
      const opts = q.options ?? [];
      const other = typeof v === "string" && v !== "" && !opts.includes(v);
      return wrap(<>
        <select className="input" value={other ? "__other" : ((v as string) ?? "")} onChange={(e) => set(e.target.value === "__other" ? " " : e.target.value)}>
          <option value="">Pick one</option>{opts.map((o) => <option key={o} value={o}>{o}</option>)}{q.other && <option value="__other">Other…</option>}
        </select>
        {other && <input className="input" aria-label={`${q.label}: other`} placeholder="Type it" value={String(v).trimStart()} onChange={(e) => set(e.target.value || " ")} />}
      </>, false);
    }
    case "multi": case "addons": {
      const list = (v as string[]) ?? [];
      const toggle = (o: string) => set(list.includes(o) ? list.filter((x) => x !== o) : [...list, o]);
      const extra = list.filter((x) => !(q.options ?? []).includes(x));
      if (q.type === "addons") return wrap(<div className="qz-checks">{(q.options ?? []).map((o) => {
        const kind = r?.kinds.find((k) => k.name.trim().toLowerCase() === o.trim().toLowerCase());
        return <Checkbox key={o} checked={list.includes(o)} onChange={() => toggle(o)} label={o} hint={kind ? `${money(kind.clientCents)} from Pricing` : undefined} />;
      })}</div>);
      return wrap(<div className="qz-chips">
        {[...(q.options ?? []), ...extra].map((o) => <button key={o} type="button" className={`qz-chip${list.includes(o) ? " on" : ""}`} aria-pressed={list.includes(o)} onClick={() => toggle(o)}>{o}</button>)}
        {q.other && <AddWord onAdd={(w) => { if (!list.includes(w)) set([...list, w]); }} label={q.bind === "brand.tone" ? "Add a word" : "Other"} />}
      </div>);
    }
    case "link": {
      if (!q.multiple) return wrap(<span className="qz-icon-in"><Icon name="globe" size={16} /><input className="input" type="url" placeholder="https://" value={(v as string) ?? ""} onChange={(e) => set(e.target.value)} /></span>, false);
      const list = ((v as string[]) ?? []);
      return wrap(<div className="qz-list">
        {list.map((u, i) => <span key={i} className="qz-row"><span className="qz-icon-in"><Icon name="globe" size={16} /><input className="input" type="url" placeholder="https://" value={u} onChange={(e) => set(list.map((x, j) => (j === i ? e.target.value : x)))} /></span><button type="button" className="icon-btn" aria-label="Remove link" onClick={() => set(list.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button></span>)}
        <button type="button" className="btn ghost sm qz-add" onClick={() => set([...list, ""])}><Icon name="plus" size={14} />Add a link</button>
      </div>);
    }
    case "colors": {
      const list = (v as string[]) ?? [];
      return wrap(<div className="qz-colors">
        {list.map((hex, i) => <span key={i} className="qz-color"><input type="color" aria-label={`Colour ${i + 1}`} value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : "#000000"} onChange={(e) => set(list.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)))} />
          <input className="input" aria-label={`Colour ${i + 1} hex`} value={hex} onChange={(e) => set(list.map((x, j) => (j === i ? e.target.value : x)))} />
          <button type="button" className="icon-btn sm" aria-label="Remove colour" onClick={() => set(list.filter((_, j) => j !== i))}><Icon name="close" size={12} /></button></span>)}
        {list.length < 12 && <button type="button" className="btn ghost sm" onClick={() => set([...list, "#"])}><Icon name="plus" size={14} />Add a colour</button>}
      </div>);
    }
    case "milestones": {
      const list = (v as Array<{ name: string; date?: string }>) ?? [];
      return wrap(<div className="qz-list">
        {list.map((m, i) => <span key={i} className="qz-row"><input className="input" placeholder="e.g. First cut to the client" value={m.name} onChange={(e) => set(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <input className="input qz-date" type="date" aria-label="Date" value={m.date ?? ""} onChange={(e) => set(list.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
          <button type="button" className="icon-btn" aria-label="Remove milestone" onClick={() => set(list.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button></span>)}
        <button type="button" className="btn ghost sm qz-add" onClick={() => set([...list, { name: "" }])}><Icon name="plus" size={14} />Add milestone</button>
      </div>);
    }
    case "deposit": {
      const d = (v as { kind: "percent" | "amount"; value: number }) ?? { kind: "percent", value: 50 };
      return wrap(<span className="qz-dep">
        <Segmented label="Deposit as" value={d.kind} onChange={(k) => set({ kind: k, value: k === "percent" ? 50 : 0 })} items={[{ key: "percent", label: "%" }, { key: "amount", label: "$" }]} />
        {d.kind === "percent" ? <input className="input" type="number" min={0} max={100} aria-label="Deposit percent" value={d.value} onChange={(e) => set({ kind: "percent", value: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
          : <MoneyInput label="Deposit amount" value={d.value} onChange={(c) => set({ kind: "amount", value: c })} />}
      </span>, false);
    }
    case "file": {
      const list = (v as FileAnswer[]) ?? [];
      return wrap(<FileField list={list} set={set} proposalId={proposalId} urls={files} show={show} preview={preview} />);
    }
  }
}

function AddWord({ onAdd, label }: { onAdd: (w: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const [w, setW] = useState("");
  if (!open) return <button type="button" className="qz-chip add" onClick={() => setOpen(true)}><Icon name="plus" size={12} />{label}</button>;
  const add = () => { const t = w.trim(); if (t) onAdd(t.slice(0, 60)); setW(""); setOpen(false); };
  return <span className="qz-addword"><input className="input sm" autoFocus value={w} placeholder="Type it" onChange={(e) => setW(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } if (e.key === "Escape") setOpen(false); }} onBlur={add} /></span>;
}

function ClientField({ v, set, who }: { v: ClientAnswer | undefined; set: (v: ClientAnswer) => void; who: Who[] }) {
  const c: ClientAnswer = v ?? { mode: "existing", company: "", name: "", email: "" };
  const upd = (p: Partial<ClientAnswer>) => set({ ...c, ...p });
  const key = c.key ?? who.find((w) => (c.clientId && w.clientId === c.clientId && w.email === c.email) || (c.dealId && w.dealId === c.dealId))?.key ?? "";
  return (
    <div className="qz-client">
      <span className="wp-field-label">Client</span>
      <Segmented label="Client" value={c.mode} onChange={(m) => set(m === "new" ? { mode: "new", company: "", name: "", email: "", saveAs: "lead" } : { mode: "existing", company: "", name: "", email: "" })} items={[{ key: "existing", label: "Existing company or lead" }, { key: "new", label: "New" }]} />
      {c.mode === "existing" ? (
        <label className="wp-field"><span className="wp-field-label">Company or lead</span>
          <select className="input" value={key} onChange={(e) => { const w = who.find((x) => x.key === e.target.value); if (w) set({ mode: "existing", key: w.key, ...(w.clientId ? { clientId: w.clientId } : {}), ...(w.dealId ? { dealId: w.dealId } : {}), company: w.company ?? "", name: w.name, email: w.email }); }}>
            <option value="">Pick a person</option>
            {who.map((w) => <option key={w.key} value={w.key}>{[w.company, w.name].filter(Boolean).join(" · ")}{w.lead ? " (lead)" : ""}</option>)}
          </select></label>
      ) : (
        <div className="qz-grid">
          <label className="wp-field qz-q"><span className="wp-field-label">Company name</span><input className="input" value={c.company} onChange={(e) => upd({ company: e.target.value })} /></label>
          <label className="wp-field qz-q"><span className="wp-field-label">Website</span><span className="qz-icon-in"><Icon name="globe" size={16} /><input className="input" value={c.website ?? ""} onChange={(e) => upd({ website: e.target.value })} /></span></label>
          <label className="wp-field qz-q"><span className="wp-field-label">Contact name</span><input className="input" value={c.name} onChange={(e) => upd({ name: e.target.value })} /></label>
          <label className="wp-field qz-q"><span className="wp-field-label">Email</span><span className="qz-icon-in"><Icon name="mail" size={16} /><input className="input" type="email" value={c.email} onChange={(e) => upd({ email: e.target.value })} /></span></label>
          <label className="wp-field qz-q"><span className="wp-field-label">Phone (optional)</span><span className="qz-icon-in"><Icon name="phone" size={16} /><input className="input" type="tel" placeholder="(000) 000-0000" value={c.phone ?? ""} onChange={(e) => upd({ phone: e.target.value })} /></span></label>
          <label className="wp-field qz-q"><span className="wp-field-label">Saves as</span>
            <select className="input" value={c.saveAs ?? "lead"} onChange={(e) => upd({ saveAs: e.target.value as "lead" | "company" })}><option value="lead">A new lead in your pipeline</option><option value="company">A new company</option></select></label>
        </div>
      )}
    </div>
  );
}

function FileField({ list, set, proposalId, urls, show, preview }: { list: FileAnswer[]; set: (v: FileAnswer[]) => void; proposalId: Id<"proposals"> | null; urls: Record<string, string | null>; show: (m: string) => void; preview: boolean }) {
  const uploadUrl = useMutation(api.proposals.answerUploadUrl);
  const addFile = useMutation(api.proposals.addAnswerFile);
  const [uploading, setUploading] = useState<string[]>([]);
  const listRef = useRef(list);
  listRef.current = list;
  const add = async (picked: FileList | null) => {
    if (!picked || !proposalId || preview) return;
    for (const f of Array.from(picked)) {
      if (f.size > 25 * 1024 * 1024) { show(`${f.name} is over 25 MB. Link to it instead.`); continue; }
      setUploading((u) => [...u, f.name]);
      try {
        const storageId = await uploadToStorage(await uploadUrl({}), f);
        const r = await addFile({ proposalId, storageId, name: f.name });
        if ("error" in r) show(r.error); else set([...listRef.current, r]);
      } catch (e) { show(errText(e)); } finally { setUploading((u) => u.filter((x) => x !== f.name)); }
    }
  };
  return (
    <div className="qz-list">
      {list.map((f) => <span key={f.fileId} className="qz-file"><Icon name="document" size={16} />{urls[f.fileId] ? <a href={urls[f.fileId]!} target="_blank" rel="noopener noreferrer">{f.name}</a> : <span>{f.name}</span>}<span className="sp" /><button type="button" className="icon-btn sm" aria-label={`Remove ${f.name}`} onClick={() => set(list.filter((x) => x.fileId !== f.fileId))}><Icon name="close" size={12} /></button></span>)}
      {uploading.map((n) => <span key={n} className="qz-file"><Spinner /><span>{n}</span></span>)}
      <label className={`qz-drop${preview ? " off" : ""}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void add(e.dataTransfer.files); }}>
        <Icon name="upload" size={16} /> {preview ? "Uploads work on a real proposal" : <>Drop files, or <span className="lnk">browse</span></>}
        <input type="file" multiple hidden disabled={preview} onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
      </label>
    </div>
  );
}

function PricingLines({ lines, setLines, dep, r }: { lines: PLine[]; setLines: (l: PLine[]) => void; dep: { kind: "percent" | "amount"; value: number }; r: Rates | undefined }) {
  const t = linesTotal(lines, dep);
  const sugg = lines.reduce((s, l) => s + Math.round(l.qty * (l.suggestedCents ?? l.unitCents)), 0);
  const disc = lines.filter((l) => l.auto?.startsWith("discount:")).length;
  const setLine = (i: number, p: Partial<PLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  return (
    <div className="qz-lines">
      {lines.length === 0 && <p className="wp-small secondary">Answer Shoot days to see suggested prices from Settings › Pricing.</p>}
      {lines.map((l, i) => {
        const changed = l.suggestedCents !== undefined && l.unitCents !== l.suggestedCents;
        return (
          <div key={l.id} className="qz-line">
            <div className="txt">
              {l.auto ? <b>{l.description}</b> : <input className="input sm" aria-label="Line description" placeholder="Describe the line" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />}
              {l.note && <span className="wp-small secondary">{changed ? `Suggested ${money(l.suggestedCents!)} · ` : "Suggested · "}{l.note}</span>}
              {changed && <span className="qz-changed"><StatusChip tone="warning">Changed</StatusChip><button type="button" className="lnk" onClick={() => setLine(i, { unitCents: l.suggestedCents! })}>Use suggested ({money(l.suggestedCents!)})</button></span>}
            </div>
            <MoneyInput label={`Price of ${l.description || "the line"}`} value={l.unitCents} onChange={(c) => setLine(i, { unitCents: l.auto?.startsWith("discount:") ? -Math.abs(c) : c })} />
            {!l.auto && <button type="button" className="icon-btn sm" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Icon name="close" size={12} /></button>}
          </div>
        );
      })}
      <button type="button" className="btn ghost sm qz-add" onClick={() => setLines([...lines, { id: newId(), description: "", qty: 1, unitCents: 0 }])}><Icon name="plus" size={14} />Add a line</button>
      <div className="qz-total"><span><b>Total</b><span className="wp-small secondary">Suggested {money(sugg)}{disc ? " less the discount" : ""} · deposit {dep.kind === "percent" ? `${dep.value}%` : money(dep.value)}</span></span><b className="amt">{money(t.total)}</b></div>
    </div>
  );
}

// ---------- waiting for Claude (715:4525) ----------

export function ProposalWaiting({ p }: { p: ProposalInfo }) {
  const qq = useQuery(api.proposals.questionnaire, {});
  const fillInstead = useMutation(api.proposals.fillInstead);
  const [toast, show] = useToast();
  const [busy, setBusy] = useState(false);
  const phrase = `Draft proposal ${p.number} in Wrangler Portal`;
  const askedAt = [...p.history].reverse().find((h) => h.kind === "asked_claude")?.at ?? null;
  const qn = qq?.questionnaire as Questionnaire | undefined;
  const a = (p.answers ?? {}) as Answers;
  const txt = (b: string) => { const x = qn?.steps.flatMap((s) => s.questions).find((y) => y.bind === b); return x ? answerText(x, a[x.id]) : ""; };
  const rows: Array<[string, string]> = ([
    ["Client", [p.who.company, p.who.name].filter(Boolean).join(" · ")], ["Project", [txt("project.type"), txt("project.deliverables")].filter(Boolean).join(" · ")],
    ["Total", money(linesTotal(a.__lines, undefined).total)], ["Shoot", txt("timeline.shoot")], ["Brand kit", p.who.company ? `${p.who.company}${p.client ? "" : " (new)"}` : ""],
  ] as Array<[string, string]>).filter(([, v]) => v);
  return (
    <>
      <TopBar right={<Button size="sm" loading={busy} onClick={async () => { setBusy(true); try { await fillInstead({ proposalId: p._id }); } catch (e) { show(errText(e)); setBusy(false); } }}>Fill in myself instead</Button>}>
        <a {...linkProps("/proposals")}>Proposals</a><Sep /><a {...linkProps("/proposals")}>All proposals</a><Sep /><span className="here">{p.title}</span>
      </TopBar>
      <div className="wp-page">
        <header className="wp-pagehead"><div className="txt">
          <span className="wp-eyebrow">Proposal {p.number}{p.who.company ? ` · ${p.who.company}` : ""}</span>
          <h1 className="wp-h2">{p.title.replace(/\.$/, "")}.</h1>
          <p className="wp-body">Started from the questionnaire</p>
        </div><StatusChip tone="warning">Waiting for Claude</StatusChip></header>
        <section className="qz-card glass" aria-label="Waiting for Claude">
          <span className="wp-eyebrow">Waiting for Claude</span>
          <p className="wp-body">Open your Claude app and say this. Claude reads your answers through the connector and writes the draft here.</p>
          <div className="qz-phrase"><span>“{phrase}”</span><button type="button" className="btn sm" onClick={() => void navigator.clipboard?.writeText(phrase).then(() => show("Copied"), () => show("Couldn't copy"))}>Copy</button></div>
          <p className="wp-small secondary qz-wait"><Spinner /> This page updates when the draft lands. You can leave it.</p>
          {askedAt && Date.now() - askedAt > 10 * 60_000 && (
            <div className="wp-notice warn"><Icon name="clock" size={20} /><span className="txt"><b>Still waiting for Claude (since {timeWord(askedAt)})</b><span className="wp-small"> Check the connector is on in your Claude app, then say the line again. Or fill it in yourself.</span></span></div>
          )}
          <p className="wp-small secondary">Claude needs the Wrangler Sign connector (Settings › Claude connectors).</p>
        </section>
        <section className="qz-card glass" aria-label="Your answers">
          <div className="qz-rhead"><span className="wp-eyebrow">Your answers</span><ButtonLink variant="ghost" size="sm" to={`/proposals/${p._id}/questions`}>Edit answers</ButtonLink></div>
          <dl className="crm-dl">{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
        </section>
      </div>
      {toast}
    </>
  );
}

// ---------- the business's questionnaire editor (718:5483, D70) ----------

export function QuestionnaireEditor() {
  const qq = useQuery(api.proposals.questionnaire, {});
  const save = useMutation(api.proposals.saveQuestionnaire);
  const reset = useMutation(api.proposals.resetQuestionnaire);
  const [toast, show] = useToast();
  const [confirm, confirmNode] = useConfirm();
  const [qn, setQn] = useState<Questionnaire | null>(null);
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [renaming, setRenaming] = useState(false);
  useEffect(() => { if (qq && !qn) setQn(qq.questionnaire as Questionnaire); }, [qq, qn]);
  useEffect(() => {
    if (!dirty || !qn) return;
    const t = setTimeout(async () => { try { await save({ questionnaire: qn }); setDirty(false); setSavedAt(Date.now()); } catch (e) { show(errText(e)); } }, 800);
    return () => clearTimeout(t);
  }, [qn, dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!qn) return <><TopBar><a {...linkProps("/proposals")}>Proposals</a><Sep /><span className="here">Questionnaire</span></TopBar><div className="wp-page"><Card label="Loading"><SkeletonRows n={6} /></Card></div></>;
  const edit = (f: (q: Questionnaire) => Questionnaire) => { setQn(f(qn)); setDirty(true); };
  const step = qn.steps[Math.min(sel, qn.steps.length - 1)];
  const setStep = (p: Partial<Step>) => edit((q) => ({ steps: q.steps.map((s) => (s.id === step.id ? { ...s, ...p } : s)) }));
  const setQ = (id: string, p: Partial<Question>) => setStep({ questions: step.questions.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const moveQ = (i: number, d: -1 | 1) => { const qs = [...step.questions]; const j = i + d; if (j < 0 || j >= qs.length) return; [qs[i], qs[j]] = [qs[j], qs[i]]; setStep({ questions: qs }); };
  const moveStep = (i: number, d: -1 | 1) => edit((q) => { const ss = [...q.steps]; const j = i + d; if (j < 0 || j >= ss.length) return q; [ss[i], ss[j]] = [ss[j], ss[i]]; setSel(j); return { steps: ss }; });
  const locked = (x: Question) => !!x.bind && LOCKED_BINDS.has(x.bind);
  const builtIn = (x: Question) => !ADDABLE.some((t) => t.type === x.type) || locked(x);
  return (
    <>
      <TopBar right={savedAt ? <span className="wp-small">Saved · {timeWord(savedAt)}</span> : undefined}><a {...linkProps("/proposals")}>Proposals</a><Sep /><span className="here">Questionnaire</span></TopBar>
      <div className="wp-page qz-edit">
        <header className="wp-pagehead"><div className="txt"><span className="wp-eyebrow">Proposals</span><h1 className="wp-h2">Your questionnaire.</h1>
          <p className="wp-body">The questions New proposal asks, step by step. {qq?.custom ? "Your own set; change anything." : "Started from Wrangler's set; change anything."}</p></div>
          <div className="acts">
            <Button onClick={async () => { if (!(await confirm({ title: "Reset to Wrangler's set?", body: "Your steps and questions go back to the starting set. Proposals already answered keep their answers.", yes: "Reset", danger: true }))) return; try { await reset({}); setQn(qq!.wrangler as Questionnaire); setSel(0); setDirty(false); show("Back to Wrangler's set"); } catch (e) { show(errText(e)); } }}>Reset to Wrangler's set</Button>
            <ButtonLink variant="primary" to="/proposals/questionnaire/preview">Preview</ButtonLink>
          </div>
        </header>
        <div className="qz-ecols">
          <div className="col">
            <section className="qz-card glass qz-steplist" aria-label="Steps"><span className="wp-eyebrow">Steps <span className="secondary">{qn.steps.length}</span></span>
              {qn.steps.map((s, i) => <button key={s.id} type="button" className={`qz-sitem${i === sel ? " on" : ""}`} onClick={() => { setSel(i); setOpen(null); setRenaming(false); }}><span>{i + 1}. {s.title}</span><span className="secondary">{s.questions.length}</span></button>)}
              {qn.steps.length < 12 && <button type="button" className="btn ghost sm qz-add" onClick={() => { const id = `s${newId()}`; edit((q) => ({ steps: [...q.steps, { id, title: "New step", heading: "New step.", sub: "", questions: [] }] })); setSel(qn.steps.length); setRenaming(true); }}><Icon name="plus" size={14} />Add step</button>}
            </section>
            <p className="wp-small secondary">Client and Pricing can't be removed: a proposal needs both.</p>
          </div>
          <section className="qz-card glass col" aria-label={step.title}>
            <div className="qz-rhead">
              <span className="wp-eyebrow">Step {sel + 1} · {step.title} <span className="secondary">{step.questions.length}</span></span>
              <span className="pr-tacts">
                <button type="button" className="btn ghost sm" onClick={() => setRenaming(!renaming)}>Rename step</button>
                <Menu label="More for this step" align="end" trigger={(p) => <button type="button" className="icon-btn sm" aria-label="More for this step" {...p}><Icon name="more" size={18} /></button>}>
                  <MenuItem disabled={sel === 0} onSelect={() => moveStep(sel, -1)}>Move up</MenuItem>
                  <MenuItem disabled={sel === qn.steps.length - 1} onSelect={() => moveStep(sel, 1)}>Move down</MenuItem>
                  <MenuItem danger disabled={!!step.fixed} onSelect={async () => { if (!(await confirm({ title: `Remove "${step.title}"?`, body: "Its questions go too.", yes: "Remove", danger: true }))) return; edit((q) => ({ steps: q.steps.filter((s) => s.id !== step.id) })); setSel(Math.max(0, sel - 1)); }}>Remove step</MenuItem>
                </Menu>
              </span>
            </div>
            {renaming && <div className="qz-grid qz-rename">
              <label className="wp-field qz-q"><span className="wp-field-label">Step name</span><input className="input" value={step.title} onChange={(e) => setStep({ title: e.target.value })} /></label>
              <label className="wp-field qz-q"><span className="wp-field-label">Page title</span><input className="input" value={step.heading} onChange={(e) => setStep({ heading: e.target.value })} /></label>
              <label className="wp-field qz-q wide"><span className="wp-field-label">Line under the title</span><input className="input" value={step.sub} onChange={(e) => setStep({ sub: e.target.value })} /></label>
            </div>}
            {step.questions.map((x, i) => (
              <div key={x.id} className={`qz-eq${open === x.id ? " open" : ""}`}>
                <div className="qz-eqhead">
                  <button type="button" className="qz-eqname" onClick={() => setOpen(open === x.id ? null : x.id)} aria-expanded={open === x.id}>{x.label}</button>
                  <span className="qz-type">{TYPE_LABEL[x.type]}</span>
                  <span className="qz-req">Required <Toggle label={`${x.label} required`} checked={!!x.required} disabled={locked(x) && x.bind === "client"} onChange={(on) => setQ(x.id, { required: on })} /></span>
                  <Menu label={`More for ${x.label}`} align="end" trigger={(p) => <button type="button" className="icon-btn sm" aria-label={`More for ${x.label}`} {...p}><Icon name="more" size={18} /></button>}>
                    <MenuItem onSelect={() => setOpen(open === x.id ? null : x.id)}>{open === x.id ? "Close" : "Edit"}</MenuItem>
                    <MenuItem disabled={i === 0} onSelect={() => moveQ(i, -1)}>Move up</MenuItem>
                    <MenuItem disabled={i === step.questions.length - 1} onSelect={() => moveQ(i, 1)}>Move down</MenuItem>
                    <MenuItem danger disabled={locked(x)} onSelect={() => setStep({ questions: step.questions.filter((y) => y.id !== x.id) })}>Remove</MenuItem>
                  </Menu>
                </div>
                {open === x.id && (
                  <div className="qz-eqbody qz-grid">
                    <label className="wp-field qz-q"><span className="wp-field-label">Question</span><input className="input" value={x.label} onChange={(e) => setQ(x.id, { label: e.target.value })} /></label>
                    <label className="wp-field qz-q"><span className="wp-field-label">Answer type</span>
                      <select className="input" value={x.type} disabled={builtIn(x)} onChange={(e) => setQ(x.id, { type: e.target.value as QType })}>
                        {builtIn(x) ? <option value={x.type}>{TYPE_LABEL[x.type]} (built in)</option> : ADDABLE.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
                      </select></label>
                    <label className="wp-field qz-q wide"><span className="wp-field-label">Help text (optional)</span><input className="input" placeholder="Shown under the question" value={x.help ?? ""} onChange={(e) => setQ(x.id, { help: e.target.value })} /></label>
                    {(x.type === "select" || x.type === "multi" || x.type === "addons") && x.bind !== "pricing.level" && (
                      <div className="wp-field qz-q wide"><span className="wp-field-label">Options</span>
                        {(x.options ?? []).map((o, j) => <span key={j} className="qz-row"><input className="input" value={o} aria-label={`Option ${j + 1}`} onChange={(e) => setQ(x.id, { options: (x.options ?? []).map((y, k) => (k === j ? e.target.value : y)) })} /><button type="button" className="icon-btn" aria-label={`Remove ${o}`} onClick={() => setQ(x.id, { options: (x.options ?? []).filter((_, k) => k !== j) })}><Icon name="close" size={14} /></button></span>)}
                        <button type="button" className="btn ghost sm qz-add" onClick={() => setQ(x.id, { options: [...(x.options ?? []), ""] })}><Icon name="plus" size={14} />Add option</button>
                        {x.type !== "addons" && <Checkbox checked={!!x.other} onChange={(on) => setQ(x.id, { other: on })} label={'Allow "Other" (the person types their own)'} />}
                        {x.type === "addons" && <p className="wp-small secondary">An add-on is priced from the Settings › Pricing rate with the same name.</p>}
                      </div>
                    )}
                    {x.bind === "pricing.level" && <p className="wp-small secondary wide">The levels come from Settings › Pricing.</p>}
                    {x.type === "link" && <Checkbox checked={!!x.multiple} onChange={(on) => setQ(x.id, { multiple: on })} label="Allow more than one link" />}
                  </div>
                )}
              </div>
            ))}
            {step.questions.length < 20 && <Menu label="Add question" trigger={(p) => <button type="button" className="btn ghost sm qz-add" {...p}><Icon name="plus" size={14} />Add question</button>}>
              {ADDABLE.map((t) => <MenuItem key={t.type} onSelect={() => { const id = `q${newId()}`; setStep({ questions: [...step.questions, { id, label: t.label, type: t.type, ...(t.type === "select" || t.type === "multi" ? { options: ["Option 1"] } : {}) }] }); setOpen(id); }}>{t.label}</MenuItem>)}
            </Menu>}
          </section>
        </div>
      </div>
      {confirmNode}{toast}
    </>
  );
}
