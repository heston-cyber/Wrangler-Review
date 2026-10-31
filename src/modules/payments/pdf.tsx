// Phase 2 Part B, step 4: the portal's own invoice and receipt PDFs (frames 234:6547 / 234:6626 invoice, 234:6705 /
// 234:6792 receipt; light, for printing). Made in the browser with @react-pdf/renderer from the same numbers the page
// shows (which are Stripe's), so nothing is uploaded or stored. US Letter for US English browsers, A4 elsewhere.
import { Document, Image, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";
import { totals, type Line } from "./common";

export type PdfData = {
  kind: "invoice" | "receipt" | "quote"; // Phase 3b: a quote in the invoice layout (721:7878), titled QUOTE
  business: { name: string; legalName: string | null; email: string | null; logoLightUrl: string | null; address?: string | null; privacyUrl?: string | null };
  number: string; issued: string; due: string; paidOn?: string | null; method?: string | null;
  billTo: { name: string; email: string; company?: string }; project?: string | null;
  lines: Line[]; discountCents?: number; taxPercent?: number; totalCents: number; amountPaidCents: number;
  memo?: string | null; payUrl?: string | null;
  payments?: Array<{ at: string; method: string; cents: number }>;
  thanks?: string | null; // the receipt's last line
  quote?: { validUntil: string; depositLabel: string; depositCents: number; acceptUrl: string | null };
};

const INK = "#1a1817", MUTED = "#6b6862", FAINT = "#9a968f", RULE = "#d9d5cc", ACCENT = "#e00000", PAPER = "#f5f3ee";
const s = StyleSheet.create({
  page: { backgroundColor: PAPER, color: INK, fontFamily: "Helvetica", fontSize: 10, paddingTop: 44, paddingHorizontal: 48, paddingBottom: 72 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: INK },
  who: { flexDirection: "row", alignItems: "center", gap: 12 },
  dot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: ACCENT },
  logo: { height: 22, objectFit: "contain" },
  bizName: { fontSize: 12 },
  legal: { fontSize: 7.5, color: MUTED, letterSpacing: 0.8, marginTop: 3, textTransform: "uppercase" },
  kindBox: { alignItems: "flex-end" },
  kind: { fontSize: 8, color: ACCENT, letterSpacing: 1, textTransform: "uppercase" },
  num: { fontSize: 12, marginTop: 4 },
  paidTag: { fontSize: 7.5, color: MUTED, letterSpacing: 0.8, marginTop: 4, textTransform: "uppercase" },
  meta: { flexDirection: "row", justifyContent: "space-between", marginTop: 22, marginBottom: 20 },
  lbl: { fontSize: 7.5, color: MUTED, letterSpacing: 0.8, textTransform: "uppercase" },
  billLines: { marginTop: 6, gap: 3, fontSize: 10.5 },
  facts: { width: 240, gap: 8, marginTop: 14 },
  fact: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  th: { flexDirection: "row", paddingBottom: 7, borderBottomWidth: 0.75, borderBottomColor: RULE },
  tr: { flexDirection: "row", paddingVertical: 10, borderBottomWidth: 0.75, borderBottomColor: RULE },
  cDesc: { flex: 1, paddingRight: 12 }, cQty: { width: 40, textAlign: "right" }, cUnit: { width: 80, textAlign: "right" }, cAmt: { width: 80, textAlign: "right" },
  sums: { marginLeft: "auto", width: 240, marginTop: 12, gap: 7 },
  sum: { flexDirection: "row", justifyContent: "space-between" },
  sumMuted: { color: MUTED },
  tot: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingTop: 9, borderTopWidth: 0.75, borderTopColor: RULE },
  big: { fontFamily: "Helvetica-Bold", fontSize: 13 },
  pays: { marginTop: 20, paddingBottom: 8, borderBottomWidth: 0.75, borderBottomColor: RULE },
  payRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 7 },
  memo: { marginTop: 22, fontSize: 10.5, lineHeight: 1.45 },
  payUrl: { marginTop: 6, color: MUTED },
  foot: { position: "absolute", left: 48, right: 48, bottom: 30, paddingTop: 10, borderTopWidth: 0.75, borderTopColor: RULE, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: MUTED },
});

const usd = (c: number) => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const legalLine = (b: PdfData["business"]) => (b.legalName && b.legalName !== b.name ? `a DBA of ${b.legalName.replace(/^.*?a DBA of\s*/i, "")}` : null);

