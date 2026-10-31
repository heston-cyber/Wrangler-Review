// Phase 3b: the quote document (S5 · Phase 3b, "quote document" in 719:7567 / 720:7076 / 722:7998): the invoice paper's
// layout titled QUOTE, with For, Issued, Valid until, Project, the lines, Subtotal · Discount · Tax · Total and the
// Deposit to book, then the terms and the "Accept online" link. The PDF (721:7878) is made from the same numbers.
import { BrandImg } from "../../ui/BrandImg";
import { money, type Line } from "./common";
import type { PdfData } from "./pdfDownload";

export type QuoteDoc = {
  business: { name: string; legalName: string | null; logoUrl?: string | null; logoLightUrl?: string | null; email?: string | null; address?: string | null; privacyUrl?: string | null };
  number: string; issued: string; validUntil: string; contact: { name: string; email: string; company?: string }; project?: string | null;
  lines: Line[]; totals: { subtotal: number; discount: number; tax: number; total: number; deposit: number };
  taxPercent?: number; deposit: { kind: "percent" | "amount"; value: number }; terms?: string | null; acceptUrl?: string | null;
};

export const depositLabel = (d: QuoteDoc["deposit"]) => (d.kind === "percent" ? `Deposit to book (${Math.round(d.value * 100) / 100}%)` : "Deposit to book");

export function QuotePaper({ q, showAccept = true }: { q: QuoteDoc; showAccept?: boolean }) {
  const b = q.business;
  const legal = b.legalName && b.legalName !== b.name ? `a DBA of ${b.legalName.replace(/^.*?,?\s*a DBA of\s*/i, "")}` : null;
  return (
    <article className="inv-paper">
      <header className="inv-top">
        <div className="who"><span className="logo">{b.logoUrl ? <img src={b.logoUrl} alt="" /> : <BrandImg name="wordmark" alt="" />}</span><span><b>{b.name}</b>{legal && <small>{legal}</small>}</span></div>
        <div className="num"><span>Quote</span><b>{q.number}</b></div>
      </header>
      <dl className="inv-meta">
        <div className="bill"><dt>For</dt><dd>{q.contact.name || "—"}{q.contact.company && <><br />{q.contact.company}</>}{q.contact.email && <><br />{q.contact.email}</>}</dd></div>
        <div><dt>Issued</dt><dd>{q.issued}</dd></div>
        <div><dt>Valid until</dt><dd>{q.validUntil}</dd></div>
        {q.project && <div className="proj"><dt>Project</dt><dd>{q.project}</dd></div>}
      </dl>
      <table className="inv-lines">
        <thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead>
        <tbody>{q.lines.length ? q.lines.map((l) => <tr key={l.id}><td>{l.description || <span className="secondary">Line item</span>}</td><td>{l.qty}</td><td>{money(l.unitCents)}</td><td>{money(Math.round(l.qty * l.unitCents))}</td></tr>) : <tr><td colSpan={4} className="secondary">No lines yet.</td></tr>}</tbody>
      </table>
      <dl className="inv-sums">
        <dt>Subtotal</dt><dd>{money(q.totals.subtotal)}</dd>
        <dt>Discount</dt><dd>{q.totals.discount ? `−${money(q.totals.discount)}` : "—"}</dd>
        <dt>Tax</dt><dd>{q.totals.tax ? `${money(q.totals.tax)} (${q.taxPercent}%)` : "—"}</dd>
        <dt className="tot">Total</dt><dd className="tot">{money(q.totals.total)}</dd>
        <dt>{depositLabel(q.deposit)}</dt><dd>{money(q.totals.deposit)}</dd>
      </dl>
      <footer className="inv-foot">
        {q.terms && <p className="memo">{q.terms}</p>}
        {showAccept && <p className="q-accept"><span aria-hidden>▣</span> Accept online: {q.acceptUrl ? <a href={q.acceptUrl}>{q.acceptUrl.replace(/^https?:\/\//, "")}</a> : `${location.host}/q/{token}`}</p>}
        <p className="legal">{[`${b.name}${legal ? `, ${legal}` : ""}`, b.email, b.address].filter(Boolean).join(" · ")}{b.privacyUrl && <> · <a href={b.privacyUrl} target="_blank" rel="noopener noreferrer">Privacy policy</a></>}</p>
      </footer>
    </article>
  );
}

/** The quote PDF's data (the invoice PDF in its quote form). */
export function quotePdf(q: QuoteDoc): PdfData {
  return {
    kind: "quote", business: { name: q.business.name, legalName: q.business.legalName, email: q.business.email ?? null, logoLightUrl: q.business.logoLightUrl ?? null, address: q.business.address ?? null, privacyUrl: q.business.privacyUrl ?? null },
    number: q.number, issued: q.issued, due: q.validUntil, billTo: q.contact, project: q.project ?? null, lines: q.lines,
    discountCents: q.totals.discount, taxPercent: q.taxPercent, totalCents: q.totals.total, amountPaidCents: 0, memo: q.terms ?? null, payUrl: null,
    quote: { validUntil: q.validUntil, depositLabel: depositLabel(q.deposit), depositCents: q.totals.deposit, acceptUrl: q.acceptUrl ?? null },
  };
}
export const longIso = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
export const longMs = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
