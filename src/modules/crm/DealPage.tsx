// A pipeline card's page. A website lead is P3 / Owner / Lead (265:2749): what they sent, and next steps (New
// estimate, Add follow-up, Not a lead). Every other card uses the same layout with its company, estimates, project and
// history (build addition, no frame: the board's cards need somewhere to open). Back office only.
import { Fragment, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, ButtonLink, Card, Divider, EmptyState, ListRow, SectionHead, SkeletonRows, StatusChip } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { dateShort, money } from "../payments/common";
import { AddFollowUp, FollowUpRow, STAGES, type Stage } from "./common";

const when = (t: number) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function DealPage({ dealId }: { dealId: string }) {
  const d = useQuery(api.crm.deal, { dealId });
  const move = useMutation(api.crm.moveDeal);
  const close = useMutation(api.crm.closeDeal);
  const link = useMutation(api.crm.linkProject);
  const [toast, show] = useToast();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const top = <TopBar><a {...linkProps("/clients")}>Clients</a><Sep /><a {...linkProps("/clients/pipeline")}>Pipeline</a>{d && <><Sep /><span className="here">{d.company?.name ?? d.lead?.company ?? d.title}</span></>}</TopBar>;
  if (d === undefined) return <>{top}<div className="wp-page"><Card label="Loading"><SkeletonRows n={4} /></Card></div></>;
  if (d === null) return <>{top}<div className="wp-page"><EmptyState icon="activity" title="This card isn't here." body="It may have been taken off the board." actions={<ButtonLink to="/clients/pipeline">Pipeline</ButtonLink>} /></div></>;
  const id = d._id as Id<"deals">;
  const name = d.company?.name ?? d.lead?.company ?? d.lead?.name ?? d.title;
  const web = d.source === "website";
  const newEstimate = `/clients/estimates/new?deal=${id}${d.projectId ? `&project=${d.projectId}` : ""}`;
  const notLead = async () => {
    setBusy(true);
    try { await close({ dealId: id, reason: web ? "Not a lead" : "Taken off the board" }); show("Taken off the board."); navigate("/clients/pipeline"); } catch (e) { show(errText(e)); setBusy(false); }
  };
  return (
    <>
      {top}
      <div className="wp-page crm-deal">
        <a className="wp-setback" {...linkProps("/clients/pipeline")}><Icon name="arrow-left" size={20} />Pipeline</a>
        <header className="wp-pagehead">
          <div className="txt">
            <span className="wp-eyebrow">{d.stageName}</span>
            <h1 className="wp-h2">{name}.</h1>
            <p className="wp-body">{web && d.lead ? `Came in from the website form · ${when(d.lead.at)}` : `${d.title} · added ${dateShort(d.createdAt)}`}</p>
          </div>
          <div className="acts crm-tags">
            {web && <span className="wp-tag">From the website</span>}
            {d.closedAt ? <StatusChip tone="neutral">Off the board</StatusChip> : <StatusChip tone="neutral">{d.stageName}</StatusChip>}
          </div>
        </header>
        <div className="crm-two">
          <div className="col">
            {d.lead && (
              <Card label="What they sent" head={<SectionHead label="What they sent" />}>
                <dl className="crm-dl">
                  <dt>Name</dt><dd>{d.lead.name}</dd>
                  <dt>Email</dt><dd><a href={`mailto:${d.lead.email}`}>{d.lead.email}</a></dd>
                  {d.lead.phone && <><dt>Phone</dt><dd>{d.lead.phone}</dd></>}
                  {d.lead.company && <><dt>Company</dt><dd>{d.lead.company}</dd></>}
                  {d.lead.message && <><dt>What they need</dt><dd className="long">{d.lead.message}</dd></>}
                  {d.lead.fields.map((f, i) => <Fragment key={i}><dt>{f.label}</dt><dd>{f.value}</dd></Fragment>)}
                </dl>
              </Card>
            )}
            <Card label="Estimates" head={<SectionHead label="Estimates" count={d.estimates.length} action={<ButtonLink size="sm" variant="ghost" icon="plus" to={newEstimate}>New estimate</ButtonLink>} />}>
              {d.estimates.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "invoice" }} title="No estimate yet. Saving one moves the card to Quoted." />
                : d.estimates.map((e, i) => <div key={e._id} className="wp-rowwrap">{i > 0 && <Divider />}<ListRow className="ilead" lead={{ icon: "invoice" }} to={`/clients/estimates/${e._id}`} title={e.title} meta={`${money(e.priceCents)} · saved ${dateShort(e.updatedAt)}`} chevron /></div>)}
            </Card>
            <Card label="History" head={<SectionHead label="History" />}>
              {[...d.history].reverse().slice(0, 12).map((h, i) => (
                <div key={i} className="wp-rowwrap">{i > 0 && <Divider />}
                  <ListRow className="ilead" lead={{ icon: "activity" }} title={h.detail ? `${STAGES.find((s) => s.key === h.kind)?.name ?? (h.kind === "moved" ? "Moved" : h.kind === "created" ? "Added" : h.kind === "closed" ? "Taken off the board" : h.kind === "website" ? "From the website" : h.kind)} · ${h.detail}` : (STAGES.find((s) => s.key === h.kind)?.name ?? (h.kind === "created" ? "Added" : h.kind === "website" ? "From the website" : h.kind))}
                    meta={`${when(h.at)}${h.by ? ` · ${h.by}` : ""}`} />
                </div>
              ))}
            </Card>
          </div>
          <div className="col right">
            {!d.closedAt && (
              <Card label="Next steps" head={<SectionHead label="Next steps" />}>
                <div className="crm-steps">
                  <ButtonLink variant="primary" to={newEstimate}>New estimate</ButtonLink>
                  <ButtonLink to={`/payments/quotes/new?${d.clientId ? `client=${d.clientId}` : `deal=${id}`}`}>Quick quote</ButtonLink>
                  <Button onClick={() => setAdding(true)}>Add follow-up</Button>
                  <button type="button" className="btn ghost" disabled={busy} onClick={() => void notLead()}>{web && d.stage === "lead" ? "Not a lead" : "Take off the board"}</button>
                  <p className="wp-small">{web && d.stage === "lead" ? "Not a lead archives the card. Spam is filtered before a card is made." : "The card is kept, just off the board."}</p>
                </div>
              </Card>
            )}
            <Card label="Stage" head={<SectionHead label="Stage" />}>
              <div className="crm-steps">
                <label className="wp-field"><span className="wp-field-label">Move to</span>
                  <select className="input" value={d.stage} onChange={(e) => void move({ dealId: id, stage: e.target.value as Stage }).then(() => show("Moved."), (er) => show(errText(er)))}>
                    {STAGES.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
                  </select>
                </label>
                <label className="wp-field"><span className="wp-field-label">Project</span>
                  <select className="input" value={d.projectId ?? ""} onChange={(e) => void link({ dealId: id, projectId: (e.target.value || null) as Id<"projects"> | null }).then(() => show(e.target.value ? "Linked to the project." : "Unlinked."), (er) => show(errText(er)))}>
                    <option value="">No project yet</option>
                    {d.projects.map((p) => <option key={p._id} value={p._id}>{p.label}</option>)}
                  </select>
                </label>
                <p className="wp-small">The card moves on its own when the contract is sent and signed, the project moves into production, final files go out and the final invoice is paid. It only ever moves forward.</p>
              </div>
            </Card>
            <Card label="Follow-ups" head={<SectionHead label="Follow-ups" count={d.followUps.length} action={<Button size="sm" variant="ghost" icon="plus" onClick={() => setAdding(true)}>Add</Button>} />}>
              {d.followUps.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "bell" }} title="None set." /> : d.followUps.map((f, i) => <div key={f._id} className="wp-rowwrap">{i > 0 && <Divider />}<FollowUpRow f={f} show={show} /></div>)}
            </Card>
            {(d.company || d.lead) && (
              <Card label="Contact" head={<SectionHead label="Contact" />}>
                {d.company ? <ListRow className="ilead" lead={{ icon: "users" }} to={`/clients/${d.company._id}`} title={d.company.name} meta={d.contactEmail ?? "Company"} chevron />
                  : <p className="crm-note">{d.lead!.name}{d.lead!.company ? ` and ${d.lead!.company} are` : " is"} added to Companies when you make the first estimate.</p>}
              </Card>
            )}
          </div>
        </div>
      </div>
      {adding && <AddFollowUp onClose={() => setAdding(false)} show={show} eyebrow={name} who={d.lead?.name ?? ""} email={d.contactEmail ?? d.lead?.email ?? null} clientId={d.clientId ?? null} dealId={id} about={d.title} />}
      {toast}
    </>
  );
}
