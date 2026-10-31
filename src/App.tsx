import { useConvexAuth, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import { useLocation } from "./lib/router";
import SignIn, { SystemPage } from "./shell/SignIn";
import { Button } from "./ui/wp";
import ClientHome from "./modules/clients/ClientHome";
import ClientInbox from "./modules/clients/ClientInbox";
import ClientDocuments, { type DocTab } from "./modules/clients/ClientDocuments";
import ClientReview from "./modules/clients/ClientReview";
import ClientProject, { type ClientProjectTab } from "./modules/projects/ClientProject";
import ClientSettings from "./modules/clients/ClientSettings";
import Home from "./modules/review/Home";
import OwnerHome from "./modules/home/OwnerHome";
import ClientsPage from "./modules/clients/ClientsPage";
import ClientPage, { type ClientTab } from "./modules/clients/ClientPage";
import PostNote from "./modules/sent/PostNote";
import SentPage, { SentNote } from "./modules/sent/SentPage";
import Projects from "./modules/review/Projects";
import ProjectPage, { type ProjectTab } from "./modules/projects/ProjectPage";
import ActivityPage from "./modules/review/ActivityPage";
import Settings from "./modules/settings/Settings";
import VideoPage from "./modules/review/VideoPage";
import SharePage from "./modules/review/SharePage";
import { lazy, Suspense } from "react";
import { MorePage, Shell } from "./shell/Shell";
import { UploadProvider } from "./shell/UploadDialog";
import type { Id } from "../convex/_generated/dataModel";

// Payments (Phase 2 Part B): its own chunk.
const InvoicesPage = lazy(() => import("./modules/payments/InvoicesPage"));
const InvoiceEditor = lazy(() => import("./modules/payments/InvoiceEditor"));
const InvoiceDetail = lazy(() => import("./modules/payments/InvoiceDetail"));
const PaymentsOverview = lazy(() => import("./modules/payments/PaymentsOverview"));
const PlansPage = lazy(() => import("./modules/payments/PlansPage"));
// Phase 3: the CRM (Clients › Pipeline · Companies · Follow-ups), estimates and contacts.
const Pipeline = lazy(() => import("./modules/crm/Pipeline"));
const DealPage = lazy(() => import("./modules/crm/DealPage"));
const FollowUps = lazy(() => import("./modules/crm/FollowUps"));
const EstimatePage = lazy(() => import("./modules/crm/EstimatePage"));
const ContactPage = lazy(() => import("./modules/crm/ContactPage"));
const SubscriptionsPage = lazy(() => import("./modules/payments/SubscriptionsPage"));
const StartSubscription = lazy(() => import("./modules/payments/SubscriptionsPage").then((m) => ({ default: m.StartSubscription })));
const SubscriptionDetail = lazy(() => import("./modules/payments/SubscriptionsPage").then((m) => ({ default: m.SubscriptionDetail })));
const ClientSubscription = lazy(() => import("./modules/payments/ClientSubscription"));
const ClientSubscriptions = lazy(() => import("./modules/payments/ClientSubscription").then((m) => ({ default: m.ClientSubscriptions })));
const PlanEditor = lazy(() => import("./modules/payments/PlansPage").then((m) => ({ default: m.PlanEditor })));
const ClientInvoice = lazy(() => import("./modules/payments/ClientInvoice"));
const ClientInvoices = lazy(() => import("./modules/payments/ClientInvoices"));
// Wrangler Sign (S1): its own chunk, so pdf.js only loads on those pages.
const SignHome = lazy(() => import("./modules/docs/pages/SignHome"));
const SignDocs = lazy(() => import("./modules/docs/pages/SignDocs"));
const SignNew = lazy(() => import("./modules/docs/pages/SignNew"));
const SignTemplates = lazy(() => import("./modules/docs/pages/SignTemplates"));
const Builder = lazy(() => import("./modules/docs/builder/Builder"));
const SignDoc = lazy(() => import("./modules/docs/pages/SignDoc"));
const SignSignature = lazy(() => import("./modules/docs/pages/SignSignature"));
// S2: the client's signing page. sign.wranglerportal.com/<token>, or /x/<token> on any host (a fallback).
const SignerApp = lazy(() => import("./modules/docs/signer/SignerApp"));
const VerifyPage = lazy(() => import("./modules/docs/signer/VerifyPage"));
// Dev only: the component page (never part of the live build).
const KIT_ON = import.meta.env.DEV || import.meta.env.VITE_KIT === "1";
const Kit = KIT_ON ? lazy(() => import("./dev/Kit")) : null;
const KitApp = KIT_ON ? lazy(() => import("./dev/KitApp")) : null;
// ?kit=owner or ?kit=client: the real pages with sample data (dev only); ?kit=off ends it.
function kitSide(): "owner" | "client" | null {
  if (!KIT_ON) return null;
  try {
    const q = new URLSearchParams(location.search).get("kit");
    if (q === "owner" || q === "client") sessionStorage.setItem("wr.kit", q);
    if (q === "off") sessionStorage.removeItem("wr.kit");
    const s = sessionStorage.getItem("wr.kit");
    return s === "owner" || s === "client" ? s : null;
  } catch { return null; }
}
const isSignHost = () => /^sign\./i.test(location.hostname);

const Loading = () => <div className="signin"><span className="label">Loading…</span></div>;

export default function App() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { path, search } = useLocation();
  if (/^(www\.)?wranglerportal\.com$/i.test(location.hostname)) return <HoldingPage />;
  if (Kit && path.startsWith("/__kit")) return <Suspense fallback={<Loading />}><Kit /></Suspense>;
  const kit = kitSide();
  if (KitApp && kit) {
    const sh = /^\/s\/([^/]+)(?:\/v\/([^/]+))?\/?$/.exec(path);
    const inv = /^\/i\/([A-Za-z0-9_-]{16,64})\/?$/.exec(path);
    if (inv) {
      const page = (inShell: boolean) => <Suspense fallback={<Loading />}><ClientInvoice token={inv[1]} inShell={inShell} /></Suspense>;
      return <Suspense fallback={<Loading />}><KitApp side={kit}>{new URLSearchParams(search).has("out") ? page(false) : <ShareForMember video={false} page={page} />}</KitApp></Suspense>;
    }
    return <Suspense fallback={<Loading />}><KitApp side={kit}>{sh ? <ShareForMember video={!!sh[2]} page={(inShell) => <SharePage inShell={inShell} token={sh[1]} videoId={(sh[2] as Id<"videos"> | undefined) ?? null} versionNumber={null} noteId={null} />} /> : <SignedIn />}</KitApp></Suspense>;
  }
  const signer = (isSignHost() ? /^\/(?:x\/)?([A-Za-z0-9_-]{16,64})\/?$/ : /^\/x\/([A-Za-z0-9_-]{16,64})\/?$/).exec(path);
  if ((isSignHost() && /^\/verify\/?$/.test(path)) || /^\/x\/verify\/?$/.test(path)) return <Suspense fallback={<Loading />}><VerifyPage /></Suspense>;
  if (signer) return <Suspense fallback={<Loading />}><SignerApp key={signer[1]} token={signer[1]} /></Suspense>;
  if (isSignHost()) return <SignHostHome />;
  // A share link (C3) works signed in or out; the page decides what the link shows.
  const share = /^\/s\/([^/]+)(?:\/v\/([^/]+))?\/?$/.exec(path);
  if (share) {
    if (isLoading) return <Loading />;
    const params = new URLSearchParams(search);
    const page = (inShell: boolean) => <SharePage key={share[1]} inShell={inShell} token={share[1]} videoId={(share[2] as Id<"videos"> | undefined) ?? null} versionNumber={Number(params.get("version")) || null} noteId={params.get("note")} />;
    return isAuthenticated ? <ShareForMember video={!!share[2]} page={page} /> : page(false);
  }
  // Phase 2b: a subscription link (email 13's "Add payment method") works signed in or out too.
  const subLink = /^\/sub\/([A-Za-z0-9_-]{16,64})\/?$/.exec(path);
  if (subLink) {
    if (isLoading) return <Loading />;
    const page = (inShell: boolean) => <Suspense fallback={<Loading />}><ClientSubscription key={subLink[1]} token={subLink[1]} inShell={inShell} /></Suspense>;
    return isAuthenticated ? <ShareForMember video={false} page={page} /> : page(false);
  }
  // An invoice link (Part B step 3, the "View and pay" button in email 08) works signed in or out too.
  const invoice = /^\/i\/([A-Za-z0-9_-]{16,64})\/?$/.exec(path);
  if (invoice) {
    if (isLoading) return <Loading />;
    const page = (inShell: boolean) => <Suspense fallback={<Loading />}><ClientInvoice key={invoice[1]} token={invoice[1]} inShell={inShell} /></Suspense>;
    return isAuthenticated ? <ShareForMember video={false} page={page} /> : page(false);
  }
  if (isLoading) return <Loading />;
  if (!isAuthenticated) return <SignIn invitedEmail={new URLSearchParams(location.search).get("invited")} />;
  return <SignedIn />;
}

