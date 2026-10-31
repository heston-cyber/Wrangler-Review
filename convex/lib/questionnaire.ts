// Phase 3b · the proposal questionnaire (S5 · Phase 3b 711:2231 → 715:3862; the editor 718:5483). Each business edits
// its own set, starting from Wrangler's (D70). Steps hold questions of ten answer types; a few questions are built in
// (the client picker, the pricing parts, colours, milestones, add-ons) and keep their type. Client and Pricing can't be
// removed: a proposal needs both. The answers become the proposal two ways: Claude drafts it through the Sign connector
// (D89), or "Fill in myself" places them into a plain outline (outlineFromAnswers).
import { atom, bulletList, line, newId, section, type Page, type PNode } from "./wsBuilder";

export type QType = "short" | "long" | "select" | "multi" | "link" | "file" | "date" | "daterange" | "money" | "number"
  | "client" | "colors" | "milestones" | "addons" | "deposit";
export const ADDABLE: Array<{ type: QType; label: string }> = [
  { type: "short", label: "Short text" }, { type: "long", label: "Long text" }, { type: "select", label: "Drop-down" }, { type: "multi", label: "Multi-select" },
  { type: "link", label: "Link" }, { type: "file", label: "File upload" }, { type: "date", label: "Date" }, { type: "daterange", label: "Date range" },
  { type: "money", label: "Money" }, { type: "number", label: "Number" },
];
export const TYPE_LABEL: Record<QType, string> = {
  short: "Short text", long: "Long text", select: "Drop-down", multi: "Multi-select", link: "Link", file: "File upload", date: "Date", daterange: "Date range",
  money: "Money", number: "Number", client: "Client", colors: "Colours", milestones: "Milestones", addons: "Add-ons", deposit: "Deposit",
};
export type Question = { id: string; label: string; type: QType; help?: string; required?: boolean; options?: string[]; other?: boolean; multiple?: boolean; bind?: string; placeholder?: string; half?: boolean };
export type Step = { id: string; title: string; heading: string; sub: string; fixed?: "client" | "pricing"; questions: Question[] };
export type Questionnaire = { steps: Step[] };

/** Questions the portal itself reads (the client, the pricing parts): their type can't change and they can't go. */
export const LOCKED_BINDS = new Set(["client", "pricing.days", "pricing.level", "pricing.travel", "pricing.model", "pricing.schedule", "pricing.deposit"]);
export const PRICING_MODELS = ["Fixed price", "Per day", "Hourly", "Retainer"]; // D82
/** The locked questions keep their type whatever is saved. */
const LOCKED_TYPE: Record<string, QType> = { client: "client", "pricing.days": "number", "pricing.level": "select", "pricing.travel": "number", "pricing.model": "select", "pricing.schedule": "select", "pricing.deposit": "deposit" };

const q = (id: string, label: string, type: QType, more: Partial<Question> = {}): Question => ({ id, label, type, ...more });

