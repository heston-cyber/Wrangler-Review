// Phase 3b · the client's proposal page, /p/<token> (723:7952 open, 723:8151 accepted). No account needed (D73). The
// proposal is shown as the PDF that was sent (drawn page by page with pdf.js, like the signing page), with the
// Investment and the deposit beside it. Accept with your typed name, or Decline (D86); the portal records the name,
// time, IP and device through its own endpoint, the same way quotes and signing do. The line under the name is D83's.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button, Card, DialogHeader, EmptyState, SkeletonRows, StatusChip, TextArea } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal } from "../../ui/kit";
import { CONVEX_SITE } from "../docs/lib/client";
import { openPdf, renderPage, type PdfDoc } from "../docs/lib/pdf";
import { money } from "../payments/common";
import { Banner, Frame } from "../payments/ClientInvoice";

async function respond(body: { token: string; action: "accept" | "decline"; name: string; reason?: string }): Promise<{ ok?: boolean; error?: string }> {
  try {
    const r = await fetch(`${CONVEX_SITE}/p-respond`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return (await r.json()) as { ok?: boolean; error?: string };
  } catch { return { error: "Couldn't reach the server. Check your connection and try again." }; }
}
const longMs = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** The sent PDF, every page drawn to the column's width. */
function PdfPages({ url, title }: { url: string; title: string }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    let live = true;
    openPdf(url).then((d) => live && setPdf(d), () => live && setFailed(true));
    return () => { live = false; };
  }, [url]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth)));
    ro.observe(el); setWidth(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, []);
  return (
    <div className="pr-pages" ref={box} aria-label={title}>
      {failed ? <p className="wp-small">The proposal couldn't be shown here. <a href={url} target="_blank" rel="noopener noreferrer">Open the PDF</a>.</p>
        : !pdf || !width ? <Card label="Loading"><SkeletonRows n={6} /></Card>
        : Array.from({ length: pdf.numPages as number }, (_, i) => <PdfPage key={`${i}-${width}`} pdf={pdf} index={i} width={width} />)}
    </div>
  );
}
function PdfPage({ pdf, index, width }: { pdf: PdfDoc; index: number; width: number }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => { if (canvas.current) void renderPage(pdf, index, canvas.current, width).catch(() => undefined); }, [pdf, index, width]);
  return <canvas ref={canvas} className="pr-page" role="img" aria-label={`Page ${index + 1}`} />;
}

