// Phase 1 step 5 (Oct 29): each approved email (page "S5 · Emails", numbers as drawn) as a pure function of its data.
// The wording is today's, with "Wrangler Review" now "WranglerPortal" and the business's own name where it was
// Wrangler's. Senders: review@ for Review and sign-in, contracts@ for Sign, updates@ for notes (Heston, Oct 29).
import { type Block, type MailBrand, clientFooter, fromLine, renderMail } from "./mail";
import { SITE, SITE_HOST } from "./site";

export type Mail = { from: string; subject: string; html: string; text: string };
const first = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "";
const hi = (name: string | null | undefined): Block => ({ t: "p", text: first(name) ? `Hi ${first(name)},` : "Hi," });
/** "Heston at Wrangler Productions" (or just the business when no owner name is set). */
const byline = (b: MailBrand, full = false) => (b.ownerName ? `${full ? b.ownerName : first(b.ownerName)} at ${b.name}` : b.name);
const SIGN_HOST = "sign.wranglerportal.com";
const mk = (b: MailBrand, address: "review" | "contracts" | "updates", subject: string, blocks: Block[], footer: Block[], preheader?: string): Mail =>
  ({ from: fromLine(b, address), subject, ...renderMail(b, blocks, { footer, preheader }) });

// ---------- 01 · 02: sign-in code and password reset ----------
export function signInCodeMail(b: MailBrand, d: { code: string; minutes: number }): Mail {
  return mk(b, "review", `${d.code} is your WranglerPortal code`, [
    { t: "p", text: "Your code is" }, { t: "code", code: d.code },
    { t: "p", text: `It works for ${d.minutes} minutes.` },
    { t: "p", text: "Enter it on the page where you were signing in." },
    { t: "small", text: "If you didn't ask for it, ignore this email." },
  ], [{ t: "small", text: `WranglerPortal · ${SITE_HOST()}` }], `It works for ${d.minutes} minutes.`);
}
export function resetMail(b: MailBrand, d: { code: string; minutes: number }): Mail {
  return mk(b, "review", "Reset your WranglerPortal password", [
    { t: "p", text: "Someone asked to reset the password for this email on WranglerPortal. Your reset code is" }, { t: "code", code: d.code },
    { t: "p", text: `It works for ${d.minutes} minutes.` },
    { t: "small", text: "If that wasn't you, ignore this email and nothing changes." },
  ], [{ t: "small", text: `WranglerPortal · ${SITE_HOST()}` }]);
}

// ---------- 03: share invite (and the portal invite, which uses its layout) ----------
export function shareInviteMail(b: MailBrand, d: { kind: string; label: string; sub: string | null; access: string; hasAccount: boolean; name: string | null; link: string }): Mail {
  const what = d.kind === "client" ? `everything for ${d.label}` : d.kind === "project" ? `the project ${d.label}` : `the video "${d.label}"${d.sub ? ` (${d.sub})` : ""}`;
  return mk(b, "review", `${b.ownerName ? first(b.ownerName) : b.name} shared ${d.label} with you on WranglerPortal`, [
    hi(d.name),
    { t: "p", text: `${byline(b)} shared ${what} with you on WranglerPortal${d.access === "comment" ? ", and you can leave notes on it" : ""}.` },
    { t: "p", text: "Open it here:", tone: "muted" },
    { t: "button", label: `Open ${d.label}`, href: d.link }, { t: "link", href: d.link },
    { t: "p", text: d.hasAccount ? "Sign in with your WranglerPortal account to see it." : "It's for this email address only. The first time, you'll create your account (a password, then a six-digit code we send you); after that, just sign in." },
    { t: "p", text: "Reply to this email if anything doesn't work.", tone: "muted" },
  ], clientFooter(b));
}
/** 03b Portal invite (drawn Oct 29): "Invite to the portal" / "Resend invite" from the client page. */
export function portalInviteMail(b: MailBrand, d: { name: string | null; email: string; hasAccount: boolean }): Mail {
  const link = `${SITE()}/?invited=${encodeURIComponent(d.email).replace(/%40/g, "@")}`;
  const who = byline(b);
  return mk(b, "review", `${who} invited you to WranglerPortal`, [
    hi(d.name),
    { t: "p", text: `${who} invited you to WranglerPortal. It's where you'll find the cuts, documents and notes ${b.name} shares with you.` },
    { t: "p", text: "Open it here:", tone: "muted" },
    { t: "button", label: d.hasAccount ? "Sign in to WranglerPortal" : "Open WranglerPortal", href: link }, { t: "link", href: link, full: true },
    { t: "p", text: d.hasAccount ? `Sign in with your WranglerPortal account (${d.email}). Your email is filled in for you.` : "The first time, you'll create your account: a password, then a six-digit code we send you. After that, just sign in.", tone: "muted" },
    { t: "p", text: "Reply to this email if anything doesn't work.", tone: "muted" },
  ], b.isDefault ? [{ t: "small", text: "— WranglerPortal" }] : [{ t: "small", text: "Powered by WranglerPortal" }]);
}

