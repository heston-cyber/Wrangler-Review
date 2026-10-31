// Clients › Follow-ups (P3 / Owner / Follow-ups: 265:2051, phone 267:3199). Grouped Overdue · Today · This week ·
// Later; pills Open · Overdue · Today. Claude checks these each morning through the connector (D67), and can draft
// one for you to confirm. Back office only.
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button, Card, Divider, EmptyState, PageHeader, PillTabs, SectionHead, SkeletonRows } from "../../ui/wp";
import { useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps } from "../../lib/router";
import { AddFollowUp, FollowUpRow, todayLocal } from "./common";

type Pill = "open" | "overdue" | "today";

export default function FollowUps() {
  const data = useQuery(api.crm.followUps, {});
  const [toast, show] = useToast();
  const [pill, setPill] = useState<Pill>("open");
  const [adding, setAdding] = useState(false);
  const today = todayLocal(), week = todayLocal(7);
  const rows = data?.rows ?? [];
  const drafts = rows.filter((f) => f.draft);
  const live = rows.filter((f) => !f.draft);
  const groups = [
    { key: "overdue", label: "Overdue", list: live.filter((f) => f.due < today) },
    { key: "today", label: "Today", list: live.filter((f) => f.due === today) },
    { key: "week", label: "This week", list: live.filter((f) => f.due > today && f.due <= week) },
    { key: "later", label: "Later", list: live.filter((f) => f.due > week) },
  ].filter((g) => g.list.length && (pill === "open" || g.key === pill));
  return (
    <>
      <TopBar><a {...linkProps("/clients")}>Clients</a><Sep /><span className="here">Follow-ups</span></TopBar>
      <div className="wp-page crm-fu">
        <PageHeader eyebrow="Clients" title="Follow-ups." sub="Who to get back to, and when. Claude checks these each morning." actions={<Button variant="primary" onClick={() => setAdding(true)}>Add follow-up</Button>} />
        {data === undefined ? <Card label="Loading"><SkeletonRows n={4} /></Card> : (
          <>
            <PillTabs label="Show" value={pill} onChange={setPill} items={[
              { key: "open", label: "Open", count: live.length }, { key: "overdue", label: "Overdue", count: live.filter((f) => f.due < today).length },
              { key: "today", label: "Today", count: live.filter((f) => f.due === today).length },
            ]} />
            {drafts.length > 0 && (
              <Card label="Drafted by Claude" head={<SectionHead label="Drafted by Claude" count={drafts.length} />}>
                {drafts.map((f, i) => <div key={f._id} className="wp-rowwrap">{i > 0 && <Divider />}<FollowUpRow f={f} show={show} context={f.company} /></div>)}
              </Card>
            )}
            {groups.length === 0 ? (
              <EmptyState icon="bell" title={pill === "open" ? "No follow-ups." : pill === "overdue" ? "Nothing overdue." : "Nothing due today."}
                body="Add one from a lead, a company or a contact, or here." actions={pill === "open" ? <Button variant="primary" onClick={() => setAdding(true)}>Add follow-up</Button> : undefined} />
            ) : groups.map((g) => (
              <Card key={g.key} label={g.label} head={<SectionHead label={g.label} count={g.list.length} />}>
                {g.list.map((f, i) => <div key={f._id} className="wp-rowwrap">{i > 0 && <Divider />}<FollowUpRow f={f} show={show} context={f.company} /></div>)}
              </Card>
            ))}
          </>
        )}
      </div>
      {adding && <AddFollowUp onClose={() => setAdding(false)} show={show} />}
      {toast}
    </>
  );
}
