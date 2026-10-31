// Phase 3b · Proposals: the standard sections a blank proposal starts with (S5 · Phase 3b 716:4980: Cover · Overview ·
// Scope · Deliverables · Timeline · Investment · Payment terms · About us · Next steps), what must be there before one
// is sent, and the prices a proposal template leaves out ("Prices are not saved in templates", 718:4840).
import {
  atom, line, missingFields, newId, nodesOf, section, sectionTitle, textOf, totals, type BuildDoc, type ItemRow, type Page, type PNode,
} from "./wsBuilder";

export const PROPOSAL_SECTIONS = ["Overview", "Scope", "Deliverables", "Timeline", "Investment", "Payment terms", "About us", "Next steps"] as const;

/** A blank proposal: the cover lines, then each standard section with a line saying what goes there. */
export function proposalStarterPage(): Page {
  const say: Record<(typeof PROPOSAL_SECTIONS)[number], string> = {
    Overview: "What the client wants and why it matters to them.",
    Scope: "What you'll do: who's there, which days, where.",
    Deliverables: "What they get: the films, cuts and formats.",
    Timeline: "Shoot dates, first cut, final delivery.",
    Investment: "",
    "Payment terms": "A {deposit.percent} deposit of {deposit} books the dates; the balance of {balance} is due on delivery. The contract follows once you accept.",
    "About us": "{business.name} makes films for brands and events.",
    "Next steps": "Press Accept on the proposal page, or reply with questions.",
  };
  const content: PNode[] = [
    line("{project}", { size: "title" }),
    line("A proposal for {client.company} · prepared {date}", { size: "subtitle" }),
  ];
  for (const h of PROPOSAL_SECTIONS) {
    content.push(line(h, { size: "heading" }));
    if (h === "Investment") content.push(atom("items", { rows: [{ id: newId(), description: "", qty: 1, rate: 0 }] }));
    else if (h === "Payment terms") content.push(section([line(say[h]), atom("payment", { depositPct: 50, invoiceDeposit: false, initials: false })]));
    else content.push(line(say[h]));
  }
  return { type: "doc", content };
}

/** How many sections a proposal or template has (its headings). */
const isHeading = (n: PNode | undefined) => n?.type === "paragraph" && n.attrs?.size === "heading";
export const sectionCount = (page: Page) => (page.content ?? []).filter((n) => isHeading(n) || (n.type === "section" && isHeading((n.content ?? [])[0]) && !!sectionTitle(n))).length;

/** A template keeps the line descriptions and quantities, never the prices (they come from Settings › Pricing). */
export function withoutPrices(page: Page): Page {
  const fix = (n: PNode): PNode => n.type === "items" ? { ...n, attrs: { ...n.attrs, rows: ((n.attrs?.rows as ItemRow[]) ?? []).map((r) => ({ ...r, rate: 0 })) } } : n.content ? { ...n, content: n.content.map(fix) } : n;
  return fix(page as PNode) as Page;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** What must be right before a proposal is sent (the builder's Details list, and the server's own check). */
export function proposalProblems(d: BuildDoc): string[] {
  const out: string[] = [];
  if (!d.title.trim()) out.push("Give the proposal a title (Details).");
  if (!textOf(d.page as PNode).trim()) out.push("Add some content.");
  if (!d.fields.client.name.trim()) out.push("Enter the client's name (Details).");
  if (!EMAIL.test(d.fields.client.email.trim())) out.push("Enter the client's email (Details): the proposal link goes there.");
  if (nodesOf(d.page, "signatures").length) out.push("Proposals aren't signed: remove the signature block (the contract follows once it's accepted).");
  if (/\bPICK ONE:/.test(textOf(d.page as PNode))) out.push('Resolve the "PICK ONE" note.');
  const miss = missingFields(d.page, d.fields);
  if (miss.length) out.push(`Fill in: ${miss.map((m) => `{${m}}`).join(", ")}.`);
  if (totals(d.page).total <= 0) out.push("Add the Investment: line items with a price.");
  return out;
}