function SignedIn() {
  const me = useQuery(api.users.me);
  const { signOut } = useAuthActions();
  const { path, search } = useLocation();
  const signer = (isSignHost() ? /^\/(?:x\/)?([A-Za-z0-9_-]{16,64})\/?$/ : /^\/x\/([A-Za-z0-9_-]{16,64})\/?$/).exec(path);
  if ((isSignHost() && /^\/verify\/?$/.test(path)) || /^\/x\/verify\/?$/.test(path)) return <Suspense fallback={<Loading />}><VerifyPage /></Suspense>;
  if (signer) return <Suspense fallback={<Loading />}><SignerApp key={signer[1]} token={signer[1]} /></Suspense>;
  if (isSignHost()) return <SignHostHome />;
  if (me === undefined) return <Loading />;
  // Clients (C1): their own page, nothing of the owner's side.
  if (me && !me.allowed && me.role === "client") {
    return (
      <ClientShell me={me} />
    );
  }
  if (!me || !me.allowed) {
    return (
      <SystemPage icon="lock" eyebrow="Wrangler Review" title="Not allowed." body="This account isn't on Wrangler Review's list.">
        <Button style={{ alignSelf: "flex-start" }} onClick={() => void signOut()}>Sign out</Button>
      </SystemPage>
    );
  }
  const params = new URLSearchParams(search);
  const video = /^\/v\/([^/]+)\/?$/.exec(path);
  const project = /^\/projects\/([^/]+)\/?$/.exec(path);
  const signDoc = /^\/sign\/d\/([^/]+)\/?$/.exec(path);
  const clientRec = /^\/clients\/([^/]+)\/?$/.exec(path);
  const sentNote = /^\/sent\/([^/]+)\/?$/.exec(path);
  let page: React.ReactNode;
  if (video) page = <VideoPage key={video[1]} videoId={video[1] as Id<"videos">} versionNumber={Number(params.get("version")) || null} noteId={params.get("note")} />;
  else if (project) { const t = params.get("tab"); page = <Suspense fallback={<Loading />}><ProjectPage key={project[1]} projectId={project[1] as Id<"projects">} tab={(["cuts", "documents", "invoices", "delivery", "ledger"].includes(t ?? "") ? t : "overview") as ProjectTab} /></Suspense>; }
  else if (path.startsWith("/projects")) page = <Projects key="all" />;
  else if (/^\/payments\/invoices\/new\/?$/.test(path)) page = <Suspense fallback={<Loading />}><InvoiceEditor key={search} clientId={params.get("client")} projectId={params.get("project")} /></Suspense>;
  else if (/^\/payments\/invoices\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3]; page = <Suspense fallback={<Loading />}><InvoiceDetail key={id} invoiceId={id} /></Suspense>; }
  else if (/^\/payments\/invoices\/?$/.test(path)) page = <Suspense fallback={<Loading />}><InvoicesPage key={search} /></Suspense>;
  else if (/^\/payments\/?$/.test(path)) page = <Suspense fallback={<Loading />}><PaymentsOverview /></Suspense>;
  else if (/^\/payments\/subscriptions\/?$/.test(path)) page = <Suspense fallback={<Loading />}><SubscriptionsPage /></Suspense>;
  else if (/^\/payments\/subscriptions\/new\/?$/.test(path)) page = <Suspense fallback={<Loading />}><StartSubscription key={search} clientId={params.get("client")} /></Suspense>;
  else if (/^\/payments\/subscriptions\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3]; page = <Suspense fallback={<Loading />}><SubscriptionDetail key={id} subscriptionId={id} /></Suspense>; }
  else if (/^\/payments\/plans\/?$/.test(path)) page = <Suspense fallback={<Loading />}><PlansPage /></Suspense>;
  else if (/^\/payments\/plans\/new\/?$/.test(path)) page = <Suspense fallback={<Loading />}><PlanEditor key="new" /></Suspense>;
  else if (/^\/payments\/plans\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3]; page = <Suspense fallback={<Loading />}><PlanEditor key={id} planId={id} /></Suspense>; }
  else if (signDoc) page = <Suspense fallback={<Loading />}><SignDoc key={signDoc[1]} documentId={signDoc[1] as Id<"wsDocuments">} versionNumber={Number(params.get("v")) || null} /></Suspense>;
  else if (path.startsWith("/sign/signature")) page = <Suspense fallback={<Loading />}><SignSignature /></Suspense>;
  else if (path.startsWith("/sign/connector")) page = <Settings me={me} />; // now Settings › Claude connectors
  else if (/^\/sign\/docs\/?$/.test(path)) page = <Suspense fallback={<Loading />}><SignDocs /></Suspense>;
  else if (/^\/sign\/new\/?$/.test(path)) page = <Suspense fallback={<Loading />}><SignNew /></Suspense>;
  else if (/^\/sign\/b\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3] as Id<"wsBuilds">; page = <Suspense fallback={<Loading />}><Builder key={id} mode={{ kind: "build", buildId: id }} /></Suspense>; }
  else if (/^\/sign\/templates\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3] as Id<"wsTemplates">; page = <Suspense fallback={<Loading />}><Builder key={id} mode={{ kind: "template", templateId: id }} /></Suspense>; }
  else if (/^\/sign\/templates\/?$/.test(path)) page = <Suspense fallback={<Loading />}><SignTemplates /></Suspense>;
  else if (path.startsWith("/sign")) page = <Suspense fallback={<Loading />}><SignHome /></Suspense>;
  else if (/^\/clients\/pipeline\/?$/.test(path)) page = <Suspense fallback={<Loading />}><Pipeline /></Suspense>;
  else if (/^\/clients\/follow-ups\/?$/.test(path)) page = <Suspense fallback={<Loading />}><FollowUps /></Suspense>;
  else if (/^\/clients\/deals\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3]; page = <Suspense fallback={<Loading />}><DealPage key={id} dealId={id} /></Suspense>; }
  else if (/^\/clients\/people\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3]; page = <Suspense fallback={<Loading />}><ContactPage key={id} personId={id} /></Suspense>; }
  else if (/^\/clients\/estimates\/new\/?$/.test(path)) page = <Suspense fallback={<Loading />}><EstimatePage key={search} dealId={params.get("deal")} clientId={params.get("client")} projectId={params.get("project")} /></Suspense>;
  else if (/^\/clients\/estimates\/[^/]+\/?$/.test(path)) { const id = path.split("/")[3]; page = <Suspense fallback={<Loading />}><EstimatePage key={id} estimateId={id} /></Suspense>; }
  else if (/^\/clients\/?$/.test(path)) page = <ClientsPage />;
  else if (/^\/sent\/?$/.test(path)) page = <SentPage />;
  else if (sentNote && sentNote[1] !== "new") page = <SentNote key={sentNote[1]} noteId={sentNote[1] as Id<"inboxNotes">} sent={Number(params.get("sent")) || null} />;
  else if (/^\/sent\/new\/?$/.test(path)) page = <PostNote key={params.get("note") ?? "new"} noteId={(params.get("note") as Id<"inboxNotes"> | null) ?? null} clientId={(params.get("client") as Id<"clients"> | null) ?? null} />;
  else if (clientRec) { const t = params.get("tab"); page = <ClientPage key={clientRec[1]} clientId={clientRec[1] as Id<"clients">} tab={(["projects", "shared", "documents", "inbox", "brand", "settings"].includes(t ?? "") ? t : "overview") as ClientTab} />; }
  else if (path.startsWith("/activity")) page = <ActivityPage />;
  else if (path.startsWith("/register")) page = <Settings me={me} />; // now Settings › Register
  else if (path.startsWith("/settings")) page = <Settings me={me} />;
  else if (/^\/more\/?$/.test(path)) page = <MorePage me={me} side="owner" />;
  else if (/^\/review\/?$/.test(path)) page = <Home />; // Review's main page
  else page = <OwnerHome />; // "/": the back-office Home
  // Work surfaces get no background light, so nothing competes with the video or the document.
  const workSurface = Boolean(video) || /^\/sign\/(b|d)\//.test(path) || /^\/sign\/templates\/[^/]+/.test(path);
  return (
    <UploadProvider>
      <Shell me={me} overlay={Boolean(video)} light={!workSurface}>{page}</Shell>
    </UploadProvider>
  );
}

