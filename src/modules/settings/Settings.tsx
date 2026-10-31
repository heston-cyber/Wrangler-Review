// Settings (Phase 1 look, Oct 29: page "S5 · Settings"): a section menu and one section at a time. Business, Account,
// Register, Dropbox drop folder, Claude connectors, Google Sheet copy, Clients and Shares. Appearance is gone (dark only).
import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useSignOutAsk } from "../../shell/SignOut";
import { Copy, KeyRound, Plus, Sheet, X } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { TopBar } from "../../shell/Shell";
import { Avatar, Modal, useToast } from "../../ui/kit";
import { Button, Segmented, Toggle } from "../../ui/wp";
import { Watermark } from "../review/player/Watermark";
import lightArcs from "../../assets/d1/light-arcs.jpg";
import { Icon } from "../../ui/Icon";
import { useLocation } from "../../lib/router";
import { SectionMenu, sectionOf, SettingsFrame, SetHead, type SectionKey } from "./Frame";
import { SignConnectorPanel } from "../docs/pages/SignConnector";
import Register from "../review/Register";
import wpLogo from "../../assets/d1/wp-logo.png";
import lightElbow from "../../assets/portal/light-elbow.jpg";
import { ago } from "../../lib/format";
import { DropboxSettings } from "./DropboxSettings";
import { PaymentsSettings } from "./PaymentsSettings";
import { ClientsSettings } from "../clients/Clients";
import { SharesSettings } from "../review/Share";

// The connector lives on the Convex site host: <deployment>.convex.site/mcp
const CONVEX = (import.meta.env.VITE_CONVEX_URL as string | undefined) || "https://handsome-hummingbird-11.convex.cloud";
export const MCP_URL = CONVEX.replace(/\.convex\.cloud\/?$/, ".convex.site") + "/mcp";
const FEED_URL = CONVEX.replace(/\.convex\.cloud\/?$/, ".convex.site") + "/register-feed";

// The Apps Script that keeps the Google Sheet copy of the register up to date (pulls every 10 minutes).
function sheetScript(key: string) {
  return `// Wrangler Review register: copies the register into the "Register" tab every 10 minutes.
// Run setUp once (it asks for permission), then leave it. Edits in the sheet are overwritten; change things on the site.
const FEED = "${FEED_URL}";
const KEY = "${key}";

function refreshRegister() {
  const res = UrlFetchApp.fetch(FEED, { headers: { "X-Key": KEY }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error("Wrangler Review feed answered " + res.getResponseCode() + ": " + res.getContentText().slice(0, 200));
  const data = JSON.parse(res.getContentText());
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName("Register") || ss.insertSheet("Register", 0);
  const cols = data.columns;
  const rows = data.rows.map(function (r) { return cols.map(function (c) { return r[c] === undefined || r[c] === null ? "" : r[c]; }); });
  sh.clearContents();
  sh.getRange(1, 1, Math.max(rows.length + 1, 2), 2).setNumberFormat("@"); // keep 00001 as text
  sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight("bold");
  if (rows.length) sh.getRange(2, 1, rows.length, cols.length).setValues(rows);
  sh.setFrozenRows(1);
  sh.getRange(1, cols.length + 2).setValue("Updated " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMM d, h:mm a"));
  // Phase 3 (D58): the "Job ledger" tab, one row per project exported from its Ledger tab.
  if (data.ledger && data.ledger.length) {
    const lg = ss.getSheetByName("Job ledger") || ss.insertSheet("Job ledger");
    const lcols = Object.keys(data.ledger.reduce(function (a, r) { Object.keys(r).forEach(function (k) { a[k] = 1; }); return a; }, {}));
    lg.clearContents();
    lg.getRange(1, 1, 1, lcols.length).setValues([lcols]).setFontWeight("bold");
    lg.getRange(2, 1, data.ledger.length, lcols.length).setValues(data.ledger.map(function (r) { return lcols.map(function (c) { return r[c] === undefined ? "" : r[c]; }); }));
    lg.setFrozenRows(1);
  }
}

function setUp() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "refreshRegister") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("refreshRegister").timeBased().everyMinutes(10).create();
  refreshRegister();
}
`;
}