/** Wrangler's set (the frames' questions), which every business starts from. */
export const WRANGLER_QUESTIONNAIRE: Questionnaire = { steps: [
  { id: "client", title: "Client", heading: "Who is it for?", sub: "Pick a company or lead you already have, or add someone new. New people don't need a portal account.", fixed: "client",
    questions: [q("client", "Client", "client", { bind: "client", required: true })] },
  { id: "project", title: "Project", heading: "What's the project?", sub: "A few lines is enough. Claude turns this into the Overview and Scope.", questions: [
    q("title", "Project title", "short", { bind: "project.title", required: true }),
    q("type", "Type", "select", { bind: "project.type", required: true, half: true, options: ["Brand film", "Commercial", "Event coverage", "Social content", "Documentary", "Music video"], other: true }),
    q("budget", "Client's budget (optional)", "money", { bind: "project.budget", half: true }),
    q("scope", "Scope", "long", { bind: "project.scope", required: true, help: "What you'll film, where, and who's there." }),
    q("deliverables", "Deliverables", "multi", { bind: "project.deliverables", options: ["Hero film", "Recap film", "60s cutdown", "30s cutdown", "15s social cuts", "Vertical cuts", "Photos", "Behind the scenes"], other: true }),
    q("goals", "Goals", "long", { bind: "project.goals" }),
  ] },
  { id: "brand", title: "Brand kit", heading: "Their brand.", sub: "Anything you have now. It fills the company's brand kit, so a pitch deck can be made in their look.", questions: [
    q("logo", "Logo", "file", { bind: "brand.logo", help: "Up to 20 files, 25 MB each. Link videos instead." }),
    q("colors", "Colours", "colors", { bind: "brand.colors" }),
    q("heading", "Heading font", "select", { bind: "brand.heading", half: true, options: ["Not sure", "Inter", "Montserrat", "Playfair Display", "Poppins", "Oswald", "Futura", "Helvetica"], other: true }),
    q("body", "Body font", "select", { bind: "brand.body", half: true, options: ["Not sure", "Inter", "Roboto", "Lato", "Open Sans", "Source Sans", "Georgia", "Helvetica"], other: true }),
    q("links", "Reference links", "link", { bind: "brand.links", multiple: true, help: "Their site, socials, or videos they like." }),
    q("tone", "Tone words", "multi", { bind: "brand.tone", options: ["Energetic", "Warm", "Premium", "Playful", "Cinematic", "Community", "Bold"], other: true }),
  ] },
  { id: "pricing", title: "Pricing", heading: "Price it.", sub: "Prices are suggested from Settings › Pricing. Type a different number on any line to override it.", fixed: "pricing", questions: [
    q("days", "Shoot days", "number", { bind: "pricing.days", required: true }),
    q("level", "Editing level", "select", { bind: "pricing.level", help: "From Settings › Pricing." }),
    q("travel", "Travel (hours)", "number", { bind: "pricing.travel" }),
    q("model", "Pricing model", "select", { bind: "pricing.model", half: true, options: PRICING_MODELS }),
    q("schedule", "Payment schedule", "select", { bind: "pricing.schedule", half: true, options: ["Deposit, then balance on delivery", "Deposit, then monthly", "In full on delivery"], other: true }),
    q("deposit", "Deposit", "deposit", { bind: "pricing.deposit" }),
  ] },
  { id: "timeline", title: "Timeline", heading: "When?", sub: "Rough dates are fine. They become the Timeline section.", questions: [
    q("start", "Start", "date", { bind: "timeline.start" }),
    q("shoot", "Shoot dates", "daterange", { bind: "timeline.shoot" }),
    q("delivery", "Delivery", "date", { bind: "timeline.delivery" }),
    q("milestones", "Milestones", "milestones", { bind: "timeline.milestones" }),
  ] },
  { id: "resources", title: "Resources", heading: "Who and what?", sub: "Crew, gear, places and people on camera.", questions: [
    q("crew", "Crew", "multi", { bind: "resources.crew", options: ["Director", "Shooter", "Second shooter", "Drone pilot", "Sound", "Editor", "Colourist", "Production assistant"], other: true }),
    q("gear", "Gear", "multi", { bind: "resources.gear", options: ["Cinema camera", "Second camera", "Gimbal", "Drone", "Lighting kit", "Audio kit", "Teleprompter"], other: true }),
    q("locations", "Locations", "short", { bind: "resources.locations", half: true }),
    q("map", "Map or site link", "link", { bind: "resources.map", half: true }),
    q("talent", "Talent and people on camera", "long", { bind: "resources.talent" }),
  ] },
  { id: "special", title: "Special items", heading: "Anything special?", sub: "Add-ons, usage rights and anything else Claude should know.", questions: [
    q("addons", "Add-ons", "addons", { bind: "special.addons", help: "Each one adds a line under Investment, priced from Settings › Pricing.", options: ["Extra revision round", "Rush delivery", "Raw footage hand-off", "Captions on every cut", "Licensed music"] }),
    q("rights", "Usage rights", "select", { bind: "special.rights", options: ["Online and social, worldwide, no time limit", "Online and social, 1 year", "Broadcast and online", "Internal use only"], other: true }),
    q("notes", "Anything else", "long", { bind: "special.notes" }),
  ] },
] };

const clip = (s: unknown, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : "");
const TYPES = new Set<QType>(Object.keys(TYPE_LABEL) as QType[]);

