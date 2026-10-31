// Makes the invoice or receipt PDF in the browser (pdf.tsx loads only when asked) and saves it.
import type { PdfData } from "./pdf";
export type { PdfData };

export async function downloadPdf(d: PdfData) {
  const { invoicePdfBlob } = await import("./pdf");
  const blob = await invoicePdfBlob(d);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${d.number || (d.kind === "quote" ? "Quote" : "Invoice")}${d.kind === "receipt" ? " receipt" : ""}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const long = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const longIso = (iso: string) => long(Date.parse(`${iso}T12:00:00`));

/** The PDF's data from what the invoice pages already have. */
export function pdfData(kind: "invoice" | "receipt", i: {
  business: { name: string; legalName: string | null; email?: string | null; logoLightUrl?: string | null; address?: string | null; privacyUrl?: string | null } | null;
  number: string | null; sentAt: number | null; createdAt?: number; dueDate: string; billTo: { name: string; email: string; company?: string }; project: string | null;
  lines: PdfData["lines"]; discountCents: number; taxPercent: number; totalCents: number; amountPaidCents: number; memo: string; paidAt: number | null;
  payments: Array<{ at: number; method: string; cents: number; status: string }>; payUrl: string | null;
}): PdfData {
  const paid = i.payments.filter((p) => p.status === "paid");
  const last = paid[paid.length - 1];
  return {
    kind, business: { name: i.business?.name ?? "", legalName: i.business?.legalName ?? null, email: i.business?.email ?? null, logoLightUrl: i.business?.logoLightUrl ?? null, address: i.business?.address ?? null, privacyUrl: i.business?.privacyUrl ?? null },
    number: i.number ?? "", issued: long(i.sentAt ?? i.createdAt ?? Date.now()), due: longIso(i.dueDate),
    paidOn: i.paidAt ? long(i.paidAt) : last ? long(last.at) : null, method: last?.method ?? null,
    billTo: i.billTo, project: i.project, lines: i.lines, discountCents: i.discountCents, taxPercent: i.taxPercent,
    totalCents: i.totalCents, amountPaidCents: i.amountPaidCents, memo: i.memo || null, payUrl: i.payUrl,
    payments: i.payments.filter((p) => p.status !== "failed").map((p) => ({ at: long(p.at), method: p.status === "processing" ? `${p.method} · processing` : p.method, cents: p.cents })),
    thanks: kind === "receipt" ? (i.billTo.name.trim() ? `Thank you, ${i.billTo.name.trim().split(/\s+/)[0]}.` : "Thank you.") : null,
  };
}
