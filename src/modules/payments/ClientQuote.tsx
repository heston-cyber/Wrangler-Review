// Phase 3b · the client's quote page, /q/<token> (722:7998 open, 722:8207 accepting, 722:8420 accepted, 722:8622 declined,
// 722:8819 expired, 722:9015 void, 722:9209 Juniper & Ash, 723:8343 decline dialog). No account needed (D81). Accept
// with your typed name, or Decline (D80); the portal records the name, time, IP and device through its own endpoint,
// the same way signing does. The line under the button is D83's.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button, Card, DialogHeader, EmptyState, SkeletonRows, StatusChip, TextArea } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal } from "../../ui/kit";
import { CONVEX_SITE } from "../docs/lib/client";
import { money } from "./common";
import { Banner, Frame } from "./ClientInvoice";
import { downloadPdf } from "./pdfDownload";
import { QuotePaper, depositLabel, longIso, longMs, quotePdf, type QuoteDoc } from "./QuotePaper";

async function respond(body: { token: string; action: "accept" | "decline"; name: string; reason?: string }): Promise<{ ok?: boolean; error?: string }> {
  try {
    const r = await fetch(`${CONVEX_SITE}/q-respond`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return (await r.json()) as { ok?: boolean; error?: string };
  } catch { return { error: "Couldn't reach the server. Check your connection and try again." }; }
}

export default function ClientQuote({ token }: { token: string }) {
  const q = useQuery(api.quotes.page, { token });
  const viewed = useMutation(api.quotes.markViewed);
  const once = useRef(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<null | "accept" | "decline">(null);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  useEffect(() => { if (q && !once.current) { once.current = true; void viewed({ token }).catch(() => undefined); } }, [q, token, viewed]);
  if (q === undefined) return <Frame inShell={false} bar={null}><Card label="Loading"><SkeletonRows n={5} /></Card></Frame>;
  if (q === null) return <Frame inShell={false} bar={null}><EmptyState icon="invoice" title="This quote link doesn't work." body="It may have been mistyped. Open the link in the email again, or reply to that email." /></Frame>;
  const biz = q.business.name || "the business";
  const doc: QuoteDoc = { business: q.business, number: q.number, issued: longMs(q.issued), validUntil: longIso(q.validUntil), contact: q.contact, project: q.project, lines: q.lines, totals: q.totals, taxPercent: q.taxPercent, deposit: q.deposit, terms: q.terms, acceptUrl: null };
  const go = async (action: "accept" | "decline") => {
    setBusy(action); setError(null);
    const r = await respond({ token, action, name: action === "accept" ? name : name || q.contact.name, ...(action === "decline" && reason.trim() ? { reason } : {}) });
    setBusy(null);
    if (r.error) setError(r.error); else setDeclining(false);
  };
  const s = q.status;
  const chip = s === "sent" ? <StatusChip tone="accent">Open</StatusChip> : s === "accepted" ? <StatusChip tone="success">Accepted</StatusChip> : s === "declined" ? <StatusChip tone="danger">Declined</StatusChip> : s === "void" ? <StatusChip tone="neutral">Withdrawn</StatusChip> : <StatusChip tone="neutral">Expired</StatusChip>;
  return (
    <Frame inShell={false} bar={null} brand={{ name: q.business.name, logoUrl: q.business.logoUrl }}>
      <div className="q-public-top"><span className="wp-small">Quote from {biz}</span><span className="sp" /><button type="button" className="btn sm" onClick={() => void downloadPdf(quotePdf(doc))}>Download PDF</button></div>
      <header className="wp-pagehead inv-head">
        <div className="txt"><span className="wp-eyebrow">Quote · {q.number}</span><h1 className="wp-h2">{q.title.replace(/\.$/, "")}.</h1>
          <p className="wp-body">For {[q.contact.name, q.contact.company].filter(Boolean).join(", ")} · valid until {longIso(q.validUntil)}</p></div>
        {chip}
      </header>
      <div className="q-cols">
        <div className="col"><QuotePaper q={doc} showAccept={false} /></div>
        <div className="col right">
          <section className="inv-pay" aria-label="Accept this quote">
            <span className="wp-eyebrow">{s === "sent" ? "Accept this quote" : "This quote"}</span>
            <dl className="crm-dl q-sum">
              <dt className="big">Total</dt><dd className="big">{money(q.totals.total)}</dd>
              <dt>{depositLabel(q.deposit)}</dt><dd>{money(q.totals.deposit)}</dd>
            </dl>
            {s === "sent" && <>
              <label className="wp-field"><span className="wp-field-label">Your full name</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Type your name" autoComplete="name" /></label>
              <p className="wp-small">By accepting, you agree to the scope and price above. This isn't a contract; {biz} will send one to sign.</p>
              {error && <p className="error" role="alert">{error}</p>}
              <Button variant="primary" className="q-big" loading={busy === "accept"} disabled={!!busy || name.trim().length < 2} onClick={() => void go("accept")}>Accept quote</Button>
              <button type="button" className="btn ghost q-big" disabled={!!busy} onClick={() => setDeclining(true)}>Decline</button>
              <p className="wp-small">No account needed. {biz} sends the next steps once you accept. Your name, the time and your device are recorded.</p>
            </>}
            {s === "accepted" && q.response && <Banner tone="success" icon="check-circle" title={`Accepted by ${q.response.name} · ${longMs(q.response.at)}`} text={`Thank you. ${biz} will send the next steps.`} />}
            {s === "declined" && q.response && <Banner tone="neutral" icon="info" title={`Declined · ${longMs(q.response.at)}`} text={`${biz} has been told. If you change your mind, reply to their email.`} />}
            {s === "expired" && <Banner tone="neutral" icon="clock" title={`This quote expired on ${longIso(q.validUntil)}.`} text={`Ask ${biz} for a new one.`} />}
            {s === "void" && <Banner tone="neutral" icon="info" title="This quote was withdrawn." text={`${biz} may send you a new one.`} />}
          </section>
        </div>
      </div>
      {declining && (
        <Modal onClose={() => setDeclining(false)} label="Decline this quote" width={480}>
          <div className="crm-dialog">
            <DialogHeader eyebrow={q.number} title="Decline this quote?" body={`${biz} will be told. You can add a reason if you like.`} onClose={() => setDeclining(false)} />
            <TextArea label="Reason (optional)" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. We've gone another way for now." />
            {error && <p className="error" role="alert">{error}</p>}
            <div className="dfoot">
              <button className="btn ghost" type="button" onClick={() => setDeclining(false)}>Keep it open</button>
              <Button variant="primary" loading={busy === "decline"} onClick={() => void go("decline")}><Icon name="close" size={14} />Decline quote</Button>
            </div>
          </div>
        </Modal>
      )}
    </Frame>
  );
}