export default function ClientProposal({ token }: { token: string }) {
  const p = useQuery(api.proposals.page, { token });
  const viewed = useMutation(api.proposals.markViewed);
  const once = useRef(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<null | "accept" | "decline">(null);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  useEffect(() => { if (p && !once.current) { once.current = true; void viewed({ token }).catch(() => undefined); } }, [p, token, viewed]);
  if (p === undefined) return <Frame inShell={false} bar={null}><Card label="Loading"><SkeletonRows n={5} /></Card></Frame>;
  if (p === null) return <Frame inShell={false} bar={null}><EmptyState icon="lock" title="This link doesn't work any more." body="It may have been mistyped or replaced by a newer version. Open the link in the email again, or reply to that email to ask for it." /></Frame>;
  const biz = p.business.name || "the business";
  const go = async (action: "accept" | "decline") => {
    setBusy(action); setError(null);
    const r = await respond({ token, action, name: action === "accept" ? name : name || p.contact.name, ...(action === "decline" && reason.trim() ? { reason } : {}) });
    setBusy(null);
    if (r.error) setError(r.error); else setDeclining(false);
  };
  const s = p.status;
  const chip = s === "sent" ? <StatusChip tone="accent">Open</StatusChip> : s === "accepted" ? <StatusChip tone="success">Accepted</StatusChip> : s === "declined" ? <StatusChip tone="danger">Declined</StatusChip> : <StatusChip tone="neutral">Withdrawn</StatusChip>;
  const first = p.contact.name.split(" ")[0];
  return (
    <Frame inShell={false} bar={null} brand={{ name: p.business.name, logoUrl: p.business.logoUrl }}>
      <div className="q-public-top"><span className="wp-small">Proposal from {biz}</span><span className="sp" />
        {p.pdfUrl && <a className="btn sm" href={p.pdfUrl} target="_blank" rel="noopener noreferrer" download={`${p.number} ${p.title}.pdf`}>Download PDF</a>}</div>
      <header className="wp-pagehead inv-head">
        <div className="txt"><span className="wp-eyebrow">Proposal · {p.number}</span><h1 className="wp-h2">{p.title.replace(/\.$/, "")}.</h1>
          <p className="wp-body">For {[p.contact.name, p.contact.company].filter(Boolean).join(", ")} · sent {longMs(p.sentAt)}</p></div>
        {chip}
      </header>
      <div className="q-cols">
        <div className="col">{p.pdfUrl ? <PdfPages url={p.pdfUrl} title={p.title} /> : <p className="wp-small">The PDF isn't available.</p>}</div>
        <div className="col right">
          <section className="inv-pay" aria-label={s === "sent" ? "Accept this proposal" : "Status"}>
            <span className="wp-eyebrow">{s === "sent" ? "Accept this proposal" : "Status"}</span>
            {s === "accepted" && p.response && <Banner tone="success" icon="check-circle" title={`Accepted by ${p.response.name} · ${longMs(p.response.at)}`} text={`Thank you, ${first}. ${biz} will send the contract to sign next.`} />}
            {s === "declined" && p.response && <Banner tone="neutral" icon="info" title={`Declined · ${longMs(p.response.at)}`} text={`${biz} has been told. If you change your mind, reply to their email.`} />}
            {s === "void" && <Banner tone="neutral" icon="info" title="This proposal was withdrawn." text={`${biz} may send you a new one.`} />}
            <dl className="crm-dl q-sum">
              <dt className="big">Investment</dt><dd className="big">{money(p.totalCents)}</dd>
              {s === "sent" && p.depositCents > 0 && <><dt>Deposit to book ({p.depositPct}%)</dt><dd>{money(p.depositCents)}</dd></>}
            </dl>
            {s === "sent" && <>
              <label className="wp-field"><span className="wp-field-label">Your full name</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Type your name" autoComplete="name" /></label>
              <p className="wp-small">By accepting, you agree to the scope and price above. This isn't a contract; {biz} will send one to sign.</p>
              {error && <p className="error" role="alert">{error}</p>}
              <Button variant="primary" className="q-big" loading={busy === "accept"} disabled={!!busy || name.trim().length < 2} onClick={() => void go("accept")}>Accept proposal</Button>
              <button type="button" className="btn ghost q-big" disabled={!!busy} onClick={() => setDeclining(true)}>Decline</button>
              <p className="wp-small">Questions? Reply to the email; it goes to {p.fromName || biz}. No account needed. Your name, the time and your device are recorded.</p>
            </>}
          </section>
        </div>
      </div>
      {declining && (
        <Modal onClose={() => setDeclining(false)} label="Decline this proposal" width={480}>
          <div className="crm-dialog">
            <DialogHeader eyebrow={p.number} title="Decline this proposal?" body={`${biz} will be told. You can add a reason if you like.`} onClose={() => setDeclining(false)} />
            <TextArea label="Reason (optional)" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. We've gone another way for now." />
            {error && <p className="error" role="alert">{error}</p>}
            <div className="dfoot">
              <button className="btn ghost" type="button" onClick={() => setDeclining(false)}>Keep it open</button>
              <Button variant="primary" loading={busy === "decline"} onClick={() => void go("decline")}><Icon name="close" size={14} />Decline proposal</Button>
            </div>
          </div>
        </Modal>
      )}
    </Frame>
  );
}