// ---------- 04 · 05: new version, reply to a note ----------
export function newVersionMail(b: MailBrand, d: { title: string; number: number; description: string | null; project: string; name: string | null; link: string; unsub: string; thumbUrl: string | null }): Mail {
  return mk(b, "review", `${d.title} v${d.number} is ready to review`, [
    ...(d.thumbUrl ? [{ t: "image", src: d.thumbUrl, alt: `${d.title} v${d.number}`, href: d.link } as Block] : []),
    hi(d.name),
    { t: "p", text: `A new cut of "${d.title}" is ready to review on WranglerPortal: version ${d.number}${d.project ? ` (${d.project})` : ""}.` },
    ...(d.description ? [{ t: "p", text: `What changed: ${d.description}`, tone: "muted" } as Block] : []),
    { t: "p", text: "Watch it here:", tone: "muted" },
    { t: "button", label: `Watch v${d.number}`, href: d.link }, { t: "link", href: d.link },
    { t: "p", text: "Reply to this email if anything doesn't work.", tone: "muted" },
  ], clientFooter(b, { what: "new versions", href: d.unsub }), d.description ? `What changed: ${d.description}` : undefined);
}
export function replyMail(b: MailBrand, d: { name: string | null; replyAuthor: string; replyText: string; noteText: string; when: string; title: string; number: number; project: string; link: string; unsub: string }): Mail {
  return mk(b, "review", `${d.replyAuthor} replied on ${d.title}`, [
    hi(d.name),
    { t: "p", text: `${d.replyAuthor} replied to your note on "${d.title}" v${d.number}${d.project ? ` (${d.project})` : ""}, at ${d.when}:` },
    { t: "quote", rows: [{ who: "You", text: d.noteText || "(drawing)" }, { who: d.replyAuthor, text: d.replyText }] },
    { t: "p", text: "See it here:", tone: "muted" },
    { t: "button", label: "See the reply", href: d.link }, { t: "link", href: d.link },
  ], clientFooter(b, { what: "replies", href: d.unsub }), d.replyText.slice(0, 120));
}

// ---------- 06: the owner's alert about new client notes ----------
export function ownerAlertMail(b: MailBrand, d: { title: string; project: string; rows: Array<{ version: number; author: string; text: string; drawing: boolean; voice: boolean; when: string; link: string }> }): Mail {
  const who = [...new Set(d.rows.map((r) => r.author))];
  const n = d.rows.length, notes = `${n} new ${n === 1 ? "note" : "notes"}`;
  return mk(b, "review", `${notes} on ${d.title} from ${who[0]}${who.length > 1 ? ` and ${who.length - 1} more` : ""}`, [
    { t: "p", text: `${notes} from ${who.join(", ")} on "${d.title}"${d.project ? ` (${d.project})` : ""}.` },
    ...d.rows.map((r): Block => ({ t: "card", meta: `v${r.version} · ${r.when} · ${r.author}${r.drawing ? " · drawing" : ""}${r.voice ? " · voice" : ""}`, text: r.text || "(no words)", href: r.link })),
  ], [{ t: "small", text: "— WranglerPortal" }]);
}

