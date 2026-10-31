// Phase 3b · Proposals, the owner's side (D69: its own sidebar item): All proposals (710:1588), New proposal (710:2955:
// from a template, the questionnaire, or blank, plus the drafts) and Proposal templates (718:4840), kept apart from
// contract templates. A proposal itself opens in the builder (ProposalBuilder → Builder in proposal mode). The
// questionnaire and "Draft with Claude" arrive in Step 4.
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, ButtonLink, Card, Divider, EmptyState, IconButton, ListRow, PageHeader, PillTabs, SectionHead, SkeletonRows } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Menu, MenuItem, useConfirm, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { dateShort, money } from "../payments/common";
import Builder, { ProposalChip } from "../docs/builder/Builder";
import { ProposalWaiting, QuestionnaireRunner } from "./Questionnaire";

type Status = "draft" | "waiting" | "ready" | "sent" | "accepted" | "declined" | "void";
const updatedWord = (t: number) => {
  const d = new Date(t), now = new Date();
  if (d.toDateString() === now.toDateString()) return `today ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  if (new Date(now.getTime() - 86_400_000).toDateString() === d.toDateString()) return "yesterday";
  return dateShort(t);
};

// ---------- All proposals ----------

type Pill = "all" | Status;
export default function ProposalsPage() {
  const rows = useQuery(api.proposals.list, {});
  const [pill, setPill] = useState<Pill>("all");
  const n = (s: Status) => (rows ?? []).filter((r) => r.status === s).length;
  const shown = (rows ?? []).filter((r) => pill === "all" || r.status === pill);
  type Row = NonNullable<typeof rows>[number];
  const meta = (r: Row) => {
    const who = [r.company || null, r.lead ? "lead" : r.contact || null].filter(Boolean).join(" · ");
    const s = r.status as Status;
    const when = s === "accepted" && r.response ? `accepted ${dateShort(r.response.at)} by ${r.response.name}`
      : s === "declined" && r.response ? `declined ${dateShort(r.response.at)}`
      : s === "sent" ? [r.sentAt ? `sent ${dateShort(r.sentAt)}` : null, r.viewedAt ? `viewed ${dateShort(r.viewedAt)}` : null].filter(Boolean).join(" · ")
      : s === "void" ? "withdrawn" : r.filling ? "questionnaire in progress" : `updated ${updatedWord(r.updatedAt)}`;
    return [who || "No client yet", r.number, when].filter(Boolean).join(" · ");
  };
  const pills: Array<{ key: Pill; label: string; count: number }> = [
    { key: "all", label: "All", count: rows?.length ?? 0 }, { key: "draft", label: "Draft", count: n("draft") }, { key: "waiting", label: "Waiting for Claude", count: n("waiting") },
    { key: "ready", label: "Ready", count: n("ready") }, { key: "sent", label: "Sent", count: n("sent") }, { key: "accepted", label: "Accepted", count: n("accepted") },
    { key: "declined", label: "Declined", count: n("declined") }, ...(n("void") ? [{ key: "void" as Pill, label: "Withdrawn", count: n("void") }] : []),
  ];
  return (
    <>
      <TopBar><a {...linkProps("/proposals")}>Proposals</a><Sep /><span className="here">All proposals</span></TopBar>
      <div className="wp-page">
        <PageHeader eyebrow="Proposals" title="All proposals." sub="Written pitches, made in the builder. Clients read and accept them from a link." actions={<><ButtonLink to="/proposals/questionnaire">Questionnaire</ButtonLink><ButtonLink variant="primary" to="/proposals/new">New proposal</ButtonLink></>} />
        {rows === undefined ? <Card label="Loading"><SkeletonRows n={4} /></Card> : rows.length === 0 ? (
          <EmptyState icon="quote" title="No proposals yet." body="A proposal is a written pitch: scope, deliverables, timeline and the investment. Start one from a template or the standard sections; the client reads it and presses Accept, no account needed."
            actions={<ButtonLink variant="primary" to="/proposals/new">New proposal</ButtonLink>} />
        ) : (
          <>
            <PillTabs label="Show" value={pill} onChange={setPill} items={pills} />
            <Card label="Proposals" className="q-list">
              {shown.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "document" }} title="None here." /> : shown.map((r, i) => (
                <div key={r._id} className="wp-rowwrap">{i > 0 && <Divider />}
                  <ListRow className="ilead" lead={{ icon: "document" }} to={`/proposals/${r._id}`} title={r.title} meta={meta(r)}
                    trailing={money(r.totalCents)} chip={<ProposalChip status={r.status} />} chevron />
                </div>
              ))}
            </Card>
          </>
        )}
      </div>
    </>
  );
}

// ---------- New proposal ----------

export function NewProposal({ clientId, dealId }: { clientId: string | null; dealId: string | null }) {
  const templates = useQuery(api.proposals.templates, {});
  const rows = useQuery(api.proposals.list, {});
  const create = useMutation(api.proposals.create);
  const startQ = useMutation(api.proposals.startQuestionnaire);
  const drop = useMutation(api.proposals.deleteDraft);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, show] = useToast();
  const [confirm, confirmNode] = useConfirm();
  const who = { ...(clientId ? { clientId: clientId as Id<"clients"> } : {}), ...(dealId ? { dealId: dealId as Id<"deals"> } : {}) };
  const start = async (key: string, templateId?: Id<"wsTemplates">) => {
    setBusy(key);
    try { const id = await create({ ...who, ...(templateId ? { templateId } : {}) }); navigate(`/proposals/${id}`); }
    catch (e) { show(errText(e)); setBusy(null); }
  };
  const drafts = (rows ?? []).filter((r) => r.status === "draft" || r.status === "ready" || r.status === "waiting");
  const scrollToTemplates = () => document.getElementById("pr-templates")?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <>
      <TopBar><a {...linkProps("/proposals")}>Proposals</a><Sep /><span className="here">New proposal</span></TopBar>
      <div className="wp-page">
        <PageHeader title="New proposal." sub="Start from one of your templates, answer the questionnaire, or begin with a blank page." />
        <div className="pr-choose">
          <button type="button" className="pr-choice glass on" onClick={scrollToTemplates} disabled={!!busy}>
            <Icon name="folder" size={20} /><b>From a template</b><span>Pick one of your proposal templates below. Its sections come filled in.</span>
          </button>
          <button type="button" className="pr-choice glass" disabled={!!busy} onClick={async () => { setBusy("q"); try { const id = await startQ(who); navigate(`/proposals/${id}`); } catch (e) { show(errText(e)); setBusy(null); } }}>
            <Icon name="note" size={20} /><b>Questionnaire {busy === "q" && <span className="pr-wait">· opening…</span>}</b><span>Answer the questions; Claude drafts the proposal, or you fill it in yourself.</span>
          </button>
          <button type="button" className="pr-choice glass" onClick={() => void start("blank")} disabled={!!busy}>
            <Icon name="document" size={20} /><b>Blank {busy === "blank" && <span className="pr-wait">· opening…</span>}</b><span>An empty proposal with the standard sections: Cover, Overview, Scope and the rest.</span>
          </button>
        </div>

        <div id="pr-templates"><SectionHead label="Proposal templates" action={<ButtonLink variant="ghost" size="sm" to="/proposals/templates">Manage templates</ButtonLink>} /></div>
        {templates === undefined ? <SkeletonRows n={2} /> : templates.length === 0 ? (
          <p className="wp-small secondary pr-none">No proposal templates yet. Save any proposal as one from the builder (Save as proposal template), or make one in Templates.</p>
        ) : (
          <div className="pr-tgrid">
            {templates.map((t) => (
              <button key={t._id} type="button" className="pr-tcard glass" disabled={!!busy} onClick={() => void start(t._id, t._id)}>
                <Icon name="folder" size={18} /><b>{t.name}{busy === t._id && <span className="pr-wait"> · opening…</span>}</b>
                <span>{t.sections} section{t.sections === 1 ? "" : "s"} · {t.used ? `used ${t.used} time${t.used === 1 ? "" : "s"}` : "new"}</span>
              </button>
            ))}
          </div>
        )}

        {drafts.length > 0 && <>
          <SectionHead label="Drafts" count={drafts.length} />
          <Card label="Drafts" className="q-list">
            {drafts.map((r, i) => (
              <div key={r._id} className="wp-rowwrap">{i > 0 && <Divider />}
                <ListRow to={`/proposals/${r._id}`} title={r.title} meta={`${[r.company, r.lead ? "lead" : r.contact].filter(Boolean).join(" · ") || "No client yet"} · ${updatedWord(r.updatedAt)}`}
                  action={<IconButton icon="close" label={`Delete the draft ${r.title}`} onClick={async () => {
                    if (!(await confirm({ title: `Delete "${r.title}"?`, body: `The draft ${r.number} is deleted. Its number isn't reused.`, yes: "Delete", danger: true }))) return;
                    try { await drop({ proposalId: r._id }); show("Draft deleted"); } catch (e) { show(errText(e)); }
                  }} />} />
              </div>
            ))}
          </Card>
        </>}
      </div>
      {confirmNode}{toast}
    </>
  );
}

