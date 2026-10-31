// Wrangler Portal, Phase 0.5d (Oct 28): which tables belong to a business.
// Business-owned tables carry `businessId`. Global tables don't: accounts (a person can belong to several
// businesses), the businesses and memberships themselves (memberships carry their own businessId), rate limits,
// OAuth state, the email send log (dedupe keys) and test/diagnostic logs.
export const BUSINESS_TABLES = [
  "invites", "shares", "shareMembers", "shareActivity", "views", "emailPrefs", "projects", "videos", "counters",
  "sheetKeys", "versions", "voiceUploads", "notes", "replies", "opens", "connectorKeys", "dropbox",
  "dropFiles", "transcripts", "waveforms", "clients", "stillFiles",
  "wsDocuments", "wsBuilds", "wsTemplates", "wsClauses", "wsStyles", "wsProfile", "wsFonts", "wsConnectorKeys",
  "wsDropbox", "wsSignings", "wsVersions", "wsRequests", "wsOwnerSignatures",
  "clientPeople", "inboxItems", "inboxNotes", "clientApprovals", "deliveryFiles", "invoices", "plans", "subscriptions", "deals", "estimates", "followUps", "ledgerEntries", "quotes", "proposals",
] as readonly string[];

export const GLOBAL_TABLES = [
  "users", "businesses", "memberships", "rateLimits", "oauthStates", "emailLog", "stripeEvents", "userPrefs", "playerLogs", "phase0Runs", "r1Results",
] as readonly string[];

// Belong to a business through their parent and are never patched: Wrangler Sign's audit trail is append-only
// (its hash chain covers fixed fields, and an audit entry is never edited after it is written). Its document says
// which business it belongs to.
export const INHERITED_TABLES = ["wsEvents"] as readonly string[];

export const isBusinessTable = (table: string) => BUSINESS_TABLES.includes(table);