/** A questionnaire as saved: checked and trimmed. Client and Pricing stay (and their locked questions). */
export function cleanQuestionnaire(x: unknown): Questionnaire {
  const steps = (x as Questionnaire)?.steps;
  if (!Array.isArray(steps) || !steps.length || steps.length > 12) throw new Error("A questionnaire has 1 to 12 steps.");
  const seen = new Set<string>();
  const qIds = new Set<string>(["__lines"]); // ids are answer keys: unique across the whole questionnaire
  const out: Step[] = steps.map((s, i) => {
    const qs = Array.isArray(s?.questions) ? s.questions : [];
    if (qs.length > 20) throw new Error(`"${clip(s?.title, 40)}" has more than 20 questions.`);
    const id = clip(s?.id, 40) || `s${i}`;
    if (seen.has(id)) throw new Error("Two steps share an id.");
    seen.add(id);
    return {
      id, title: clip(s.title, 40) || `Step ${i + 1}`, heading: clip(s.heading, 120) || clip(s.title, 40) || `Step ${i + 1}`, sub: clip(s.sub, 300),
      ...(s.fixed === "client" || s.fixed === "pricing" ? { fixed: s.fixed } : {}),
      questions: qs.map((qq, j) => {
        const bind = clip(qq?.bind, 40);
        const type: QType = LOCKED_TYPE[bind] ?? (TYPES.has(qq?.type) ? qq.type : "short");
        let qid = (clip(qq?.id, 40) || `q${j}`).replace(/^_+/, "q");
        while (qIds.has(qid)) qid = `${qid}_`;
        qIds.add(qid);
        const options = Array.isArray(qq.options) ? qq.options.map((o: unknown) => clip(o, 80)).filter(Boolean).slice(0, 30) : undefined;
        return {
          id: qid, label: clip(qq.label, 120) || "Question", type, ...(clip(qq.help, 300) ? { help: clip(qq.help, 300) } : {}), ...(qq.required ? { required: true } : {}),
          ...(options && (type === "select" || type === "multi" || type === "addons") ? { options } : {}), ...(qq.other ? { other: true } : {}), ...(qq.multiple ? { multiple: true } : {}),
          ...(clip(qq.bind, 40) ? { bind: clip(qq.bind, 40) } : {}), ...(qq.half ? { half: true } : {}),
        } as Question;
      }),
    };
  });
  for (const f of ["client", "pricing"] as const) if (!out.some((s) => s.fixed === f)) throw new Error(`The ${f === "client" ? "Client" : "Pricing"} step can't be removed: a proposal needs it.`);
  const binds = out.flatMap((s) => s.questions.map((qq) => qq.bind)).filter(Boolean) as string[];
  for (const b of LOCKED_BINDS) if (!binds.includes(b)) throw new Error("The client and pricing questions can't be removed.");
  return { steps: out };
}

// ---------- answers ----------

export type ClientAnswer = { mode: "existing" | "new"; key?: string; clientId?: string; dealId?: string; company: string; website?: string; name: string; email: string; phone?: string; saveAs?: "lead" | "company" };
export type FileAnswer = { fileId: string; name: string; size: number; type: string };
export type PLine = { id: string; description: string; qty: number; unitCents: number; suggestedCents?: number; note?: string; auto?: string };
export type Answers = Record<string, unknown> & { __lines?: PLine[] };

/** The answer to the question bound to `bind` (wherever the business moved it). */
export function bound(qn: Questionnaire, a: Answers, bind: string): unknown {
  for (const s of qn.steps) for (const qq of s.questions) if (qq.bind === bind) return a[qq.id];
  return undefined;
}
const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: unknown) => (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "");

/** One answer as words (what Review, the waiting page and Claude read). */
export function answerText(qq: Question, v: unknown): string {
  if (v === undefined || v === null || v === "") return "";
  switch (qq.type) {
    case "client": { const c = v as ClientAnswer; return [c.company, c.name, c.email].filter(Boolean).join(" · ") + (c.mode === "new" ? (c.saveAs === "company" ? " (new company)" : " (new lead)") : ""); }
    case "multi": case "addons": return Array.isArray(v) ? (v as string[]).join(", ") : String(v);
    case "link": return Array.isArray(v) ? (v as string[]).filter(Boolean).join(", ") : String(v);
    case "file": return Array.isArray(v) ? (v as FileAnswer[]).map((f) => f.name).join(", ") : "";
    case "colors": return Array.isArray(v) ? (v as string[]).join(" · ") : "";
    case "date": return day(v);
    case "daterange": { const r = v as { start?: string; end?: string }; return [day(r?.start), day(r?.end)].filter(Boolean).join(" – "); }
    case "milestones": return Array.isArray(v) ? (v as Array<{ name: string; date?: string }>).filter((m) => m.name).map((m) => `${m.name}${m.date ? ` (${day(m.date)})` : ""}`).join("; ") : "";
    case "money": return typeof v === "number" ? usd(v) : "";
    case "deposit": { const d = v as { kind: "percent" | "amount"; value: number }; return d ? (d.kind === "percent" ? `${d.value}%` : usd(d.value)) : ""; }
    default: return String(v).trim();
  }
}

