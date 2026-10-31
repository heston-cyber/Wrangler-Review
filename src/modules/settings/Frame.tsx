// Settings' frame (P1 / Owner / Settings, page "S5 · Settings"): the breadcrumb, the section menu on the left and the
// section on the right. On phones the menu is its own page (/settings) and each section has a back link to it.
import { useSignOutAsk } from "../../shell/SignOut";
import { Sep, TopBar } from "../../shell/Shell";
import { Icon, type IconName } from "../../ui/Icon";
import { linkProps } from "../../lib/router";

export type SectionKey = "business" | "payments" | "rates" | "brand" | "account" | "register" | "dropbox" | "connectors" | "sheet" | "clients" | "shares";

export const SECTIONS: Array<{ key: SectionKey; label: string; icon: IconName }> = [
  { key: "business", label: "Business", icon: "users" },
  { key: "payments", label: "Payments", icon: "invoice" },
  { key: "rates", label: "Pricing", icon: "activity" }, // Phase 3 (263:1382), renamed Pricing in 3b (D76)
  { key: "brand", label: "Brand kit", icon: "folder" }, // Phase 3b (708:1235)
  { key: "account", label: "Account", icon: "user" },
  { key: "register", label: "Register", icon: "register" },
  { key: "dropbox", label: "Dropbox drop folder", icon: "folder" },
  { key: "connectors", label: "Claude connectors", icon: "globe" },
  { key: "sheet", label: "Google Sheet copy", icon: "document" },
  { key: "clients", label: "Clients", icon: "users" },
  { key: "shares", label: "Shares", icon: "send" },
];

// Old addresses still land on the right section: /register, /sign/connector, /settings#claude and the like, and
// Dropbox's return to /settings?dropbox=….
const HASH: Record<string, SectionKey> = { claude: "connectors", sign: "connectors", dropbox: "dropbox", sheet: "sheet", shares: "shares", clients: "clients", account: "account", business: "business", register: "register", payments: "payments", rates: "rates", pricing: "rates", brand: "brand" };
export function sectionOf(path: string, search: string, hash: string): SectionKey | null {
  if (path.startsWith("/register")) return "register";
  if (path.startsWith("/sign/connector")) return "connectors";
  const m = /^\/settings\/([a-z]+)/.exec(path);
  if (m && SECTIONS.some((s) => s.key === m[1])) return m[1] as SectionKey;
  if (m?.[1] === "pricing") return "rates"; // Settings › Pricing keeps /settings/rates (D76)
  if (new URLSearchParams(search).has("dropbox")) return "dropbox";
  if (new URLSearchParams(search).has("stripe")) return "payments";
  const h = HASH[hash.replace(/^#/, "")];
  return h ?? null;
}

export function SectionMenu({ active, list }: { active: SectionKey | null; list?: boolean }) {
  const [signOut, signOutDialog] = useSignOutAsk();
  return (
    <nav className={`wp-setmenu glass${list ? " list" : ""}`} aria-label="Settings">
      {SECTIONS.map((s) => (
        <a key={s.key} className="item" aria-current={active === s.key ? "page" : undefined} {...linkProps(`/settings/${s.key}`)}>
          <Icon name={s.icon} size={16} /><span>{s.label}</span>{list && <Icon name="chevron-right" size={16} className="go" />}
        </a>
      ))}
      <button type="button" className="item" onClick={signOut}><Icon name="sign-out" size={16} /><span>Sign out</span></button>
      {signOutDialog}
    </nav>
  );
}

export function SettingsFrame({ section, right, children }: { section: SectionKey; right?: React.ReactNode; children: React.ReactNode }) {
  const label = SECTIONS.find((s) => s.key === section)!.label;
  return (
    <>
      <TopBar right={right}><a {...linkProps("/settings")}>Settings</a><Sep /><span className="here">{label}</span></TopBar>
      <div className="wp-page wp-set">
        <a className="wp-setback" {...linkProps("/settings")}><Icon name="arrow-left" size={20} />Settings</a>
        <div className="wp-setgrid">
          <SectionMenu active={section} />
          <div className="wp-setbody">{children}</div>
        </div>
      </div>
    </>
  );
}

/** A section's heading: eyebrow, title and one line under it. */
export function SetHead({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: React.ReactNode }) {
  return (
    <header className="wp-sethead">
      <span className="wp-eyebrow">{eyebrow}</span>
      <h1 className="wp-h3">{title}</h1>
      {sub && <p className="wp-body">{sub}</p>}
    </header>
  );
}