export async function copy(text: string, show: (m: string) => void, what = "Copied") {
  try { await navigator.clipboard.writeText(text); show(what); }
  catch { show("Couldn't copy. Select the text and copy it yourself."); }
}

export default function Settings({ me }: { me: { name: string | null; email: string } }) {
  const { path, search } = useLocation();
  const [toast, show] = useToast();
  const section = sectionOf(path, search, location.hash);
  // Old addresses (#claude, /register, /sign/connector, Dropbox's ?dropbox=…) move to the section's own address.
  useEffect(() => {
    if (!section || path === `/settings/${section}`) return;
    history.replaceState(null, "", `/settings/${section}${search}`);
    window.dispatchEvent(new Event("wr:navigate"));
  }, [section, path, search]);
  const narrow = useNarrow();
  // /settings: the section list on a phone; the Business section on a computer.
  if (!section && narrow) {
    return (
      <>
        <TopBar><span className="here">Settings</span></TopBar>
        <div className="wp-page wp-set"><SectionMenu active={null} list /></div>
      </>
    );
  }
  const key: SectionKey = section ?? "business";
  if (key === "register") return <Register />;
  return (
    <SettingsFrame section={key}>
      {key === "business" && <BusinessSection show={show} />}
      {key === "payments" && <PaymentsSettings show={show} />}
      {key === "account" && <AccountSection me={me} show={show} />}
      {key === "dropbox" && <DropboxSettings show={show} />}
      {key === "connectors" && <>
        <SetHead eyebrow="Claude connectors" title="Claude reads your notes and sets up your contracts." sub="Two connectors, each with its own keys." />
        <Connector show={show} />
        <SignConnectorPanel show={show} />
      </>}
      {key === "sheet" && <SheetCopy show={show} />}
      {key === "clients" && <ClientsSettings show={show} />}
      {key === "shares" && <SharesSettings show={show} />}
      {toast}
    </SettingsFrame>
  );
}

function useNarrow() {
  const q = "(max-width: 820px)";
  const [n, setN] = useState(() => typeof matchMedia === "function" && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const m = matchMedia(q); const on = () => setN(m.matches);
    m.addEventListener("change", on); return () => m.removeEventListener("change", on);
  }, []);
  return n;
}

function AccountSection({ me, show }: { me: { name: string | null; email: string }; show: (m: string) => void }) {
  const setName = useMutation(api.users.setName);
  const [signOut, signOutDialog] = useSignOutAsk();
  const [name, setN] = useState(me.name ?? "");
  const changed = name.trim() !== (me.name ?? "") && name.trim().length > 0;
  return (
    <>
      <SetHead eyebrow="Account" title="Your profile." sub="The name here goes on every note and reply you leave." />
      <div className="panel">
        <div className="prow">
          <span className="pl">Name</span>
          <span className="pr">
            <input className="input" value={name} onChange={(e) => setN(e.target.value)} placeholder="Heston" aria-label="Name" />
            <Button size="sm" disabled={!changed} onClick={async () => { await setName({ name }); show("Name saved"); }}>Save</Button>
          </span>
        </div>
        <div className="prow"><span className="pl">Email</span><span className="pr secondary">{me.email}</span></div>
        <div className="prow"><span className="pl">Picture</span><span className="pr"><Avatar name={name || me.email} size="lg" /></span></div>
      </div>
      <div className="panel">
        <div className="prow">
          <span className="pl">Sign out <span className="psub">Ends this session on this device.</span></span>
          <span className="pr"><Button size="sm" onClick={signOut}>Sign out</Button></span>
        </div>
      </div>
      {signOutDialog}
    </>
  );
}

type Biz = { name: string; legalName: string; emailFromName: string; replyTo: string; address: string; privacyUrl: string; accent: string; background: string; modules: { review: boolean; docs: boolean; payments: boolean; projects?: boolean } };