export function InvoicePdf({ d, size }: { d: PdfData; size: "LETTER" | "A4" }) {
  const t = totals({ lines: d.lines, discountCents: d.discountCents, taxPercent: d.taxPercent });
  const remaining = Math.max(0, d.totalCents - d.amountPaidCents);
  const receipt = d.kind === "receipt";
  const quote = d.kind === "quote" ? d.quote ?? null : null;
  const legal = legalLine(d.business);
  return (
    <Document title={`${quote ? "Quote" : receipt ? "Receipt" : "Invoice"} ${d.number}`} author={d.business.name} creator="WranglerPortal" producer="WranglerPortal">
      <Page size={size} style={s.page}>
        <View style={s.head}>
          <View style={s.who}>
            {d.business.logoLightUrl ? <Image src={d.business.logoLightUrl} style={s.logo} /> : <><View style={s.dot} /><Image src="/brand/wp-mark-ink.png" style={s.logo} /></>}
            <View><Text style={s.bizName}>{d.business.name}</Text>{legal && <Text style={s.legal}>{legal}</Text>}</View>
          </View>
          <View style={s.kindBox}>
            <Text style={s.kind}>{quote ? "Quote" : receipt ? "Receipt" : "Invoice"}</Text>
            <Text style={s.num}>{d.number}</Text>
            {receipt && <Text style={s.paidTag}>{remaining === 0 ? "Paid in full" : "Payment received"}</Text>}
          </View>
        </View>

        <View style={s.meta}>
          <View>
            <Text style={s.lbl}>{quote ? "For" : "Bill to"}</Text>
            <View style={s.billLines}>
              <Text>{d.billTo.name}</Text>
              {d.billTo.company ? <Text>{d.billTo.company}</Text> : null}
              <Text>{d.billTo.email}</Text>
            </View>
          </View>
          <View style={s.facts}>
            {receipt ? <>
              <View style={s.fact}><Text style={s.lbl}>Paid</Text><Text>{d.paidOn ?? ""}</Text></View>
              {d.method ? <View style={s.fact}><Text style={s.lbl}>Method</Text><Text>{d.method}</Text></View> : null}
            </> : <>
              <View style={s.fact}><Text style={s.lbl}>Issued</Text><Text>{d.issued}</Text></View>
              <View style={s.fact}><Text style={s.lbl}>{quote ? "Valid until" : "Due"}</Text><Text>{quote ? quote.validUntil : d.due}</Text></View>
            </>}
            {d.project ? <View style={s.fact}><Text style={s.lbl}>Project</Text><Text>{d.project}</Text></View> : null}
          </View>
        </View>

        <View style={s.th} fixed>
          <Text style={[s.lbl, s.cDesc]}>Description</Text><Text style={[s.lbl, s.cQty]}>Qty</Text><Text style={[s.lbl, s.cUnit]}>Unit price</Text><Text style={[s.lbl, s.cAmt]}>Amount</Text>
        </View>
        {d.lines.map((l) => (
          <View key={l.id} style={s.tr} wrap={false}>
            <Text style={s.cDesc}>{l.description}</Text><Text style={s.cQty}>{l.qty}</Text><Text style={s.cUnit}>{usd(l.unitCents)}</Text><Text style={s.cAmt}>{usd(Math.round(l.qty * l.unitCents))}</Text>
          </View>
        ))}

        <View style={s.sums} wrap={false}>
          <View style={s.sum}><Text style={s.sumMuted}>Subtotal</Text><Text>{usd(t.subtotal)}</Text></View>
          <View style={s.sum}><Text style={s.sumMuted}>Discount</Text><Text>{t.discount ? `-${usd(t.discount)}` : "—"}</Text></View>
          <View style={s.sum}><Text style={s.sumMuted}>Tax</Text><Text>{t.tax ? `${usd(t.tax)} (${d.taxPercent}%)` : "—"}</Text></View>
          <View style={s.tot}><Text>Total</Text><Text style={s.big}>{usd(d.totalCents)}</Text></View>
          {quote ? <View style={s.sum}><Text style={s.sumMuted}>{quote.depositLabel}</Text><Text>{usd(quote.depositCents)}</Text></View> : null}
          {quote ? null : <>
          <View style={s.sum}><Text style={s.sumMuted}>Amount paid</Text><Text>{d.amountPaidCents ? `- ${usd(d.amountPaidCents)}` : usd(0)}</Text></View>
          <View style={s.sum}><Text>{receipt ? "Amount remaining" : "Amount due"}</Text><Text style={s.big}>{usd(remaining)}</Text></View>
          </>}
        </View>

        {d.payments && d.payments.length > 0 && (
          <View style={s.pays} wrap={false}>
            <Text style={s.lbl}>Payments</Text>
            {d.payments.map((p, i) => <View key={i} style={s.payRow}><Text>{p.at}</Text><Text>{p.method}{"      "}{usd(p.cents)}</Text></View>)}
          </View>
        )}

        {(receipt ? d.thanks : d.memo) ? <Text style={s.memo}>{receipt ? d.thanks : d.memo}</Text> : null}
        {!receipt && !quote && d.payUrl && remaining > 0 ? <Text style={s.payUrl}>Pay online: {d.payUrl.replace(/^https?:\/\//, "")}</Text> : null}
        {quote?.acceptUrl ? <Text style={s.payUrl}>Accept online: {quote.acceptUrl.replace(/^https?:\/\//, "")}</Text> : null}

        <View style={s.foot} fixed>
          <View style={{ gap: 3 }}>
            <Text>{d.business.name}{legal ? `, ${legal}` : ""}</Text>
            {[d.business.address, d.business.email, d.business.privacyUrl ? `Privacy policy: ${d.business.privacyUrl.replace(/^https?:\/\//, "")}` : null].filter(Boolean).length ? <Text>{[d.business.address, d.business.email, d.business.privacyUrl ? `Privacy policy: ${d.business.privacyUrl.replace(/^https?:\/\//, "")}` : null].filter(Boolean).join(" · ")}</Text> : null}
            {receipt ? <Text>Payment processed by Stripe.</Text> : null}
          </View>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** US Letter for US English browsers, A4 everywhere else. */
export const pageSize = (): "LETTER" | "A4" => (/^en-US$/i.test(navigator.language || "en-US") ? "LETTER" : "A4");

export async function invoicePdfBlob(d: PdfData) {
  return pdf(<InvoicePdf d={d} size={pageSize()} />).toBlob();
}