/** Every answered question, step by step, as label and words. */
export function answerList(qn: Questionnaire, a: Answers) {
  return qn.steps.map((s) => ({ step: s.title, answers: s.questions.map((qq) => ({ question: qq.label, answer: answerText(qq, a[qq.id]) })).filter((x) => x.answer) })).filter((s) => s.answers.length);
}

/** Lines' total and the deposit (a % of it, or an amount up to it). */
export function linesTotal(lines: PLine[] | undefined, dep: { kind: "percent" | "amount"; value: number } | undefined) {
  const total = (lines ?? []).reduce((t, l) => t + Math.round(l.qty * l.unitCents), 0);
  const deposit = !dep ? 0 : dep.kind === "percent" ? Math.round((total * Math.max(0, Math.min(100, dep.value))) / 100) : Math.min(Math.max(0, Math.round(dep.value)), total);
  return { total, deposit, depositPct: total > 0 ? Math.round((deposit / total) * 10000) / 100 : 0 };
}

/** "Fill in myself": the answers placed into the standard sections as a plain outline, with the priced lines under
 *  Investment and the deposit in Payment terms. The client, project and date are fill-in fields. */
export function outlineFromAnswers(qn: Questionnaire, a: Answers): Page {
  const t = (b: string) => { const v = bound(qn, a, b); const qq = qn.steps.flatMap((s) => s.questions).find((x) => x.bind === b); return qq ? answerText(qq, v) : ""; };
  const list = (b: string) => { const v = bound(qn, a, b); return Array.isArray(v) ? (v as string[]).filter((x) => typeof x === "string" && x.trim()) : []; };
  const h = (s: string) => line(s, { size: "heading" });
  const para = (s: string) => s.split(/\n+/).map((x) => x.trim()).filter(Boolean).map((x) => line(x));
  const c: PNode[] = [line("{project}", { size: "title" }), line("A proposal for {client.company} · prepared {date}", { size: "subtitle" })];
  const type = t("project.type");
  c.push(h("Overview"), ...(para(t("project.goals")).length ? para(t("project.goals")) : [line(type ? `${type} for {client.company}.` : "What the client wants and why it matters to them.")]));
  c.push(h("Scope"), ...(para(t("project.scope")).length ? para(t("project.scope")) : [line("What you'll do: who's there, which days, where.")]));
  const res = [["Crew", list("resources.crew").join(", ")], ["Gear", list("resources.gear").join(", ")], ["Locations", t("resources.locations")], ["On camera", t("resources.talent")]].filter(([, v]) => v);
  if (res.length) c.push(bulletList(res.map(([k, v]) => `${k}: ${v}`)));
  const del = list("project.deliverables");
  c.push(h("Deliverables"), del.length ? bulletList(del) : line("What they get: the films, cuts and formats."));
  const tl = [["Start", t("timeline.start")], ["Shoot", t("timeline.shoot")], ["Delivery", t("timeline.delivery")]].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  const ms = bound(qn, a, "timeline.milestones");
  if (Array.isArray(ms)) for (const m of ms as Array<{ name: string; date?: string }>) if (m?.name) tl.push(`${m.name}${m.date ? `: ${day(m.date)}` : ""}`);
  c.push(h("Timeline"), tl.length ? bulletList(tl) : line("Shoot dates, first cut, final delivery."));
  const lines = a.__lines ?? [];
  c.push(h("Investment"), atom("items", { rows: lines.length ? lines.map((l) => ({ id: newId(), description: l.description, qty: l.qty, rate: l.unitCents / 100 })) : [{ id: newId(), description: "", qty: 1, rate: 0 }] }));
  const dep = bound(qn, a, "pricing.deposit") as { kind: "percent" | "amount"; value: number } | undefined;
  const pct = linesTotal(lines, dep ?? { kind: "percent", value: 50 }).depositPct;
  const sched = t("pricing.schedule");
  const extra = [t("pricing.model") ? `Priced as: ${t("pricing.model")}.` : "", sched ? `${sched}.` : "", t("special.rights") ? `Usage rights: ${t("special.rights")}.` : ""].filter(Boolean).join(" ");
  c.push(h("Payment terms"), section([line(`A {deposit.percent} deposit of {deposit} books the dates; the balance of {balance} is due on delivery.${extra ? ` ${extra}` : ""} The contract follows once you accept.`), atom("payment", { depositPct: pct, invoiceDeposit: false, initials: false })]));
  c.push(h("About us"), line("{business.name} makes films for brands and events."));
  c.push(h("Next steps"), line("Press Accept on the proposal page, or reply with questions."));
  return { type: "doc", content: c };
}