function BusinessSection({ show }: { show: (m: string) => void }) {
  const cur = useQuery(api.business.settings, {});
  const save = useMutation(api.business.updateSettings);
  const uploadUrl = useMutation(api.business.logoUploadUrl);
  const setLogo = useMutation(api.business.setLogo);
  const [f, setF] = useState<Biz | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (cur && !f) setF({ name: cur.name, legalName: cur.legalName ?? "", emailFromName: cur.emailFromName ?? "", replyTo: cur.replyTo ?? "", address: cur.address ?? "", privacyUrl: cur.privacyUrl ?? "", accent: cur.accent ?? "", background: cur.background ?? "", modules: cur.modules });
  }, [cur, f]);
  const dirty = useMemo(() => !!(cur && f) && (f.name !== cur.name || f.legalName !== (cur.legalName ?? "") || f.emailFromName !== (cur.emailFromName ?? "") || f.replyTo !== (cur.replyTo ?? "") || f.address !== (cur.address ?? "") || f.privacyUrl !== (cur.privacyUrl ?? "") || f.accent.toUpperCase() !== (cur.accent ?? "") || f.background.toUpperCase() !== (cur.background ?? "") || JSON.stringify(f.modules) !== JSON.stringify(cur.modules)), [cur, f]);
  if (!cur || !f) return <SetHead eyebrow="Business" title="Your business." sub="How your portal looks to clients and what it sends as." />;
  const set = (p: Partial<Biz>) => setF({ ...f, ...p });
  const onSave = async () => {
    setBusy("save"); setErr(null);
    try {
      await save({ name: f.name, legalName: f.legalName || null, emailFromName: f.emailFromName || null, replyTo: f.replyTo || null, address: f.address || null, privacyUrl: f.privacyUrl || null, accent: f.accent || null, background: f.background || null, modules: f.modules });
      show("Saved");
    } catch (e) { setErr((e as Error).message.replace(/^.*ConvexError: /, "").split("\n")[0]); }
    finally { setBusy(null); }
  };
  const field = (label: string, k: "name" | "legalName" | "emailFromName" | "replyTo" | "address" | "privacyUrl", type = "text", ph = "") => (
    <label className="wp-field"><span className="wp-field-label">{label}</span><input className="input" type={type} value={f[k]} placeholder={ph} onChange={(e) => set({ [k]: e.target.value } as Partial<Biz>)} /></label>
  );
  const hex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);
  return (
    <>
      <SetHead eyebrow="Business" title="Your business." sub="How your portal looks to clients and what it sends as." />
      <div className="wp-bizgrid">
        <div className="wp-biz glass">
          {field("Business name", "name")}
          {field("Legal name", "legalName")}
          {field("Email from-name", "emailFromName", "text", f.name)}
          {field("Reply-to", "replyTo", "email", cur.ownerEmail ?? "")}
          {field("Business address", "address", "text", "Street, city, state ZIP")}
          {field("Privacy policy link", "privacyUrl", "url", "https://")}
          <p className="wp-field-hint" style={{ margin: "-6px 0 0" }}>Shown on invoices, receipts and email footers. Stripe requires both on receipts.</p>
          <div className="wp-biz2">
            <LogoSlot label="Logo · on dark" url={cur.logoUrl} light={false} busy={busy === "dark"} onPick={async (file) => { setBusy("dark"); try { await uploadLogo(file, "dark"); } finally { setBusy(null); } }} onClear={() => void setLogo({ storageId: null })} />
            <LogoSlot label="Logo · on light" url={cur.logoLightUrl} light busy={busy === "light"} onPick={async (file) => { setBusy("light"); try { await uploadLogo(file, "light"); } finally { setBusy(null); } }} onClear={() => void setLogo({ storageId: null, which: "light" })} />
          </div>
          <div className="wp-biz2">
            <ColourField label="Accent colour" value={f.accent} fallback="#FF0000" onChange={(v) => set({ accent: v })} />
            <ColourField label="Background colour" value={f.background} fallback="#030104" onChange={(v) => set({ background: v })} />
          </div>
          {cur.accentCheck && !cur.accentCheck.ok && f.accent.toUpperCase() === cur.accent && <p className="wp-warnline"><Icon name="alert" size={14} plain />Text on this colour may be hard to read.</p>}
          <span className="wp-eyebrow">Modules</span>
          <ModRow label="Review" checked={f.modules.review} onChange={(v) => set({ modules: { ...f.modules, review: v } })} />
          <ModRow label="Docs" checked={f.modules.docs} onChange={(v) => set({ modules: { ...f.modules, docs: v } })} />
          <ModRow label="Inbox" checked disabled onChange={() => {}} />
          <ModRow label="Projects" checked={f.modules.projects !== false} onChange={(v) => set({ modules: { ...f.modules, projects: v } })} />
          <ModRow label="Invoices (Phase 2)" checked={f.modules.payments} disabled onChange={() => {}} />
          {err && <p className="wp-errline">{err}</p>}
          <div><Button variant="primary" loading={busy === "save"} disabled={!dirty || !f.name.trim() || (!!f.accent && !hex(f.accent)) || (!!f.background && !hex(f.background))} onClick={() => void onSave()}>Save</Button></div>
        </div>
        <div className="wp-bizprev">
          <span className="wp-label">Preview · client Home</span>
          <div className="frame" style={{ ["--pv-accent" as string]: hex(f.accent) ? f.accent : "var(--accent)", ["--pv-bg" as string]: hex(f.background) ? f.background : "var(--surface-base)" }} aria-hidden>
            <img className="light" src={lightElbow} alt="" />
            <span className="side"><span className="logo">{cur.logoUrl ? <img src={cur.logoUrl} alt="" /> : <><i className="rec" /><img src={wpLogo} alt="" /></>}</span></span>
            <span className="main"><b>Two things need you.</b><i /><i /><i /></span>
          </div>
        </div>
      </div>
      <RoundsAndWatermark cur={cur} show={show} />
    </>
  );

  async function uploadLogo(file: File, which: "dark" | "light") {
    if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(file.type) || file.size > 1_000_000) { show("Use a PNG, JPG, SVG or WebP image under 1 MB."); return; }
    try {
      const r = await fetch(await uploadUrl({}), { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!r.ok) throw new Error(`Upload failed (${r.status}).`);
      const { storageId } = (await r.json()) as { storageId: Id<"_storage"> };
      await setLogo({ storageId, which });
      show("Logo saved");
    } catch (e) { show((e as Error).message.replace(/^.*ConvexError: /, "").split("\n")[0]); }
  }
}