// ---------- Proposal templates ----------

export function ProposalTemplates() {
  const templates = useQuery(api.proposals.templates, {});
  const newTemplate = useMutation(api.proposals.newTemplate);
  const create = useMutation(api.proposals.create);
  const duplicate = useMutation(api.builder.duplicateTemplate);
  const remove = useMutation(api.builder.deleteTemplate);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, show] = useToast();
  const [confirm, confirmNode] = useConfirm();
  const use = async (templateId: Id<"wsTemplates">) => {
    setBusy(templateId);
    try { const id = await create({ templateId }); navigate(`/proposals/${id}`); } catch (e) { show(errText(e)); setBusy(null); }
  };
  return (
    <>
      <TopBar><a {...linkProps("/proposals")}>Proposals</a><Sep /><span className="here">Templates</span></TopBar>
      <div className="wp-page">
        <PageHeader eyebrow="Proposals" title="Proposal templates." sub="Sections and wording you reuse. Kept apart from contract templates in Docs."
          actions={<Button variant="primary" loading={busy === "new"} onClick={async () => { setBusy("new"); try { navigate(`/proposals/templates/${await newTemplate({})}`); } catch (e) { show(errText(e)); setBusy(null); } }}>New template</Button>} />
        {templates === undefined ? <Card label="Loading"><SkeletonRows n={3} /></Card> : templates.length === 0 ? (
          <EmptyState icon="folder" title="No proposal templates yet." body="Save any proposal as a template from the builder, or start one here with the standard sections." />
        ) : (
          <Card label="Proposal templates" className="q-list">
            {templates.map((t, i) => (
              <div key={t._id} className="wp-rowwrap">{i > 0 && <Divider />}
                <ListRow className="ilead" lead={{ icon: "folder" }} to={`/proposals/templates/${t._id}`} title={t.name}
                  meta={`${t.sections} section${t.sections === 1 ? "" : "s"} · ${t.used ? `used ${t.used} time${t.used === 1 ? "" : "s"}` : "new"} · edited ${updatedWord(t.updatedAt)}`}
                  action={<span className="pr-tacts">
                    <Button size="sm" variant="secondary" loading={busy === t._id} onClick={() => void use(t._id)}>Use</Button>
                    <Menu label={`More for ${t.name}`} align="end" trigger={(p) => <button type="button" className="icon-btn sm" aria-label={`More for ${t.name}`} {...p}><Icon name="more" size={18} /></button>}>
                      <MenuItem onSelect={async () => { try { await duplicate({ templateId: t._id }); show("Duplicated"); } catch (e) { show(errText(e)); } }}>Duplicate</MenuItem>
                      <MenuItem danger onSelect={async () => {
                        if (!(await confirm({ title: `Delete "${t.name}"?`, body: "Proposals made from it keep their own copy.", yes: "Delete", danger: true }))) return;
                        try { await remove({ templateId: t._id }); show("Template deleted"); } catch (e) { show(errText(e)); }
                      }}>Delete</MenuItem>
                    </Menu>
                  </span>} />
              </div>
            ))}
          </Card>
        )}
        <Card label="Save as a proposal template" className="pr-info">
          <div className="pr-infobody"><span className="wp-eyebrow">Save as a proposal template</span>
            <p className="wp-small">Any proposal can become a template from the builder (Save as proposal template). Prices are not saved in templates; they come from Settings › Pricing each time.</p></div>
        </Card>
      </div>
      {confirmNode}{toast}
    </>
  );
}

// ---------- a proposal, in the builder ----------

export function ProposalBuilder({ proposalId }: { proposalId: string }) {
  const p = useQuery(api.proposals.get, { proposalId });
  if (p === undefined) return <><TopBar><a {...linkProps("/proposals")}>Proposals</a></TopBar><div className="wp-page"><Card label="Loading"><SkeletonRows n={4} /></Card></div></>;
  if (p === null) return <><TopBar><a {...linkProps("/proposals")}>Proposals</a></TopBar><div className="wp-page"><EmptyState icon="quote" title="This proposal isn't here." body="It may have been a draft that was deleted." actions={<ButtonLink to="/proposals">All proposals</ButtonLink>} /></div></>;
  if (p.filling) return <QuestionnaireRunner key={p._id} proposalId={p._id} />;
  if (p.status === "waiting") return <ProposalWaiting p={p} />;
  return <Builder key={p.buildId} mode={{ kind: "build", buildId: p.buildId, proposal: p }} />;
}