// ---------- 07 · 07b · 08 · 09: signing ----------
export function pleaseSignMail(b: MailBrand, d: { name: string; title: string; label: string; link: string; until: string | null; reminder: boolean }): Mail {
  return mk(b, "contracts", `${d.reminder ? "Reminder: " : ""}Please sign: ${d.title} (${d.label})`, [
    hi(d.name),
    { t: "p", text: `${d.reminder ? "A reminder: " : ""}${byline(b, true)} sent you "${d.title}" (${d.label}) to review and sign.` },
    { t: "p", text: "Review and sign here:", tone: "muted" },
    { t: "button", label: "Review and sign", href: d.link }, { t: "link", href: d.link },
    { t: "p", text: "You'll confirm this email address with a 6-digit code, read the document, add your initials where asked, and sign. It takes a few minutes on a phone or a computer.", tone: "muted" },
    ...(d.until ? [{ t: "p", text: `The link works until ${d.until}.`, tone: "muted" } as Block] : []),
    { t: "p", text: "Questions, or would you rather sign on paper? Reply to this email.", tone: "muted" },
  ], [{ t: "small", text: `${b.footerName} · ${SIGN_HOST}` }]);
}
export function cancelledMail(b: MailBrand, d: { name: string; title: string; label: string; reason: string | null }): Mail {
  return mk(b, "contracts", `Cancelled: ${d.title} (${d.label})`, [
    hi(d.name),
    { t: "p", text: `${byline(b, true)} cancelled "${d.title}" (${d.label}). The signing link you were sent no longer works, and there's nothing for you to do.` },
    ...(d.reason ? [{ t: "box", text: `Reason: ${d.reason}` } as Block] : []),
    { t: "p", text: "Questions? Reply to this email.", tone: "muted" },
  ], [{ t: "small", text: b.name }]);
}
export function signerCodeMail(b: MailBrand, d: { code: string; title: string; label: string }): Mail {
  return mk(b, "contracts", `${d.code} is your code to sign ${d.label}`, [
    { t: "p", text: "Your code is" }, { t: "code", code: d.code },
    { t: "p", text: `Enter it on the signing page to open "${d.title}" from ${b.name}. It works for 10 minutes.` },
    { t: "small", text: "If you didn't ask for it, ignore this email: nothing happens without the code." },
  ], [{ t: "small", text: `${b.name} · ${SIGN_HOST}` }]);
}

// ---------- 10 · 11 · 12: the owner hears about signing ----------
export function ownerSignedMail(b: MailBrand, d: { signer: string; title: string; label: string; left: string[]; link: string }): Mail {
  return mk(b, "contracts", `${d.signer} signed ${d.label}`, [
    { t: "p", text: `${d.signer} signed "${d.title}" (${d.label}).` },
    ...(d.left.length ? [{ t: "p", text: `Still to sign: ${d.left.join(", ")}.`, tone: "muted" } as Block] : []),
    { t: "button", label: "Open it", href: d.link }, { t: "link", href: d.link },
  ], []);
}
/** The fallback when the signed copy couldn't be made (the copy email is the usual one). */
export function ownerAllSignedMail(b: MailBrand, d: { title: string; label: string; link: string }): Mail {
  return mk(b, "contracts", `Signed by everyone: ${d.title} (${d.label})`, [
    { t: "p", text: `Everyone has signed "${d.title}" (${d.label}).` },
    { t: "button", label: "Open it", href: d.link }, { t: "link", href: d.link },
  ], []);
}
export function ownerLockedMail(b: MailBrand, d: { signer: string; title: string; label: string; link: string }): Mail {
  return mk(b, "contracts", `Signing link locked: ${d.label}`, [
    { t: "p", text: `${d.signer}'s signing link for "${d.title}" (${d.label}) had too many wrong codes, so it's locked for good.` },
    { t: "p", text: `If that was ${first(d.signer) || d.signer} having trouble, cancel the document and send it again for a fresh link. If not, someone else may have the link.`, tone: "muted" },
    { t: "button", label: "Open it", href: d.link }, { t: "link", href: d.link },
  ], []);
}

