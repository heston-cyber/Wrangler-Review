// Contact (P3 / Owner / Contact: 262:32958). One person at a company: follow-ups, what they've seen in their Inbox,
// details and the company's money (billed, paid, outstanding). Back office only.
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button, ButtonLink, Card, Divider, EmptyState, ListRow, SectionHead, SkeletonRows } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps } from "../../lib/router";
import { dateShort, money } from "../payments/common";
import { AddFollowUp, FollowUpRow } from "./common";

const ROLE = { signer: "Signs documents", contact: "Contact" } as const;

export default function ContactPage({ personId }: { personId: string }) {
  const c = useQuery(api.crm.contact, { personId });
  const [toast, show] = useToast();
  const [adding, setAdding] = useState(false);
  const top = <TopBar><a {...linkProps("/clients")}>Clients</a><Sep /><a {...linkProps("/clients")}>Companies</a>{c?.company && <><Sep /><a {...linkProps(`/clients/${c.company._id}`)}>{c.company.name}</a></>}{c && <><Sep /><span className="here">{c.name}</span></>}</TopBar>;
  if (c === undefined) return <>{top}<div className="wp-page"><Card label="Loading"><SkeletonRows n={4} /></Card></div></>;
  if (c === null) return <>{top}<div className="wp-page"><EmptyState icon="user" title="This person isn't here." actions={<ButtonLink to="/clients">Companies</ButtonLink>} /></div></>;
  const access = c.access.state === "active" ? `portal access Active since ${dateShort(c.access.since)}` : c.access.state === "invited" ? `invited to the portal ${dateShort(c.access.at)}` : "not invited to the portal";
  return (
    <>
      {top}
      <div className="wp-page crm-contact">
        {c.company && <a className="wp-setback" {...linkProps(`/clients/${c.company._id}`)}><Icon name="arrow-left" size={20} />{c.company.name}</a>}
        <header className="wp-pagehead">
          <div className="txt">
            <span className="wp-eyebrow">Contact{c.company ? ` · ${c.company.name}` : ""}</span>
            <h1 className="wp-h2">{c.name.replace(/\.$/, "")}.</h1>
            <p className="wp-body">{ROLE[c.role]} · {access}</p>
          </div>
          <div className="acts">
            <a className="btn" href={`mailto:${c.email}`}>Email</a>
            <Button variant="primary" onClick={() => setAdding(true)}>Add follow-up</Button>
          </div>
        </header>
        <div className="crm-two">
          <div className="col">
            <Card label="Follow-ups" head={<SectionHead label="Follow-ups" count={c.followUps.length} />}>
              {c.followUps.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "bell" }} title="None set." /> : c.followUps.map((f, i) => <div key={f._id} className="wp-rowwrap">{i > 0 && <Divider />}<FollowUpRow f={f} show={show} /></div>)}
            </Card>
            {c.deals.length > 0 && (
              <Card label="Deals" head={<SectionHead label="Deals" count={c.deals.length} />}>
                {c.deals.map((d, i) => <div key={d._id} className="wp-rowwrap">{i > 0 && <Divider />}<ListRow className="ilead" lead={{ icon: "activity" }} to={`/clients/deals/${d._id}`} title={d.title} meta={d.stageName} chevron /></div>)}
              </Card>
            )}
            <Card label="Activity" head={<SectionHead label="Activity" count={c.activity.length} />}>
              {c.activity.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "inbox" }} title="Nothing in their Inbox yet." />
                : c.activity.map((a, i) => <div key={i} className="wp-rowwrap">{i > 0 && <Divider />}<ListRow className="ilead" lead={{ icon: a.read ? "eye" : "inbox" }} title={a.read ? `Read “${a.title}”` : a.title} meta={`${dateShort(a.at)}${a.read ? "" : " · not read yet"}`} /></div>)}
            </Card>
          </div>
          <div className="col right">
            <Card label="Details" head={<SectionHead label="Details" />}>
              <dl className="crm-dl">
                <dt>Email</dt><dd><a href={`mailto:${c.email}`}>{c.email}</a></dd>
                {c.company && <><dt>Company</dt><dd><a {...linkProps(`/clients/${c.company._id}`)}>{c.company.name}</a></dd></>}
                <dt>Role</dt><dd>{ROLE[c.role]}</dd>
                <dt>Portal</dt><dd>{c.access.state === "active" ? `Active · since ${dateShort(c.access.since)}` : c.access.state === "invited" ? `Invited ${dateShort(c.access.at)}` : "Not invited"}</dd>
              </dl>
            </Card>
            <Card label="Money" head={<SectionHead label="Money" />}>
              <dl className="crm-dl">
                <dt>Billed</dt><dd>{money(c.billedCents)}</dd>
                <dt>Paid</dt><dd>{money(c.paidCents)}</dd>
                <dt className="big">Outstanding</dt><dd className="big">{money(c.outstandingCents)}</dd>
              </dl>
              {c.company && <p className="crm-note">Totals are for {c.company.name}, the company {c.name.split(" ")[0]} belongs to.</p>}
            </Card>
          </div>
        </div>
      </div>
      {adding && <AddFollowUp onClose={() => setAdding(false)} show={show} eyebrow={c.company?.name ?? null} who={c.name} email={c.email} clientId={c.company?._id ?? null} />}
      {toast}
    </>
  );
}