type BizSettings = NonNullable<ReturnType<typeof useQuery<typeof api.business.settings>>>;
/** Phase 2 Part A (S5 · Phase 2 › Settings · Business / Rounds + watermark): revision rounds (each version is a
 *  round, D23; default 2, D23b) and the watermark on review copies (D24: on for every client, off per client). */
function RoundsAndWatermark({ cur, show }: { cur: BizSettings; show: (m: string) => void }) {
  const save = useMutation(api.business.updateSettings);
  const [rounds, setRounds] = useState<string | null>(null);
  const w = cur.watermark;
  const setW = (p: Partial<typeof w>) => void save({ watermark: { ...w, ...p } }).catch((e) => show(String((e as Error).message)));
  return (
    <div className="wp-bizextra">
      <div className="panel">
        <span className="wp-eyebrow">Revision rounds</span>
        <div className="prow"><span className="pl">Use them</span><span className="pr"><Toggle label="Revision rounds" checked={!cur.roundsOff} onChange={(on) => void save({ roundsOff: !on }).then(() => show(on ? "Revision rounds are on." : "Revision rounds are off."), (e) => show(String((e as Error).message)))} /><span className="wmtxt">{cur.roundsOff ? "Off · no round chips, last-round notices or change-order prompts" : "On · each version counts as a round"}</span></span></div>
        {!cur.roundsOff && <>
        <div className="prow"><span className="pl">Default</span><span className="pr">{rounds === null ? <><span>{cur.roundsDefault} {cur.roundsDefault === 1 ? "round" : "rounds"} per video</span><button type="button" className="linkbtn" onClick={() => setRounds(String(cur.roundsDefault))}>Change<Icon name="edit" size={14} /></button></> : (
          <><input className="input sm" type="number" min={1} max={20} value={rounds} onChange={(e) => setRounds(e.target.value)} aria-label="Rounds per video" autoFocus style={{ width: 80 }} />
            <Button size="sm" variant="primary" onClick={async () => { const n = Number(rounds); if (!Number.isFinite(n) || n < 1) { show("1 or more."); return; } try { await save({ roundsDefault: n }); setRounds(null); show("Saved."); } catch (e) { show(String((e as Error).message).replace(/^.*ConvexError: /, "").split("\n")[0]); } }}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setRounds(null)}>Cancel</Button></>
        )}</span></div>
        <div className="prow"><span className="pl">How it counts</span><span className="pr">Each version you upload is a round: v1 is round 1, v2 is round 2.</span></div>
        <div className="prow"><span className="pl">Per client</span><span className="pr">Change it, or switch it off, on a client or on one project.</span></div>
        </>}
      </div>
      <div className="panel">
        <span className="wp-eyebrow">Watermark on review copies</span>
        <div className="prow"><span className="pl">Use it</span><span className="pr">On for every client. Switch it off on a client's page (Settings tab).</span></div>
        <div className="prow"><span className="pl">Logo</span><span className="pr">{cur.logoUrl ? "Logo · on dark (above)" : "The WP mark, until you upload a logo above"}</span></div>
        <div className="prow"><span className="pl">Corner</span><span className="pr"><Segmented label="Corner" value={w.corner} onChange={(c) => setW({ corner: c })} items={[{ key: "tl", label: "Top left" }, { key: "tr", label: "Top right" }, { key: "bl", label: "Bottom left" }, { key: "br", label: "Bottom right" }]} /></span></div>
        <div className="prow"><span className="pl">Size</span><span className="pr"><Segmented label="Size" value={w.size} onChange={(z) => setW({ size: z })} items={[{ key: "small", label: "Small" }, { key: "large", label: "Large" }]} /></span></div>
        <div className="prow"><span className="pl">Opacity</span><span className="pr wp-opacity"><input type="range" min={5} max={100} step={5} defaultValue={Math.round(w.opacity * 100)} aria-label="Opacity" onChange={(e) => { const el = e.currentTarget.nextElementSibling; if (el) el.textContent = `${e.currentTarget.value}%`; }} onPointerUp={(e) => setW({ opacity: Number(e.currentTarget.value) / 100 })} onKeyUp={(e) => setW({ opacity: Number(e.currentTarget.value) / 100 })} /><span>{Math.round(w.opacity * 100)}%</span></span></div>
        <div className="wp-wmsample"><img src={lightArcs} alt="" /><Watermark look={{ ...w, logoUrl: cur.logoUrl }} /></div>
      </div>
    </div>
  );
}