type MeRow = NonNullable<ReturnType<typeof useQuery<typeof api.users.me>>>;
function ClientShell({ me, overlay = false, children }: { me: MeRow; overlay?: boolean; children?: React.ReactNode }) {
  const mine = useQuery(api.shares.mine, {});
  const client = (mine ?? []).find((s) => s.client)?.client ?? null;
  return <Shell me={me} side="client" overlay={overlay} subtitle={client}>{children ?? <ClientRoutes me={me} />}</Shell>;
}

// A share link opened by a signed-in client: inside their portal (P1 / Client / Review › project); the video page
// fills the screen with the menu button (overlay). Owners and guests see the share page on its own, as before.
function ShareForMember({ video, page }: { video: boolean; page: (inShell: boolean) => React.ReactNode }) {
  const me = useQuery(api.users.me);
  if (me === undefined) return <Loading />;
  if (me && !me.allowed && me.role === "client") return <ClientShell me={me} overlay={video}>{page(true)}</ClientShell>;
  return <>{page(false)}</>;
}

// The client side (P1 / Client): Home, Inbox, Review, Docs, Settings, and More on phones.
function ClientRoutes({ me }: { me: { name: string | null; email: string } }) {
  const { path, search } = useLocation();
  const params = new URLSearchParams(search);
  if (/^\/more\/?$/.test(path)) return <MorePage me={me as never} side="client" />;
  if (/^\/inbox\/?$/.test(path)) return <ClientInbox itemId={params.get("item")} />;
  if (/^\/(docs|documents)\/?$/.test(path)) { const t = params.get("tab"); return <ClientDocuments tab={(t === "signed" || t === "cancelled" ? t : "to_sign") as DocTab} />; }
  if (/^\/review\/?$/.test(path)) return <ClientReview me={me} />;
  if (/^\/payments(\/invoices)?\/?$/.test(path)) return <Suspense fallback={<Loading />}><ClientInvoices /></Suspense>;
  if (/^\/payments\/subscriptions\/?$/.test(path)) return <Suspense fallback={<Loading />}><ClientSubscriptions /></Suspense>;
  const proj = /^\/projects\/([^/]+)\/?$/.exec(path);
  if (proj) { const t = params.get("tab"); return <ClientProject key={proj[1]} projectId={proj[1]} tab={(t === "videos" || t === "documents" ? t : "overview") as ClientProjectTab} />; }
  if (path.startsWith("/settings")) return <ClientSettings me={me} />;
  return <ClientHome />;
}

// The bare wranglerportal.com (D14, Oct 28): a holding page with Sign in.
function HoldingPage() {
  return (
    <SystemPage title="Wrangler Portal" body="Client sign-in for Wrangler Productions.">
      <a className="btn primary" href="https://app.wranglerportal.com/" style={{ width: "100%" }}>Sign in</a>
    </SystemPage>
  );
}

// sign.wranglerportal.com without a token: nothing to see.
function SignHostHome() {
  return (
    <SystemPage eyebrow="Wrangler Sign" title="Open the signing link from your email." body={<>Open the signing link from your email to review and sign a document from Wrangler Productions. To check a signed copy, go to <a href="/verify" style={{ textDecoration: "underline" }}>sign.wranglerportal.com/verify</a>.</>} />
  );
}