// ---------- 13 · 13b: the signed copy ----------
export function signedCopyMail(b: MailBrand, d: {
  owner: boolean; name: string; title: string; label: string; fileName: string; fileMeta: string; signedBy: string[]; sha256: string; verifyUrl: string; link: string;
  invoice: { kind: "created"; amount: string; testMode: boolean; url: string } | { kind: "failed"; error: string } | null;
}): Mail {
  const verify = d.verifyUrl.replace(/^https?:\/\//, "");
  const common: Block[] = [
    { t: "file", name: d.fileName, meta: d.fileMeta },
    { t: "p", text: "Signed by:" }, { t: "list", items: d.signedBy },
    { t: "p", text: "The attached PDF ends with a certificate listing every step. Its SHA-256 fingerprint is:", tone: "muted" },
    { t: "mono", text: d.sha256 },
    { t: "p", text: `To check a copy later, open ${verify} and choose the file.`, tone: "muted" },
  ];
  if (d.owner) {
    return mk(b, "contracts", `Signed: ${d.title} (${d.label})`, [
      { t: "p", text: `Everyone has signed "${d.title}" (${d.label}). The signed copy is attached, and a copy went to every signer.` },
      ...common,
      { t: "button", label: "Open it", href: d.link }, { t: "link", href: d.link },
      ...(d.invoice?.kind === "created" ? [{ t: "box", text: `Draft invoice for ${d.invoice.amount}${d.invoice.testMode ? " (Stripe test mode)" : ""}, ready for you to review and send: ${d.invoice.url}` } as Block]
        : d.invoice?.kind === "failed" ? [{ t: "box", text: `The Stripe draft invoice couldn't be made: ${d.invoice.error}. Retry it from the document page.` } as Block] : []),
    ], []);
  }
  return mk(b, "contracts", `Signed: ${d.title} (${d.label})`, [
    hi(d.name),
    { t: "p", text: `Everyone has signed "${d.title}" (${d.label}). Your signed copy is attached.` },
    ...common,
    { t: "p", text: "Please keep this email for your records. Questions? Reply to this email.", tone: "muted" },
  ], [{ t: "small", text: `${b.footerName} · ${SIGN_HOST}` }]);
}

// ---------- Inbox alert: a note from the business ----------
export function noteMail(b: MailBrand, d: { title: string; text: string; link: string | null; linkLabel: string | null; unsub?: string }): Mail {
  const href = d.link ? (/^https:\/\//.test(d.link) ? d.link : `${SITE()}${d.link}`) : `${SITE()}/inbox`;
  return mk(b, "updates", d.title, [
    { t: "eyebrow", text: `A note from ${b.name}` },
    { t: "title", text: d.title },
    ...(d.text ? [{ t: "p", text: d.text } as Block] : []),
    { t: "button", label: d.link && d.linkLabel ? d.linkLabel : "Open in the portal", href },
  ], [
    { t: "small", text: `${b.footerName} · Replies go to ${b.replyTo} ·`, link: { label: "Email settings", href: `${SITE()}/settings` } },
    ...(d.unsub ? [{ t: "small", text: "Stop emails about notes:", link: { label: "unsubscribe", href: d.unsub } } as Block] : []),
    ...(!b.isDefault ? [{ t: "small", text: "Powered by WranglerPortal" } as Block] : []),
  ], d.text.slice(0, 120));
}

// ---------- 08 · Invoice sent (Phase 2 Part B, step 3) ----------
/** "Wrangler Productions, a DBA of Hill Creative LLC · {address} · {email} · Privacy policy" (as drawn on 08–12). */
const moneyFooter = (b: MailBrand): Block => ({ t: "small", text: [b.footerName, b.address, b.replyTo].filter(Boolean).join(" · ") + (b.privacyUrl ? " ·" : ""), ...(b.privacyUrl ? { link: { label: "Privacy policy", href: b.privacyUrl } } : {}) });
const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const longDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function invoiceMail(b: MailBrand, d: { name: string; number: string; title: string; project: string | null; amountCents: number; dueDate: string; memo: string | null; link: string }): Mail {
  const owner = first(b.ownerName);
  return mk(b, "updates", `Invoice ${d.number} from ${b.name}: ${usd(d.amountCents)} due ${longDate(d.dueDate)}`, [
    hi(d.name),
    { t: "p", text: d.project ? `Here’s invoice ${d.number} for ${d.project}.` : `Here’s invoice ${d.number}.` },
    { t: "sums", rows: [{ label: "Amount due", value: usd(d.amountCents), big: true }, { label: "Due", value: longDate(d.dueDate) }, { label: "Invoice", value: `${d.number} · ${d.title}` }] },
    ...(d.memo ? [{ t: "p", text: d.memo, tone: "muted" } as Block] : []),
    { t: "p", text: "You can pay by card or bank account on the invoice page. The PDF is there too." },
    { t: "button", label: "View and pay", href: d.link }, { t: "link", href: d.link },
  ], [
    { t: "small", text: owner ? `— ${owner}, ${b.name}` : `— ${b.name}` },
    moneyFooter(b),
    ...(!b.isDefault ? [{ t: "small", text: "Powered by WranglerPortal" } as Block] : []),
  ], `${usd(d.amountCents)} due ${longDate(d.dueDate)}`);
}

// ---------- 09 · 10 · 11 · 12: reminders, receipt, payment failed (Phase 2 Part B, step 4) ----------
const signoff = (b: MailBrand): Block[] => [
  { t: "small", text: first(b.ownerName) ? `— ${first(b.ownerName)}, ${b.name}` : `— ${b.name}` },
  moneyFooter(b),
  ...(!b.isDefault ? [{ t: "small", text: "Powered by WranglerPortal" } as Block] : []),
];
const at = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function reminderMail(b: MailBrand, d: { kind: "before" | "overdue"; name: string; number: string; title: string; amountCents: number; dueDate: string; link: string }): Mail {
  const due = longDate(d.dueDate);
  if (d.kind === "before") return mk(b, "updates", `Reminder: invoice ${d.number} from ${b.name} is due ${due}`, [
    hi(d.name),
    { t: "p", text: `A quick reminder that invoice ${d.number} is due on ${due}.` },
    { t: "sums", rows: [{ label: "Amount due", value: usd(d.amountCents), big: true }, { label: "Due", value: due }, { label: "Invoice", value: `${d.number} · ${d.title}` }] },
    { t: "p", text: "If you’ve already paid, thank you. You can ignore this." },
    { t: "button", label: "View and pay", href: d.link }, { t: "link", href: d.link },
  ], signoff(b), `${usd(d.amountCents)} due ${due}`);
  return mk(b, "updates", `Invoice ${d.number} from ${b.name} is overdue`, [
    hi(d.name),
    { t: "p", text: `Invoice ${d.number} was due on ${due} and is still open.` },
    { t: "sums", rows: [{ label: "Amount due", value: usd(d.amountCents), big: true }, { label: "Was due", value: due }, { label: "Invoice", value: `${d.number} · ${d.title}` }] },
    { t: "p", text: "If you’ve already paid, thank you. You can ignore this. If something’s wrong with the invoice, just reply." },
    { t: "button", label: "View and pay", href: d.link }, { t: "link", href: d.link },
  ], signoff(b), `${usd(d.amountCents)} was due ${due}`);
}

export function receiptMail(b: MailBrand, d: { name: string; number: string; title: string; paidCents: number; paidAt: number; method: string; amountCents: number; link: string }): Mail {
  return mk(b, "updates", `Receipt from ${b.name}: ${usd(d.paidCents)} paid`, [
    hi(d.name),
    { t: "p", text: "Thank you. We received your payment." },
    { t: "sums", rows: [{ label: "Amount paid", value: usd(d.paidCents), big: true }, { label: "Paid", value: at(d.paidAt) }, { label: "Method", value: d.method }, { label: "Invoice", value: `${d.number} · ${d.title}` }, { label: "Amount remaining", value: usd(d.amountCents) }] },
    { t: "p", text: "Keep this email as your receipt. The receipt PDF is on the invoice page." },
    { t: "button", label: "View receipt", href: d.link }, { t: "link", href: d.link },
  ], [...signoff(b), { t: "small", text: `Payment processed by Stripe for ${b.footerName}.` }], `${usd(d.paidCents)} paid · ${d.number}`);
}

export function paymentFailedMail(b: MailBrand, d: { name: string; number: string; title: string; amountCents: number; dueDate: string; message: string; link: string }): Mail {
  // Stripe's reason when it's a card decline ("Your card was declined."), in the design's words.
  const declined = /declin/i.test(d.message);
  return mk(b, "updates", `Payment didn’t go through: invoice ${d.number} from ${b.name}`, [
    hi(d.name),
    { t: "p", text: declined ? "Your card was declined, so nothing was charged." : `Your payment didn’t go through, so nothing was charged.${d.message && !/payment attempt failed/i.test(d.message) ? ` Stripe said: ${d.message.replace(/\.$/, "")}.` : ""}` },
    { t: "sums", rows: [{ label: "Amount due", value: usd(d.amountCents), big: true }, { label: "Due", value: longDate(d.dueDate) }, { label: "Invoice", value: `${d.number} · ${d.title}` }] },
    { t: "p", text: "You can try again, or use a different card or your bank account." },
    { t: "button", label: "Try again", href: d.link }, { t: "link", href: d.link },
  ], signoff(b), `Nothing was charged · ${d.number}`);
}

// ---------- 13 · 14 · 15 · 16 · 17: subscriptions (Phase 2b) ----------
const periodWords = (every: string) => every.replace(/^\/ /, "every ");

export function subscriptionStartedMail(b: MailBrand, d: { name: string; plan: string; price: string; every: string; starts: string; firstCharge: string; description: string | null; link: string }): Mail {
  return mk(b, "updates", `${b.name} started your ${d.plan} plan`, [
    hi(d.name),
    { t: "p", text: `${b.name} set up ${d.plan} for you: ${d.price} ${periodWords(d.every)}.` },
    { t: "sums", rows: [{ label: "Price", value: `${d.price} ${d.every}`, big: true }, { label: "Starts", value: d.starts }, { label: "First charge", value: d.firstCharge }] },
    ...(d.description ? [{ t: "p", text: d.description, tone: "muted" } as Block] : []),
    { t: "p", text: "Add a card or bank account to get it going. Nothing is charged until you do; after that it’s charged automatically each period, and you get a receipt each time." },
    { t: "button", label: "Add payment method", href: d.link }, { t: "link", href: d.link },
  ], signoff(b), `Add a payment method for ${d.plan}`);
}

export function upcomingChargeMail(b: MailBrand, d: { name: string; plan: string; amountCents: number; on: string; method: string | null; link: string }): Mail {
  return mk(b, "updates", `Your ${d.plan} plan renews on ${d.on}`, [
    hi(d.name),
    { t: "p", text: `A heads-up: ${usd(d.amountCents)} for ${d.plan} will be charged on ${d.on}${d.method ? ` to ${d.method}` : ""}.` },
    { t: "sums", rows: [{ label: "Amount", value: usd(d.amountCents), big: true }, { label: "Charged on", value: d.on }, ...(d.method ? [{ label: "Payment method", value: d.method }] : [])] },
    { t: "p", text: "Nothing to do if that’s all right. To use a different card or bank account, update it on your subscription page." },
    { t: "button", label: "View subscription", href: d.link }, { t: "link", href: d.link },
  ], signoff(b), `${usd(d.amountCents)} on ${d.on}`);
}

export function subscriptionFailedMail(b: MailBrand, d: { name: string; plan: string; amountCents: number; reason: string; nextTry: string | null; link: string }): Mail {
  return mk(b, "updates", `Your payment for ${d.plan} didn’t go through`, [
    hi(d.name),
    { t: "p", text: `We tried to charge ${usd(d.amountCents)} for ${d.plan}, and it didn’t go through.` },
    { t: "sums", rows: [{ label: "Amount", value: usd(d.amountCents), big: true }, { label: "Reason", value: d.reason }, ...(d.nextTry ? [{ label: "Next try", value: d.nextTry }] : [])] },
    { t: "p", text: "Update your card or bank account so your plan keeps going. Saving a new one tries the payment again straight away." },
    { t: "button", label: "Update payment method", href: d.link }, { t: "link", href: d.link },
  ], signoff(b), `${usd(d.amountCents)} for ${d.plan} didn’t go through`);
}

export function subscriptionCancelledMail(b: MailBrand, d: { name: string; plan: string; ends: string; ended: boolean; link: string }): Mail {
  return mk(b, "updates", d.ended ? `Your ${d.plan} plan has ended` : `Your ${d.plan} plan will end on ${d.ends}`, [
    hi(d.name),
    { t: "p", text: d.ended ? `${b.name} cancelled ${d.plan}. There are no more charges.` : `${b.name} cancelled ${d.plan}. It runs until ${d.ends}, and there are no charges after that.` },
    { t: "p", text: "Your past invoices and receipts stay on your subscription page. Questions? Just reply." },
    { t: "button", label: "View subscription", href: d.link }, { t: "link", href: d.link },
  ], signoff(b), d.ended ? `${d.plan} has ended` : `${d.plan} ends ${d.ends}`);
}

/** 17 · to the owner (D61), in the alert layout. */
export function ownerSubscriptionFailedMail(b: MailBrand, d: { client: string; plan: string; amountCents: number; reason: string; nextTry: string | null; link: string }): Mail {
  return mk(b, "updates", `Payment failed: ${d.client} · ${d.plan}`, [
    { t: "p", text: `${d.client}’s ${usd(d.amountCents)} payment for ${d.plan} didn’t go through.` },
    { t: "sums", rows: [{ label: "Reason", value: d.reason }, ...(d.nextTry ? [{ label: "Stripe tries again", value: d.nextTry }] : [{ label: "Stripe tries again", value: "No more tries" }])] },
    { t: "p", text: "They’ve been emailed a link to update their payment method." },
    { t: "button", label: "Open the subscription", href: d.link }, { t: "link", href: d.link },
  ], [{ t: "small", text: "WranglerPortal" }], `${d.client}: ${usd(d.amountCents)} didn’t go through`);
}

// ---------- 18 · 20 · 21: quick quotes (Phase 3b, S5 · Phase 3b 723:12971, 723:13026, 723:13052) ----------
/** 18 · the quote, to the person it's for (no account needed, D81). */
export function quoteMail(b: MailBrand, d: { name: string; number: string; title: string; totalCents: number; validUntil: string; terms: string | null; link: string }): Mail {
  return mk(b, "updates", `Quote ${d.number} from ${b.name}: ${usd(d.totalCents)}`, [
    hi(d.name),
    { t: "p", text: `Here’s quote ${d.number} for ${d.title}.` },
    { t: "sums", rows: [{ label: "Total", value: usd(d.totalCents), big: true }, { label: "Valid until", value: longDate(d.validUntil) }, { label: "Quote", value: `${d.number} · ${d.title}` }] },
    ...(d.terms ? [{ t: "p", text: d.terms, tone: "muted" } as Block] : []),
    { t: "p", text: "Accept or decline it on the quote page. No account needed. The PDF is there too." },
    { t: "button", label: "View and accept", href: d.link }, { t: "link", href: d.link },
  ], signoff(b), `${usd(d.totalCents)} · valid until ${longDate(d.validUntil)}`);
}

/** 20 · 21 · to the owner when the person answers (D84: nothing is drafted or moved). */
export function ownerQuoteAnsweredMail(b: MailBrand, d: { kind: "accepted" | "declined"; who: string; number: string; company: string; title: string; totalCents: number; at: string; reason: string | null; link: string }): Mail {
  const accepted = d.kind === "accepted";
  return mk(b, "updates", `${d.who} ${d.kind} quote ${d.number}`, [
    { t: "eyebrow", text: `${d.who} ${d.kind} quote ${d.number}` },
    { t: "title", text: `${d.company} · ${d.title} · ${usd(d.totalCents)}` },
    { t: "p", text: accepted
      ? `Accepted ${d.at}. Draft a contract, an invoice, or both from it when you’re ready. Nothing has been drafted or moved.`
      : `Declined ${d.at}.${d.reason ? "" : " No reason given."}` },
    ...(!accepted && d.reason ? [{ t: "box", text: `Reason: ${d.reason}` } as Block] : []),
    { t: "button", label: "Open the quote", href: d.link },
  ], [{ t: "small", text: "Sent to you when a client answers · WranglerPortal" }], `${d.who} ${d.kind} ${d.number}`);
}