function ModRow({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return <label className="wp-modrow"><span>{label}</span><Toggle label={label} checked={checked} disabled={disabled} onChange={onChange} /></label>;
}

function LogoSlot({ label, url, light, busy, onPick, onClear }: { label: string; url: string | null; light: boolean; busy: boolean; onPick: (f: File) => void; onClear: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="wp-field">
      <span className="wp-field-label">{label}</span>
      <button type="button" className={`wp-logoslot${light ? " light" : ""}`} onClick={() => input.current?.click()} aria-label={`${label}: ${url ? "change" : "upload"}`} aria-busy={busy || undefined}>
        {url ? <img src={url} alt="" /> : <span className="wp-logo"><span className="rec" /><img src={wpLogo} alt="" /></span>}
      </button>
      {url && <button type="button" className="wp-link sm" onClick={onClear}>Remove</button>}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) onPick(file); }} />
    </div>
  );
}

function ColourField({ label, value, fallback, onChange }: { label: string; value: string; fallback: string; onChange: (v: string) => void }) {
  const ok = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <label className="wp-field">
      <span className="wp-field-label">{label}</span>
      <span className="wp-colour input">
        <input type="color" value={ok ? value : fallback} onChange={(e) => onChange(e.target.value.toUpperCase())} aria-label={`${label} picker`} />
        <input className="hex" value={value} placeholder={fallback} maxLength={7} onChange={(e) => onChange(e.target.value.trim())} aria-label={label} aria-invalid={value !== "" && !ok ? true : undefined} />
      </span>
    </label>
  );
}

function Connector({ show }: { show: (m: string) => void }) {
  const keys = useQuery(api.connector.listKeys, {});
  const createKey = useAction(api.connector.createKey);
  const revokeKey = useMutation(api.connector.revokeKey);
  const [made, setMade] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<{ _id: Id<"connectorKeys">; prefix: string; label: string } | null>(null);

  const make = async () => {
    setBusy(true);
    try { setMade((await createKey({ label: "Claude" })).key); }
    catch (e) { show((e as Error).message.replace(/^.*ConvexError: /, "").split("\n")[0]); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="wp-setsub" id="claude">
        <span className="eyebrow">Wrangler Review</span>
        <p>Claude reads your notes. Connect once, then tell Claude you left notes, in any chat on your desktop or phone.</p>
      </div>

      <div className="panel">
        <div className="prow">
          <span className="pl">Connector address</span>
          <span className="pr">
            <code className="mono addr">{MCP_URL}</code>
            <button className="icon-btn" onClick={() => void copy(MCP_URL, show, "Address copied")} aria-label="Copy the connector address" title="Copy"><Copy size={15} /></button>
          </span>
        </div>
        <div className="prow">
          <span className="pl">Keys <span className="secondary" style={{ display: "block", fontSize: 12.5 }}>Claude sends a key with every request. Revoke one and it stops working right away.</span></span>
          <span className="pr"><button className="btn primary sm" disabled={busy} onClick={() => void make()}><Plus size={15} />{busy ? "Making…" : "Create key"}</button></span>
        </div>
        {keys === undefined ? null : keys.length === 0 ? (
          <div className="prow"><span className="pl secondary">No keys yet.</span></div>
        ) : keys.map((k) => (
          <div className="prow keyrow" key={k._id}>
            <KeyRound size={16} />
            <span className="pl">
              <b>{k.label}</b> <code className="mono">{k.prefix}…</code>
              <span className="secondary" style={{ display: "block", fontSize: 12.5 }}>
                Made {ago(k.createdAt)} · {k.lastUsedAt ? <>last used {ago(k.lastUsedAt)}</> : "not used yet"}
              </span>
            </span>
            <span className="pr"><button className="btn sm" onClick={() => setRevoking(k)}>Revoke</button></span>
          </div>
        ))}
      </div>

      <div className="panel setup">
        <div className="prow"><span className="pl"><b>Set up in Claude</b> <span className="secondary" style={{ display: "block", fontSize: 12.5 }}>Once, on claude.ai or the desktop app. Your phone picks it up from your account.</span></span></div>
        <ol className="steps">
          <li>Make a key above and copy it. It's shown once.</li>
          <li>In Claude, open <b>Customize › Connectors</b>, then <b>Add custom connector</b>.</li>
          <li>Name it <b>Wrangler Review</b> and paste the connector address.</li>
          <li>For sign-in, pick <b>No sign-in</b>. Under <b>Request headers</b>, choose <code className="mono">authorization</code> and paste <code className="mono">Bearer</code>, a space, then your key.</li>
          <li>No <b>Request headers</b> section? Use the address with the key on the end instead. The key window gives you that one too.</li>
          <li>In a chat, turn it on from <b>+ › Connectors</b>, then try: “I left notes on the Spirit intro.”</li>
        </ol>
      </div>

      {made && (
        <Modal onClose={() => setMade(null)} label="Your connector key" width={560}>
          <div style={{ display: "grid", gap: 18 }}>
            <div className="dhead">
              <h2 className="headline">Your key. <span className="rest">Copy it now. It won't be shown again.</span></h2>
              <button className="icon-btn" onClick={() => setMade(null)} aria-label="Close"><X size={18} /></button>
            </div>
            <KeyLine label="Request header value (for authorization)" value={`Bearer ${made}`} onCopy={(v) => void copy(v, show, "Header value copied")} />
            <KeyLine label="Key only" value={made} onCopy={(v) => void copy(v, show, "Key copied")} />
            <KeyLine label="No Request headers in Claude? Use this address" value={`${MCP_URL}/${made}`} onCopy={(v) => void copy(v, show, "Address copied")} />
            <p className="caption secondary" style={{ margin: 0 }}>Keep it out of chats, email and screenshots. Anyone with it can read and reply to notes on this site.</p>
            <div className="dfoot"><button className="btn primary" onClick={() => setMade(null)}>Done</button></div>
          </div>
        </Modal>
      )}

      {revoking && (
        <Modal onClose={() => setRevoking(null)} label="Revoke key" width={460}>
          <div style={{ display: "grid", gap: 18 }}>
            <div className="dhead">
              <h2 className="headline">Revoke {revoking.prefix}…? <span className="rest">Claude stops reaching the site with this key right away. You can make a new one any time.</span></h2>
              <button className="icon-btn" onClick={() => setRevoking(null)} aria-label="Close"><X size={18} /></button>
            </div>
            <div className="dfoot">
              <button className="btn" onClick={() => setRevoking(null)}>Cancel</button>
              <button className="btn primary" onClick={async () => { await revokeKey({ keyId: revoking._id }); setRevoking(null); show("Key revoked"); }}>Revoke</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

export function KeyLine({ label, value, onCopy }: { label: string; value: string; onCopy: (v: string) => void }) {
  return (
    <div className="keyline rect">
      <span className="rlabel">{label}</span>
      <div className="kv">
        <code className="mono" onClick={(e) => { const r = document.createRange(); r.selectNodeContents(e.currentTarget); const s = getSelection(); s?.removeAllRanges(); s?.addRange(r); }}>{value}</code>
        <button className="icon-btn" onClick={() => onCopy(value)} aria-label={`Copy: ${label}`} title="Copy"><Copy size={15} /></button>
      </div>
    </div>
  );
}

function SheetCopy({ show }: { show: (m: string) => void }) {
  const status = useQuery(api.register.sheetKey, {});
  const makeKey = useAction(api.register.makeSheetKey);
  const removeKey = useMutation(api.register.removeSheetKey);
  const [script, setScript] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try { setScript(sheetScript((await makeKey({})).key)); }
    catch (e) { show((e as Error).message.replace(/^.*ConvexError: /, "").split("\n")[0]); }
    finally { setBusy(false); }
  };
  return (
    <>
      <SetHead eyebrow="Google Sheet copy" title="The register in a Google Sheet." sub="A copy that refreshes itself every 10 minutes. Changes happen here, not in the sheet." />
      <div className="panel">
        <div className="prow">
          <span className="pl">
            Sheet key
            <span className="secondary" style={{ display: "block", fontSize: 12.5 }}>
              {status === undefined ? "…" : status ? <>Key <code className="mono">{status.prefix}…</code> made {ago(status.createdAt)} · {status.lastUsedAt ? <>sheet last refreshed {ago(status.lastUsedAt)}</> : "not used yet"}</> : "No key yet. The sheet reads the register with it, and can't change anything."}
            </span>
          </span>
          <span className="pr">
            {status && <button className="btn sm" onClick={async () => { await removeKey({}); show("Sheet key removed. The sheet stops refreshing."); }}>Turn off</button>}
            <button className="btn primary sm" disabled={busy} onClick={() => void make()}><Sheet size={15} />{busy ? "Making…" : status ? "New key and script" : "Set up the sheet"}</button>
          </span>
        </div>
      </div>
      {script && (
        <Modal onClose={() => setScript(null)} label="Google Sheet script" width={640}>
          <div style={{ display: "grid", gap: 16 }}>
            <div className="dhead">
              <h2 className="headline">Your sheet script. <span className="rest">Its key is inside. Copy it now; it won't be shown again.</span></h2>
              <button className="icon-btn" onClick={() => setScript(null)} aria-label="Close"><X size={18} /></button>
            </div>
            <ol className="steps">
              <li>Make a Google Sheet (<b>sheets.new</b>) and name it <b>Wrangler Review Register</b>.</li>
              <li>In the sheet, open <b>Extensions › Apps Script</b>. Delete what's in the editor, paste the script, and press <b>Save</b>.</li>
              <li>Pick <b>setUp</b> in the function menu at the top, then press <b>Run</b>. Allow access when Google asks: <b>Review permissions</b>, your account, <b>Advanced</b>, then <b>Go to … (unsafe)</b> and <b>Allow</b>. It's your own script.</li>
              <li>Back in the sheet, the <b>Register</b> tab fills in. It refreshes every 10 minutes on its own.</li>
            </ol>
            <div className="keyline rect">
              <span className="rlabel">Apps Script</span>
              <pre className="mono scriptbox">{script}</pre>
            </div>
            <p className="caption secondary" style={{ margin: 0 }}>Keep the script out of chats and email. The key only reads the register, and you can turn it off here any time. Making a new key stops the old one.</p>
            <div className="dfoot">
              <button className="btn" onClick={() => setScript(null)}>Done</button>
              <button className="btn primary" onClick={() => void copy(script, show, "Script copied")}><Copy size={15} />Copy script</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
