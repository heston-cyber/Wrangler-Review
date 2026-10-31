// The doc builder (B2, Oct 27; one Craft-style editor since E1), laid out like Craft: the outline on the left, the
// page in the middle (every line is a block you edit where it sits), and a panel on the right with Insert · Format ·
// Style · Details. It edits either a build (a document on its way to signing) or a template. Everything saves as you go.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import {
  BookmarkPlus, Check, Eye, FileSignature, Palette, Heading, Heading1, LayoutTemplate, List, Minus, PanelTop, PenLine, Plus, Receipt, Redo2, Undo2,
  ScrollText, Send, SeparatorHorizontal, Space, TriangleAlert, Type, Users, X, CircleCheck, Trash2, Ellipsis, ArrowUp, ArrowDown, Copy, CopyPlus, ListChecks, CircleSlash,
} from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Sep, TopBar } from "../../../shell/Shell";
import { linkProps, navigate } from "../../../lib/router";
import { Modal, Spinner, useToast } from "../../../ui/kit";
import {
  FIELD_HELP, INSERT_LABEL, PAGE_PT, buildProblems, clauseSection, emptyFields, fieldValues, fill, missingFields, money, newNodes, pageOf, sectionClause, signerKeys, totals,
  type BuildDoc, type ExtraSigner, type Fields, type InsertKind, type PNode, type Style,
} from "../../../../convex/lib/wsBuilder";
import { cssFamily, loadForScreen, type FontRow } from "./fonts";
import { StylePanel } from "./StylePanel";
import { FormatPanel, QuickMenu, useEditorTick, type MenuAt } from "./FormatPanel";
import { PageEditor, endInsertDrag, startInsertDrag } from "./editor/PageEditor";
import { BuilderCtx } from "./editor/nodes";
import {
  canMovePicked, clearBlocks, deletePicked, duplicatePicked, insertAfterPicked, insertKind, insertNodes, isPicking, movePicked, outline, pickAll, pickedText, picks, setPickMode, togglePickAt,
} from "./editor/commands";
import { marginSelect, pickableBlocks } from "./editor/blockSelection";
import { touchDragger, type TouchDragView } from "./touchDrag";
import { errText, uploadToStorage } from "../pages/common";
import { Icon } from "../../../ui/Icon";
import { Button, IconButton, SkeletonRows, EmptyState, ButtonLink, StatusChip as Chip, Checkbox, DialogHeader, TextArea } from "../../../ui/wp";
import { proposalProblems } from "../../../../convex/lib/wsProposal";

// Phase 3b: proposals open here too (S5 · Phase 3b 716:4980 / 718:4495): no signature boxes, Send instead of
// "Continue to signing", locked once sent, and "Start the contract?" once accepted (D75, D84).
export type ProposalInfo = NonNullable<FunctionReturnType<typeof api.proposals.get>>;
type Mode = { kind: "build"; buildId: Id<"wsBuilds">; proposal?: ProposalInfo } | { kind: "template"; templateId: Id<"wsTemplates">; proposal?: boolean };
const P_OPEN = new Set(["draft", "waiting", "ready"]);
const P_CHIP: Record<string, { tone: "neutral" | "accent" | "success" | "danger" | "warning"; text: string }> = {
  draft: { tone: "neutral", text: "Draft" }, waiting: { tone: "warning", text: "Waiting for Claude" }, ready: { tone: "accent", text: "Ready" }, sent: { tone: "accent", text: "Sent" },
  accepted: { tone: "success", text: "Accepted" }, declined: { tone: "danger", text: "Declined" }, void: { tone: "neutral", text: "Withdrawn" },
};
export const ProposalChip = ({ status }: { status: string }) => <Chip tone={P_CHIP[status]?.tone ?? "neutral"}>{P_CHIP[status]?.text ?? status}</Chip>;
const longDay = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const longWhen = (t: number) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
type Tab = "insert" | "format" | "style" | "details";
type Meta = { name: string; description: string };

const INSERT: Array<{ kind: InsertKind; icon: React.ReactNode; hint: string }> = [
  { kind: "title", icon: <Icon name="document" size={18} />, hint: "The document's title (Ctrl+1)" },
  { kind: "heading", icon: <Icon name="document" size={18} />, hint: "A section heading (Ctrl+3)" },
  { kind: "text", icon: <Icon name="note" size={18} />, hint: "A line of text (Ctrl+5)" },
  { kind: "section", icon: <Icon name="note" size={18} />, hint: "A container of lines: a clause, with optional initials" },
  { kind: "card", icon: <Icon name="folder" size={18} />, hint: "A tinted container of lines" },
  { kind: "parties", icon: <Icon name="users" size={18} />, hint: "You and the client" },
  { kind: "items", icon: <Icon name="invoice" size={18} />, hint: "Services with qty, rate, total" },
  { kind: "payment", icon: <Icon name="invoice" size={18} />, hint: "Deposit and balance (sets the Stripe draft)" },
  { kind: "signatures", icon: <Icon name="sign" size={18} />, hint: "Signature, name, title and date lines" },
  { kind: "divider", icon: <Icon name="minus" size={18} />, hint: "A line between sections" },
  { kind: "pagebreak", icon: <Icon name="document" size={18} />, hint: "Start a new page" },
  { kind: "spacer", icon: <Icon name="plus" size={18} />, hint: "Some empty space" },
];

export default function Builder({ mode }: { mode: Mode }) {
  const prop = mode.kind === "build" ? mode.proposal ?? null : null;
  const isProp = !!prop || (mode.kind === "template" && !!mode.proposal);
  const locked = !!prop && !P_OPEN.has(prop.status);
  const build = useQuery(api.builder.getBuild, mode.kind === "build" ? { buildId: mode.buildId } : "skip");
  const tpl = useQuery(api.builder.getTemplate, mode.kind === "template" ? { templateId: mode.templateId } : "skip");
  const profile = useQuery(api.builder.getProfile);
  const fonts = useQuery(api.builder.listFonts);
  const clauses = useQuery(api.builder.listClauses);
  const saveBuild = useMutation(api.builder.saveBuild);
  const updateTemplate = useMutation(api.builder.updateTemplate);
  const saveAsTemplate = useMutation(api.builder.saveAsTemplate);
  const saveClause = useMutation(api.builder.saveClause);
  const createBuild = useMutation(api.builder.createBuild);
  const uploadUrl = useMutation(api.builder.uploadUrl);
  const toSigning = useAction(api.builder.toSigning);
  const ensureGoogle = useAction(api.builder.ensureGoogleFont);
  const sendProposal = useAction(api.proposals.send);
  const startContract = useAction(api.proposals.startContract);
  const createProposal = useMutation(api.proposals.create);
  const proposalLater = useMutation(api.proposals.later);
  const withdrawProposal = useMutation(api.proposals.withdraw);
  const copyProposal = useMutation(api.proposals.copy);
  const dismissDrafted = useMutation(api.proposals.dismissDrafted);
  const [toast, show] = useToast();
  const [sending, setSending] = useState(false);
  const [contracting, setContracting] = useState(false);

  const [doc, setDocRaw] = useState<BuildDoc | null>(null);
  const [meta, setMeta] = useState<Meta>({ name: "", description: "" });
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [tab, setTab] = useState<Tab>("insert");
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [asTemplate, setAsTemplate] = useState(false);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  // Phones: the panel is a sheet that slides up from a bar at the bottom.
  const [sheet, setSheet] = useState(false);
  // Phones zoom into anything under 16px when it's tapped; the builder sets its own text size there instead.
  useEffect(() => {
    const m = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!m) return;
    const was = m.content;
    m.content = `${was.replace(/,?\s*maximum-scale=[^,]*/g, "")}, maximum-scale=1`;
    return () => { m.content = was; };
  }, []);
  useEditorTick(editor);

  // Phones: Craft-style select mode. A circle on every block; tap blocks to tick them, then Style, + Content, Actions
  // or Delete from the bar at the bottom; the blue ✓ finishes. Press and hold a block (or Select in the bar) to start.
  const picking = isPicking(editor);
  // On a computer, blocks selected Craft-style (by their handle, ⋯, Esc or a drag across lines) get the same bar.
  const wide = typeof matchMedia === "function" && matchMedia("(min-width: 761px)").matches;
  const ticked = editor && (picking || wide) ? picks(editor).length : 0;
  const blockBar = picking || (wide && ticked > 0);
  const [actions, setActions] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const justPicked = useRef(0);
  const startPick = (at?: { left: number; top: number }) => {
    if (!editor) return;
    const r = at ? editor.view.posAtCoords(at) : null;
    setPickMode(editor, true, r ? (r.inside >= 0 ? r.inside : r.pos) : null);
    setSheet(false); setActions(false);
    justPicked.current = Date.now();
    try { navigator.vibrate?.(10); } catch { /* not on iPhone */ }
    // The same press-and-hold also starts the phone's own text selection (blue handles, Copy / Search). Clear it,
    // and keep clearing it while the finger is still down, so only the block gets ticked.
    const clear = () => { try { const s = window.getSelection(); if (s && s.rangeCount) s.removeAllRanges(); } catch { /* nothing selected */ } };
    clear();
    const stopAt = Date.now() + 1500;
    const onSel = () => { if (Date.now() > stopAt) { document.removeEventListener("selectionchange", onSel); return; } clear(); };
    document.addEventListener("selectionchange", onSel);
    setTimeout(() => document.removeEventListener("selectionchange", onSel), 1600);
  };
  useEffect(() => { if (!blockBar && actions) setActions(false); }, [blockBar, actions]);
  const endPick = () => { if (editor) { if (isPicking(editor)) setPickMode(editor, false); else clearBlocks(editor); } setSheet(false); setActions(false); };
  useEffect(() => {
    if (!blockBar) return;
    // Esc finishes (the page handles its own Esc while it has the focus; this is for a click on the bar or a menu).
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && (picking || !editor?.view.hasFocus())) endPick(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  // Phones: the keyboard is only up while you're typing on the page. With a sheet open (or in select mode) the page is
  // read-only for the moment, so Format's buttons and Insert's items act on it without bringing the keyboard back.
  const phoneNow = typeof matchMedia === "function" && matchMedia("(max-width: 599px)").matches;
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const lock = locked || picking || (phoneNow && sheet);
    if (editor.isEditable !== !lock) editor.setEditable(!lock);
    if (lock) (editor.view.dom as HTMLElement).blur();
  }, [editor, sheet, picking, phoneNow, locked]);

  // Phones: while typing, the line with the cursor stays in view: above the keyboard and the bottom bar, below the top
  // bar. Checked when the selection moves, as text is typed, and when the keyboard opens or the screen scrolls.
  useEffect(() => {
    if (!editor || !phoneNow) return;
    let raf = 0;
    const check = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (editor.isDestroyed || !editor.isEditable || !editor.view.hasFocus()) return;
        const vv = window.visualViewport;
        const vTop = vv ? vv.offsetTop : 0, vBottom = vv ? vv.offsetTop + vv.height : innerHeight;
        const top = Math.max(vTop, document.querySelector(".topbar, header")?.getBoundingClientRect().bottom ?? 0) + 12;
        const bar = document.querySelector(".wsb-phonebar")?.getBoundingClientRect();
        let c: { top: number; bottom: number };
        try { c = editor.view.coordsAtPos(editor.state.selection.head); } catch { return; }
        // Two lines' worth of room between the line you're typing and the keyboard (Heston, Oct 29).
        const line = Math.max(18, Math.min(48, c.bottom - c.top));
        const bottom = Math.min(vBottom, bar && bar.height && bar.top > vTop + 100 ? bar.top : vBottom) - (2 * line + 8);
        let delta = 0;
        if (c.bottom > bottom) delta = c.bottom - bottom;
        else if (c.top < top) delta = c.top - top;
        if (!delta) return;
        let sc: HTMLElement | null = (editor.view.dom as HTMLElement).parentElement;
        while (sc && !(/(auto|scroll)/.test(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight)) sc = sc.parentElement;
        (sc ?? (document.scrollingElement as HTMLElement)).scrollBy({ top: delta, behavior: "auto" });
      });
    };
    const late = () => { check(); setTimeout(check, 300); }; // the keyboard slides up over ~250ms
    editor.on("selectionUpdate", check);
    editor.on("update", check);
    editor.on("focus", late);
    window.visualViewport?.addEventListener("resize", late);
    return () => {
      cancelAnimationFrame(raf);
      editor.off("selectionUpdate", check); editor.off("update", check); editor.off("focus", late);
      window.visualViewport?.removeEventListener("resize", late);
    };
  }, [editor, phoneNow]);

  // Phones: press and hold an Insert item (or a clause) to drag it onto the page.
  const [tdrag, setTdrag] = useState<TouchDragView | null>(null);
  const touch = useMemo(() => touchDragger({
    editor: () => editorRef.current,
    onView: setTdrag,
    onPicked: () => setSheet(false),
    onDropped: (label) => showRef.current(`Added ${label}`),
  }), []);
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;
  const showRef = useRef(show);
  showRef.current = show;

  // First load only: after that the page's copy is the truth and saves go up. Older documents (a list of blocks) are
  // converted to the page editor's lines here.
  useEffect(() => {
    if (doc) return;
    if (mode.kind === "build" && build) setDocRaw({ title: build.title, page: pageOf(build.blocks), fields: build.fields as Fields, signers: (build.signers as ExtraSigner[]) ?? [], style: build.style as Style });
    if (mode.kind === "template" && tpl && profile) {
      const f = { ...emptyFields(profile), ...(tpl.fields as Partial<Fields>) } as Fields;
      setDocRaw({ title: tpl.name, page: pageOf(tpl.blocks), fields: { ...f, business: profile, client: emptyFields(profile).client }, signers: [], style: tpl.style as Style });
      setMeta({ name: tpl.name, description: tpl.description ?? "" });
    }
  }, [build, tpl, profile, doc, mode.kind]);

  // Undo and redo (⌘Z, ⇧⌘Z or ⌘Y; the buttons in the bar): one history for the whole document, the page and the
  // panels alike. Changes made within a second of each other (typing a sentence, dragging a colour) are one step.
  const docRef = useRef<BuildDoc | null>(null);
  docRef.current = doc;
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const hist = useRef<{ past: BuildDoc[]; future: BuildDoc[]; at: number }>({ past: [], future: [], at: 0 });
  const [, setHistTick] = useState(0);
  const setDoc = useCallback((f: (d: BuildDoc) => BuildDoc) => {
    const d = docRef.current;
    if (!d) return;
    const n = f(d);
    if (n === d) return;
    const h = hist.current, now = Date.now();
    if (now - h.at > 1000 || !h.past.length) { h.past.push(d); if (h.past.length > 200) h.past.shift(); }
    h.at = now; h.future = [];
    docRef.current = n;
    setDocRaw(n); setDirty(true); setHistTick((x) => x + 1);
  }, []);
  const step = useCallback((dir: "undo" | "redo") => {
    const d = docRef.current, h = hist.current;
    const from = dir === "undo" ? h.past : h.future, to = dir === "undo" ? h.future : h.past;
    if (!d || !from.length) return;
    const n = from.pop()!;
    to.push(d); h.at = 0;
    docRef.current = n;
    setDocRaw(n); setDirty(true); setHistTick((x) => x + 1);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k !== "z" && k !== "y") return;
      if ((e.target as HTMLElement | null)?.closest?.("[role=dialog]")) return; // a dialog's own field keeps its own undo
      e.preventDefault(); e.stopPropagation();
      step(k === "y" || e.shiftKey ? "redo" : "undo");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [step]);
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const onPage = useCallback((page: BuildDoc["page"]) => setDoc((d) => ({ ...d, page })), [setDoc]);

  // Save a moment after the last change.
  useEffect(() => {
    if (!dirty || !doc) return;
    if (locked) { setDirty(false); return; } // a sent proposal doesn't change (the server refuses it too)
    setSaveState("saving");
    const t = setTimeout(async () => {
      const savedDoc = doc, savedMeta = meta;
      try {
        if (mode.kind === "build") await saveBuild({ buildId: mode.buildId, title: doc.title, blocks: doc.page, fields: doc.fields, signers: doc.signers, style: doc.style });
        else await updateTemplate({ templateId: mode.templateId, name: meta.name || doc.title, description: meta.description, blocks: doc.page, fields: { project: doc.fields.project, custom: doc.fields.custom }, style: doc.style });
        // Phase 3b review fix: an edit made while this save was on its way keeps the page dirty, so it saves too.
        if (docRef.current === savedDoc && metaRef.current === savedMeta) { setDirty(false); setSaveState("saved"); }
      } catch (e) { setSaveState("error"); show(errText(e)); }
    }, 700);
    return () => clearTimeout(t);
  }, [doc, meta, dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fonts: make sure the style's Google fonts are stored, and load every stored face for the screen.
  const fontRows = (fonts ?? []) as FontRow[];
  const families = new Set(fontRows.map((f) => f.family));
  useEffect(() => { void loadForScreen(fontRows); }, [fonts]); // eslint-disable-line react-hooks/exhaustive-deps
  const asking = useRef(new Set<string>());
  useEffect(() => {
    if (!doc || fonts === undefined) return;
    for (const f of [doc.style.fonts.heading, doc.style.fonts.body]) {
      if (f.source !== "google" || families.has(f.family) || asking.current.has(f.family)) continue;
      asking.current.add(f.family);
      ensureGoogle({ family: f.family }).catch((e) => show(errText(e)));
    }
  }, [doc?.style.fonts.heading.family, doc?.style.fonts.body.family, fonts]); // eslint-disable-line react-hooks/exhaustive-deps

  const fileIds = useMemo(() => (doc ? [doc.style.logo?.fileId, doc.style.cover?.fileId, doc.style.backdropImage?.fileId].filter(Boolean) as Id<"_storage">[] : []), [doc?.style.logo?.fileId, doc?.style.cover?.fileId, doc?.style.backdropImage?.fileId]); // eslint-disable-line react-hooks/exhaustive-deps
  const files = useQuery(api.builder.fileUrls, fileIds.length ? { ids: fileIds } : "skip") ?? {};
  // The page is drawn 760px wide, or narrower to fit the space between the outline and the panel (phones too).
  const [stageW, setStageW] = useState(800);
  const ro = useRef<ResizeObserver | null>(null);
  const stageRef = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    if (!el) return;
    ro.current = new ResizeObserver(() => setStageW(el.clientWidth));
    ro.current.observe(el);
    setStageW(el.clientWidth);
  }, []);
  const onSelectText = useCallback(() => setTab("format"), []);

  // Opening a declined proposal is seeing it: it leaves Home.
  useEffect(() => { if (prop?.status === "declined" && !prop.asked.seen) void proposalLater({ proposalId: prop._id, what: "seen" }).catch(() => undefined); }, [prop?.status, prop?.asked.seen]); // eslint-disable-line react-hooks/exhaustive-deps

  const missingKey = doc ? missingFields(doc.page, doc.fields).sort().join(",") : "";
  const missing = useMemo(() => new Set(missingKey ? missingKey.split(",") : []), [missingKey]);

  if (!doc) return <><TopBar><a {...linkProps("/sign")}>Docs</a></TopBar><div className="wp-page docs"><div className="wp-tablecard glass"><SkeletonRows n={3} /></div></div></>;
  if (mode.kind === "build" && !prop && build?.kind === "proposal") return <><TopBar><a {...linkProps("/proposals")}>Proposals</a></TopBar><div className="wp-page docs"><EmptyState icon="quote" title="This is a proposal." body="Proposals open from Proposals, where they're sent and answered." actions={<ButtonLink to="/proposals">All proposals</ButtonLink>} /></div></>;
  if (mode.kind === "build" && build === null) return <><TopBar><a {...linkProps("/sign")}>Docs</a></TopBar><div className="wp-page docs"><EmptyState icon="document" title="This document doesn't exist." actions={<ButtonLink to="/sign/docs">All docs</ButtonLink>} /></div></>;

  const st = doc.style;
  const values = fieldValues(doc.fields, doc.page);
  const t = totals(doc.page);
  const phone = stageW < 600;
  const pageW = phone ? stageW - 16 : Math.max(300, Math.min(760, stageW - 32)), scale = pageW / PAGE_PT[st.pageSize].w;
  const px = (pt: number) => pt * scale;
  // On a phone the page keeps the screen's width and the text a readable size (16px body), so lines wrap differently
  // from the PDF there; the PDF itself doesn't change.
  const textPx = phone ? Math.max(16, px(st.baseSize)) : px(st.baseSize);
  const padPx = phone ? Math.max(14, px(st.margin) * 0.45) : px(st.margin);
  const H = cssFamily(st.fonts.heading.family), B = cssFamily(st.fonts.body.family);
  const sent = mode.kind === "build" && build?.document && (build.document.status === "sent" || build.document.status === "completed");
  const items = editor && !editor.isDestroyed ? outline(editor.state.doc, values, (s, v) => fill(s, v, "…")) : [];

  const onSaveClause = async (sec: PNode) => {
    const c = sectionClause(sec);
    try { await saveClause({ title: c.title, body: c.body, initials: c.initials }); show(`"${c.title}" saved to the clause library`); } catch (e) { show(errText(e)); }
  };
  const dragNodes = (e: React.DragEvent, nodes: PNode[]) => startInsertDrag(e, nodes);

  const assets = () => ({ fonts: fontRows, files: files as Record<string, string | null> });
  const render = async () => { const { renderPdf } = await import("./pdf"); return renderPdf(doc, assets(), prop ? prop.number : build?.document?.label); };
  const onPreview = async () => {
    setBusy("preview");
    try { const blob = await render(); setPreview(URL.createObjectURL(blob)); }
    catch (e) { show(`The PDF couldn't be made: ${errText(e)}`); } finally { setBusy(null); }
  };
  const onContinue = async () => {
    const p = buildProblems(doc);
    if (p.length) { setProblems(p); setTab("details"); return; }
    setBusy("continue");
    try {
      if (dirty && mode.kind === "build") { await saveBuild({ buildId: mode.buildId, title: doc.title, blocks: doc.page, fields: doc.fields, signers: doc.signers, style: doc.style }); setDirty(false); }
      const blob = await render();
      const storageId = await uploadToStorage(await uploadUrl({}), new File([blob], `${doc.title}.pdf`, { type: "application/pdf" }));
      const r = await toSigning({ buildId: (mode as { buildId: Id<"wsBuilds"> }).buildId, storageId });
      navigate(`/sign/d/${r.documentId}`);
    } catch (e) { show(errText(e)); setBusy(null); }
  };
  const onUseTemplate = async () => {
    setBusy("use");
    const templateId = (mode as { templateId: Id<"wsTemplates"> }).templateId;
    try {
      if (isProp) { const id = await createProposal({ templateId }); navigate(`/proposals/${id}`); }
      else { const id = await createBuild({ templateId }); navigate(`/sign/b/${id}`); }
    } catch (e) { show(errText(e)); setBusy(null); }
  };
  // Proposals: Send checks the proposal first (Details lists what's missing), then asks (717:4509).
  const onAskSend = () => {
    const p = proposalProblems(doc);
    if (p.length) { setProblems(p); setTab("details"); if (phone) setSheet(true); show(p[0]); return; }
    setProblems(null); setSending(true);
  };
  const onSend = async (message: string, move: boolean) => {
    if (!prop) return;
    try {
      // Always save first (review fix): the server checks and freezes the saved copy, so it must match the PDF.
      const sent = doc;
      await saveBuild({ buildId: prop.buildId, title: sent.title, blocks: sent.page, fields: sent.fields, signers: sent.signers, style: sent.style });
      if (docRef.current === sent) setDirty(false);
      const blob = await render();
      const storageId = await uploadToStorage(await uploadUrl({}), new File([blob], `${prop.number} ${doc.title}.pdf`, { type: "application/pdf" }));
      const r = await sendProposal({ proposalId: prop._id, storageId, message: message.trim() || undefined, move });
      setSending(false);
      show(r.held ? "Saved as sent, but the email was held (email sending is limited on this site)." : `Sent to ${doc.fields.client.name.split(" ")[0] || doc.fields.client.email}`);
    } catch (e) { show(errText(e)); }
  };
  const onResend = async () => {
    if (!prop) return;
    setBusy("resend");
    try { const r = await sendProposal({ proposalId: prop._id, resend: true }); show(r.held ? "The email was held (email sending is limited on this site)." : "Sent the email again"); } catch (e) { show(errText(e)); } finally { setBusy(null); }
  };
  const onCopy = async () => {
    if (!prop) return;
    setBusy("copy");
    try { const id = await copyProposal({ proposalId: prop._id }); navigate(`/proposals/${id}`); } catch (e) { show(errText(e)); setBusy(null); }
  };
  const onStartContract = async () => {
    if (!prop) return;
    try { const id = await startContract({ proposalId: prop._id }); navigate(`/sign/b/${id}`); } catch (e) { show(errText(e)); }
  };
  const goTo = (pos: number) => {
    if (!editor) return;
    editor.chain().focus().setTextSelection(TextSelection.near(editor.state.doc.resolve(Math.min(pos + 1, editor.state.doc.content.size))).from).run();
    (editor.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const keys = signerKeys(doc.page);
  const extraKeys = keys.filter((k) => k !== "heston" && k !== "client");

  return (
    <BuilderCtx.Provider value={{ doc, values, px, onDetails: () => setTab("details"), onSaveClause: (sec) => void onSaveClause(sec) }}>
      <TopBar right={<>
        <span className="wsb-undo">
          <button className="icon-btn sm" aria-label="Undo" title={`Undo (${mac ? "⌘Z" : "Ctrl+Z"})`} disabled={!hist.current.past.length} onClick={() => step("undo")}><Icon name="arrow-left" size={18} /></button>
          <button className="icon-btn sm" aria-label="Redo" title={`Redo (${mac ? "⇧⌘Z" : "Ctrl+Shift+Z"})`} disabled={!hist.current.future.length} onClick={() => step("redo")}><Icon name="arrow-right" size={18} /></button>
        </span>
        {locked ? <span className="ws-save hide-sm saved"><Icon name="lock" size={14} /> Locked · {P_CHIP[prop!.status]?.text.toLowerCase()}</span>
          : <span className={`ws-save hide-sm ${saveState}`}>{saveState === "saving" ? <><Spinner /> Saving</> : saveState === "error" ? <><Icon name="alert" size={14} /> Not saved</> : <><Icon name="check" size={14} plain /> Saved</>}</span>}
        {prop && <span className="hide-sm"><ProposalChip status={prop.status} /></span>}
        <Button variant="ghost" size="sm" className="hide-sm" loading={busy === "preview"} onClick={() => void onPreview()} iconEnd="external">Preview PDF</Button>
        {prop ? <>
          {!locked && <Button variant="ghost" size="sm" className="hide-sm" onClick={() => setAsTemplate(true)}>Save as proposal template</Button>}
          {!locked ? <Button variant="primary" size="sm" disabled={prop.status === "waiting"} title={prop.status === "waiting" ? "Claude is still drafting it" : undefined} onClick={onAskSend}>Send</Button>
            : prop.status === "accepted" ? (prop.contract ? <ButtonLink variant="secondary" size="sm" to={`/sign/b/${prop.contract._id}`}>Open the contract</ButtonLink> : <Button variant="primary" size="sm" onClick={() => setContracting(true)}>Start the contract</Button>)
            : prop.status === "sent" ? <Button variant="secondary" size="sm" loading={busy === "resend"} onClick={() => void onResend()}>Send again</Button>
            : <Button variant="secondary" size="sm" loading={busy === "copy"} onClick={() => void onCopy()}>Make a copy</Button>}
        </> : mode.kind === "build" ? <>
          <Button variant="ghost" size="sm" className="hide-sm" onClick={() => setAsTemplate(true)} iconEnd="chevron-right">Save as template</Button>
          <Button variant="primary" size="sm" loading={busy === "continue"} disabled={!!sent} onClick={() => void onContinue()} title={sent ? "It's out for signature or signed" : undefined}>{build?.document ? "Update the PDF" : "Continue to signing"}</Button>
        </> : <Button variant="primary" size="sm" loading={busy === "use"} onClick={() => void onUseTemplate()}>{isProp ? "New proposal from this" : "New document from this"}</Button>}
      </>}>
        {isProp ? <><a {...linkProps("/proposals")}>Proposals</a><Sep /></> : <><a {...linkProps("/sign")}>Docs</a><Sep /></>}
        {mode.kind === "template" ? <><a {...linkProps(isProp ? "/proposals/templates" : "/sign/templates")}>Templates</a><Sep /></> : null}
        <span className="here">{mode.kind === "template" ? meta.name || doc.title : doc.title}{prop ? ` · ${prop.number}` : build?.document ? ` · ${build.document.label}` : ""}</span>
      </TopBar>

      <div className="content wsb" style={{ ["--wsb-backdrop" as string]: st.backdrop, ...(st.backdropImage && files[st.backdropImage.fileId] ? { ["--wsb-backdrop-img" as string]: `url(${files[st.backdropImage.fileId]})` } : {}) }}>
        {/* Outline */}
        <nav className="wsb-outline" aria-label="Outline">
          <span className="label">Outline</span>
          {items.map((o) => <button key={o.pos} className={`wsb-oitem${o.level ? " sub" : ""}`} onClick={() => goTo(o.pos)}>{o.text}</button>)}
        </nav>

        {/* The page */}
        <div className="wsb-stage" ref={stageRef}>
          {prop && <ProposalBanner p={prop} busy={busy} onDismiss={() => void dismissDrafted({ proposalId: prop._id }).catch((e) => show(errText(e)))} onContract={() => setContracting(true)} onLater={() => void proposalLater({ proposalId: prop._id, what: "contract" }).catch((e) => show(errText(e)))}
            onWithdraw={async () => { try { await withdrawProposal({ proposalId: prop._id }); show("Withdrawn. The link now says so."); } catch (e) { show(errText(e)); } }} onCopy={() => void onCopy()} />}
          {sent && <div className="wp-notice ws-banner"><Icon name="lock" size={20} /><span className="txt">{build!.document!.label} is {build!.document!.status === "sent" ? "out for signature" : "signed"}. Changes here won't reach it; cancel it first to send a new version.</span></div>}
          <div className={`wsb-page${picking ? " wsb-picking" : ""}`}
            // Select mode: a tap ticks the block under it; nothing else on the page reacts (no typing, no fields).
            onMouseDownCapture={(e) => { if (picking) { e.preventDefault(); e.stopPropagation(); } }}
            onClickCapture={(e) => {
              if (!picking || !editor) return;
              e.preventDefault(); e.stopPropagation();
              if (Date.now() - justPicked.current < 600) return;
              togglePickAt(editor, { left: e.clientX, top: e.clientY });
            }}
            onTouchStart={(e) => {
              if (picking || !phone || e.touches.length !== 1) return;
              const t = e.touches[0], at = { left: t.clientX, top: t.clientY };
              pressTimer.current = window.setTimeout(() => { pressTimer.current = null; startPick(at); }, 420); // before the phone's own text selection kicks in (~500 ms)
            }}
            onTouchMove={() => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; } }}
            onTouchEnd={() => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; } }}
            onMouseDown={(e) => {
              // A drag in the page's margin selects whole blocks (like Craft); a click below the text goes to the end.
              if (e.target !== e.currentTarget || !editor) return;
              const r = editor.view.dom.getBoundingClientRect();
              if (e.clientX < r.left) { e.preventDefault(); marginSelect(editor.view, e.clientY, r.left + 8); }
              else if (e.clientY > r.bottom) { e.preventDefault(); editor.chain().focus("end").run(); }
            }}
            style={{ width: pageW, minHeight: px(PAGE_PT[st.pageSize].h), background: st.page, color: st.text, fontFamily: B, fontSize: textPx, padding: `${padPx}px`, ["--wsb-accent" as string]: st.accent, ["--wsb-muted" as string]: st.muted, ["--wsb-heading" as string]: st.heading, ["--wsb-hfont" as string]: H, ["--wsb-bfont" as string]: B, ["--wsb-text" as string]: st.text, ["--wsb-pagebg" as string]: st.page }}>
            {st.cover && files[st.cover.fileId] && <div className="wsb-cover" style={{ height: px(st.cover.height), backgroundImage: `url(${files[st.cover.fileId]})`, margin: `-${padPx}px -${padPx}px ${px(18)}px` }} />}
            {st.logo && files[st.logo.fileId] && <div style={{ textAlign: st.logo.align, marginBottom: px(st.baseSize * 1.2) }}><img src={files[st.logo.fileId]!} alt="Logo" style={{ width: px(st.logo.width) }} /></div>}
            <PageEditor page={doc.page} onChange={onPage} onEditor={setEditor} onSelectText={onSelectText} onMenu={(m) => { if (picking || Date.now() - justPicked.current < 1500) return; setMenu(m); }} missing={missing} />
            {st.footer && <div className="wsb-footer" style={{ color: st.muted, fontSize: textPx * 0.75 }}><span>{doc.title}</span><span>Page 1 of …</span></div>}
          </div>
        </div>

        {/* The panel */}
        <aside className={`wsb-panel glass${sheet ? " open" : ""}`}>
          <div className="tabs wsb-tabs" role="tablist">
            {(["insert", "format", "style", "details"] as Tab[]).map((k) => <button key={k} className="tab" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{k[0].toUpperCase() + k.slice(1)}</button>)}
            <IconButton icon="close" label="Close" className="wsb-sheetclose" onClick={() => setSheet(false)} />
          </div>
          {tab === "insert" && (
            <div className="wsb-pane">
              <span className="wsb-hint">{phone ? "Tap to add after the cursor, or press and hold to drag onto the page" : "Drag onto the page (or into a container), or click to add after the cursor"}</span>
              {INSERT.filter((x) => !isProp || (x.kind !== "parties" && x.kind !== "signatures")).map((x) => <button key={x.kind} className="wsb-insert" draggable onDragStart={(e) => dragNodes(e, newNodes(x.kind))} onDragEnd={() => endInsertDrag(editor)} {...touch.item(() => newNodes(x.kind), INSERT_LABEL[x.kind])} onClick={() => { if (touch.justDropped()) return; if (editor) insertKind(editor, x.kind); if (phone) setSheet(false); }}>{x.icon}<span><b>{INSERT_LABEL[x.kind]}</b><span className="secondary">{x.hint}</span></span></button>)}
              {prop && <PitchDeck p={prop} show={show} />}
              {!isProp && <ClauseLibrary clauses={clauses} onInsert={(c) => { if (touch.justDropped()) return; if (editor) insertNodes(editor, [clauseSection(c)]); if (phone) setSheet(false); }} onDragStart={(e, c) => dragNodes(e, [clauseSection(c)])} onDragEnd={() => endInsertDrag(editor)} touchProps={(c) => touch.item(() => [clauseSection(c)], c.title)} />}
            </div>
          )}
          {tab === "format" && <FormatPanel editor={editor} accent={st.accent} onSaveClause={(sec) => void onSaveClause(sec)} />}
          {tab === "style" && <StylePanel style={st} onChange={(s) => setDoc((d) => ({ ...d, style: s }))} fonts={fontRows} files={files as Record<string, string | null>} show={show} />}
          {tab === "details" && (
            <DetailsPane doc={doc} setDoc={setDoc} extraKeys={isProp ? [] : extraKeys} mode={mode.kind} proposal={isProp} meta={meta} setMeta={(m) => { setMeta(m); setDirty(true); }} total={t} problems={problems ?? (mode.kind === "build" ? (isProp ? (locked ? [] : proposalProblems(doc)) : buildProblems(doc)) : [])} show={show} />
          )}
        </aside>
      </div>

      {/* Phones: the panel's tabs as a bar at the bottom; tapping one slides the panel up as a sheet. */}
      {!picking && (
        <nav className="wsb-phonebar" aria-label="Builder panel">
          {([["insert", <Plus size={18} key="i" />, "Insert"], ["format", <Type size={18} key="f" />, "Format"], ["style", <Palette size={18} key="s" />, "Style"], ["details", <Users size={18} key="d" />, "Details"]] as const).map(([k, icon, label]) => (
            <button key={k} className={sheet && tab === k ? "on" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => { if (sheet && tab === k) setSheet(false); else { setTab(k); setSheet(true); } }}>{icon}<span>{label}</span></button>
          ))}
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => startPick()}><CircleCheck size={18} /><span>Select</span></button>
        </nav>
      )}
      {/* Select mode (phones, and the Select button on a computer): what's ticked, the actions for it, and the ✓ to finish. */}
      {blockBar && editor && <>
        <button className="wsb-pickdone" aria-label="Done selecting" onClick={endPick}><Check size={24} strokeWidth={3} /></button>
        <div className="wsb-pickcount" role="status">{ticked ? `${ticked} selected` : "Tap blocks to select them"}</div>
        <nav className="wsb-phonebar wsb-pickbar" aria-label="Selected blocks">
          <span className="wsb-pickn" role="status">{ticked ? `${ticked} selected` : "Tap blocks to select them"}</span>
          <button disabled={!ticked} onClick={() => { setTab("format"); setActions(false); setSheet(!(sheet && tab === "format")); }} className={sheet && tab === "format" ? "on" : ""}><Type size={18} /><span>Style</span></button>
          <button onClick={() => { insertAfterPicked(editor); setTab("insert"); setActions(false); setSheet(true); }}><Plus size={18} /><span>+ Content</span></button>
          <button className={actions ? "on" : ""} onClick={() => { setSheet(false); setActions(!actions); }}><Ellipsis size={18} /><span>Actions</span></button>
          <button className="danger" disabled={!ticked} onClick={() => { const n = deletePicked(editor); setSheet(false); setActions(false); show(`Deleted ${n} block${n === 1 ? "" : "s"}. Undo brings ${n === 1 ? "it" : "them"} back.`); }}><Trash2 size={18} /><span>Delete</span></button>
          <button className="wsb-pickfin" onClick={endPick} title="Back to typing (Esc)"><Check size={18} /><span>Done</span></button>
        </nav>
        {actions && (
          <div className="wsb-pickactions" role="menu">
            <button role="menuitem" disabled={!canMovePicked(editor)} onClick={() => movePicked(editor, -1)}><ArrowUp size={16} />Move up</button>
            <button role="menuitem" disabled={!canMovePicked(editor)} onClick={() => movePicked(editor, 1)}><ArrowDown size={16} />Move down</button>
            <button role="menuitem" disabled={!ticked} onClick={() => { duplicatePicked(editor); setActions(false); }}><CopyPlus size={16} />Duplicate</button>
            <button role="menuitem" disabled={!ticked} onClick={() => { void navigator.clipboard?.writeText(pickedText(editor)).then(() => show("Copied the text"), () => show("Couldn't copy")); setActions(false); }}><Copy size={16} />Copy text</button>
            <button role="menuitem" onClick={() => { pickAll(editor, pickableBlocks(editor.state.doc)); setActions(false); }}><ListChecks size={16} />Select all</button>
            <button role="menuitem" disabled={!ticked} onClick={() => { if (isPicking(editor)) pickAll(editor, []); else endPick(); setActions(false); }}><CircleSlash size={16} />Clear selection</button>
            {!canMovePicked(editor) && ticked > 1 && <p className="caption secondary">Move works on blocks next to each other.</p>}
          </div>
        )}
      </>}
      {preview && (
        <Modal onClose={() => { URL.revokeObjectURL(preview); setPreview(null); }} label="PDF preview" width={900}>
          <div className="wsb-preview">
            <div className="dhead"><h2 className="headline">Preview <span className="rest">{isProp ? (locked ? "This page now; the client has the PDF that was sent." : "Exactly what the client will read.") : "Exactly what will be signed (the signature spots are invisible markers)."}</span></h2><button className="icon-btn" onClick={() => { URL.revokeObjectURL(preview); setPreview(null); }} aria-label="Close"><X size={18} /></button></div>
            <iframe title="PDF preview" src={preview} />
            <a className="btn ghost sm" href={preview} download={`${doc.title}.pdf`}>Download this preview</a>
          </div>
        </Modal>
      )}
      {asTemplate && <SaveTemplate doc={doc} proposal={isProp} onClose={() => setAsTemplate(false)} onSave={async (name, description) => {
        try { await saveAsTemplate({ name, description, title: doc.title, blocks: doc.page, fields: doc.fields, signers: [], style: doc.style, ...(isProp ? { kind: "proposal" as const } : {}) }); setAsTemplate(false); show(`Saved as the ${isProp ? "proposal " : ""}template "${name}"`); } catch (e) { show(errText(e)); }
      }} />}
      {sending && prop && <SendProposal p={prop} doc={doc} onClose={() => setSending(false)} onSend={onSend} />}
      {contracting && prop && <StartContract p={prop} doc={doc} onClose={() => setContracting(false)} onStart={onStartContract} />}
      {tdrag && <>
        {tdrag.line && <div className="wsb-tdragline" style={{ top: tdrag.line.top - 2, left: tdrag.line.left, width: tdrag.line.width }} />}
        <div className="wsb-tdrag" style={{ left: tdrag.x, top: tdrag.y }}>{tdrag.label}</div>
      </>}
      {menu && editor && <QuickMenu editor={editor} at={menu} accent={st.accent} onClose={() => { setMenu(null); if (editor && !editor.isDestroyed && !isPicking(editor)) editor.view.focus(); }} onMore={() => setTab("format")} onSaveClause={(sec) => void onSaveClause(sec)} />}
      {toast}
    </BuilderCtx.Provider>
  );
}

type LibClause = { _id: string; title: string; body: unknown; initials: boolean };
function ClauseLibrary({ clauses, onInsert, onDragStart, onDragEnd, touchProps }: { clauses: LibClause[] | undefined; onInsert: (c: LibClause) => void; onDragStart: (e: React.DragEvent, c: LibClause) => void; onDragEnd: () => void; touchProps: (c: LibClause) => Record<string, unknown> }) {
  const [q, setQ] = useState("");
  const list = (clauses ?? []).filter((c) => !q || c.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="wsb-lib">
      <div className="wp-listhead"><span className="wp-eyebrow">Clause library</span><ButtonLink variant="ghost" size="sm" to="/sign/templates?tab=clauses">Manage</ButtonLink></div>
      <label className="ws-search"><Icon name="search" size={16} /><input placeholder="Search clauses" aria-label="Search clauses" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {clauses === undefined ? <Spinner /> : list.length === 0 ? <p className="wsb-hint">{clauses.length ? "No clause matches." : "No saved clauses yet. Save one from any clause block."}</p>
        : list.map((c) => <button key={c._id} className="wsb-libitem" draggable onDragStart={(e) => onDragStart(e, c)} onDragEnd={onDragEnd} {...touchProps(c)} onClick={() => onInsert(c)} title="Drag onto the page, or click to add"><span>{c.title}</span>{c.initials && <Chip>Initials</Chip>}</button>)}
    </div>
  );
}


function DetailsPane({ doc, setDoc, extraKeys, mode, proposal, meta, setMeta, total, problems, show }: {
  doc: BuildDoc; setDoc: (f: (d: BuildDoc) => BuildDoc) => void; extraKeys: string[]; mode: "build" | "template"; proposal: boolean; meta: Meta; setMeta: (m: Meta) => void;
  total: ReturnType<typeof totals>; problems: string[]; show: (m: string) => void;
}) {
  const saveProfile = useMutation(api.builder.saveProfile);
  const f = doc.fields;
  const setF = (p: Partial<Fields>) => setDoc((d) => ({ ...d, fields: { ...d.fields, ...p } }));
  const setClient = (k: keyof Fields["client"], v: string) => setF({ client: { ...f.client, [k]: v } });
  const setBiz = (k: keyof Fields["business"], v: string) => setF({ business: { ...f.business, [k]: v } });
  const input = (label: string, value: string, on: (v: string) => void, type = "text", ph = "") => <label className="field"><span className="ws-flabel">{label}</span><input className="input sm" type={type} value={value} placeholder={ph} onChange={(e) => on(e.target.value)} /></label>;
  return (
    <div className="wsb-pane">
      {problems.length > 0 && mode === "build" && <ul className="ws-problems">{problems.map((p) => <li key={p}><TriangleAlert size={13} />{p}</li>)}</ul>}
      {mode === "template" ? <>
        {input("Template name", meta.name, (v) => setMeta({ ...meta, name: v }))}
        {input("Description", meta.description, (v) => setMeta({ ...meta, description: v }))}
        <p className="caption secondary">Client details are filled in on each document made from this template.</p>
      </> : <>
        {input(proposal ? "Proposal title" : "Document title", doc.title, (v) => setDoc((d) => ({ ...d, title: v })))}
        <span className="label">Client</span>
        {input(proposal ? "Name (who it's for)" : "Name (signs as the client)", f.client.name, (v) => setClient("name", v))}
        {input(proposal ? "Email (the proposal link goes here)" : "Email (the signing link goes here)", f.client.email, (v) => setClient("email", v), "email")}
        {input("Company", f.client.company, (v) => setClient("company", v))}
        {input("Phone", f.client.phone, (v) => setClient("phone", v))}
        {input("Address", f.client.address, (v) => setClient("address", v))}
        {extraKeys.map((k) => {
          const s = doc.signers.find((x) => x.key === k) ?? { key: k, name: "", email: "", title: "" };
          const set = (p: Partial<ExtraSigner>) => setDoc((d) => ({ ...d, signers: [...d.signers.filter((x) => x.key !== k), { ...s, ...p }] }));
          return <div key={k} className="wsb-extra"><span className="label">Client {k.replace("client", "")}</span>{input("Name", s.name, (v) => set({ name: v }))}{input("Email", s.email, (v) => set({ email: v }), "email")}{input("Title or company", s.title, (v) => set({ title: v }))}</div>;
        })}
        {input("Date on the document", f.date, (v) => setF({ date: v }), "date")}
      </>}
      {input("Project", f.project, (v) => setF({ project: v }), "text", "e.g. UTT Flagship Film")}
      <div className="field"><span className="ws-flabel">Custom fields</span>
        {f.custom.map((c, i) => (
          <div key={i} className="wsb-custom">
            <input className="input sm" placeholder="name (e.g. shoot.date)" value={c.key} onChange={(e) => setF({ custom: f.custom.map((x, j) => (j === i ? { ...x, key: e.target.value.replace(/[^a-z0-9_.]/gi, "").toLowerCase() } : x)) })} />
            {mode === "build" && <input className="input sm" placeholder="value" value={c.value} onChange={(e) => setF({ custom: f.custom.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />}
            <button className="icon-btn" aria-label="Remove field" onClick={() => setF({ custom: f.custom.filter((_, j) => j !== i) })}><X size={13} /></button>
          </div>
        ))}
        <button className="btn ghost sm" onClick={() => setF({ custom: [...f.custom, { key: "", label: "", value: "" }] })}><Plus size={13} />Add a field</button>
      </div>
      <div className="field"><span className="ws-flabel">Fill-in fields (click to copy)</span><div className="wsb-fields">
        {[...FIELD_HELP, ...f.custom.filter((c) => c.key).map((c) => ({ key: c.key, label: c.key }))].map((x) => <button key={x.key} className="chip" onClick={() => { void navigator.clipboard.writeText(`{${x.key}}`); show(`Copied {${x.key}}`); }} title={x.label}>{`{${x.key}}`}</button>)}
      </div></div>
      {mode === "build" && <div className="wsb-totals"><span>{proposal ? "Investment" : "Total"} <b>{money(total.total)}</b></span>{total.depositPct > 0 && <span>{proposal ? "Deposit to book" : "Deposit"} <b>{money(total.deposit)}</b>{total.invoiceDeposit && !proposal ? " → Stripe draft" : ""}</span>}</div>}
      <span className="label">Your business</span>
      {input("Legal name", f.business.legalName, (v) => setBiz("legalName", v))}
      {input("Doing business as", f.business.name, (v) => setBiz("name", v))}
      {input("Contact (signs for the business)", f.business.contact, (v) => setBiz("contact", v))}
      {input("Title", f.business.title, (v) => setBiz("title", v))}
      {input("Email", f.business.email, (v) => setBiz("email", v))}
      {input("Phone", f.business.phone, (v) => setBiz("phone", v))}
      {input("Address", f.business.address, (v) => setBiz("address", v))}
      <button className="btn ghost sm" onClick={async () => { try { await saveProfile({ business: f.business }); show("Saved as your default business details"); } catch (e) { show(errText(e)); } }}><Check size={13} />Use these for new documents</button>
    </div>
  );
}

function SaveTemplate({ doc, proposal, onClose, onSave }: { doc: BuildDoc; proposal?: boolean; onClose: () => void; onSave: (name: string, description: string) => Promise<void> }) {
  const [name, setName] = useState(doc.title);
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal onClose={onClose} label="Save as template" width={460}>
      <div style={{ display: "grid", gap: 12 }}>
        <h2 className="headline">{proposal ? "Save as a proposal template" : "Save as a template"}</h2>
        <p className="caption secondary">{proposal ? "The sections, wording and style are saved; the client's details and the prices aren't (they come from Settings › Pricing each time)." : "The page, fields and style are saved; the client's details aren't."}</p>
        <label className="field"><span className="ws-flabel">Name</span><input className="input sm" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span className="ws-flabel">Description (optional)</span><input className="input sm" value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!name.trim() || busy} onClick={async () => { setBusy(true); await onSave(name, desc); setBusy(false); }}>{busy ? <Spinner /> : <LayoutTemplate size={15} />}Save template</button></div>
      </div>
    </Modal>
  );
}


// ---------- Phase 3b: the proposal's banner and dialogs ----------

function ProposalBanner({ p, busy, onContract, onLater, onWithdraw, onCopy, onDismiss }: { p: ProposalInfo; busy: string | null; onContract: () => void; onLater: () => void; onWithdraw: () => void; onCopy: () => void; onDismiss: () => void }) {
  const r = p.response;
  if (P_OPEN.has(p.status) && p.drafted === "claude") return (
    <div className="wp-notice warn pr-banner">
      <Icon name="note" size={20} />
      <span className="txt"><b>Drafted by Claude: review before sending</b><span>Claude wrote this from the questionnaire answers. Check every section and every price before you send it.</span></span>
      <button type="button" className="btn ghost sm" onClick={onDismiss}>Dismiss</button>
    </div>
  );
  if (p.status === "accepted" && r) return (
    <div className="wp-notice pr-banner ok">
      <Icon name="check-circle" size={20} />
      <span className="txt"><b>Accepted by {r.name} · {longWhen(r.at)}</b>
        <span>{p.contract ? "The contract draft is in Docs. Nothing has been sent." : "Start the contract? It makes a Service Agreement draft in Docs from this proposal. Nothing is sent."}</span></span>
      {p.contract ? <ButtonLink size="sm" variant="secondary" to={`/sign/b/${p.contract._id}`}>Open the contract</ButtonLink> : <>
        {!p.asked.contract && <button type="button" className="btn ghost sm" onClick={onLater}>Not now</button>}
        <Button size="sm" variant="primary" onClick={onContract}>Start the contract</Button>
      </>}
    </div>
  );
  if (p.status === "declined" && r) return (
    <div className="wp-notice pr-banner">
      <Icon name="info" size={20} />
      <span className="txt"><b>Declined by {r.name} · {longWhen(r.at)}</b><span>{r.reason ? `"${r.reason}"` : "No reason given."}</span></span>
      <Button size="sm" variant="secondary" loading={busy === "copy"} onClick={onCopy}>Make a copy to change</Button>
    </div>
  );
  if (p.status === "sent") return (
    <div className="wp-notice pr-banner">
      <Icon name="send" size={20} />
      <span className="txt"><b>Sent to {p.who.name} · {p.sentAt ? longDay(p.sentAt) : ""}{p.viewedAt ? ` · viewed ${longDay(p.viewedAt)}` : ""}</b>
        <span>Locked: {p.who.name.split(" ")[0] || "the client"} is reading the PDF that was sent. To change it, withdraw it or make a copy.</span></span>
      {p.link && <button type="button" className="btn ghost sm" onClick={() => void navigator.clipboard?.writeText(p.link!)}>Copy link</button>}
      <button type="button" className="btn ghost sm" onClick={onWithdraw}>Withdraw</button>
      <Button size="sm" variant="secondary" loading={busy === "copy"} onClick={onCopy}>Make a copy</Button>
    </div>
  );
  if (p.status === "void") return (
    <div className="wp-notice pr-banner">
      <Icon name="info" size={20} />
      <span className="txt"><b>Withdrawn{p.voidedAt ? ` · ${longDay(p.voidedAt)}` : ""}</b><span>The link says it was withdrawn. Make a copy to change it and send it again.</span></span>
      <Button size="sm" variant="secondary" loading={busy === "copy"} onClick={onCopy}>Make a copy</Button>
    </div>
  );
  return null;
}

function SendProposal({ p, doc, onClose, onSend }: { p: ProposalInfo; doc: BuildDoc; onClose: () => void; onSend: (message: string, move: boolean) => Promise<void> }) {
  const c = doc.fields.client;
  const first = c.name.trim().split(" ")[0] || "the client";
  const [message, setMessage] = useState("");
  const [move, setMove] = useState(false); // D84: unticked; nothing moves on its own
  const [busy, setBusy] = useState(false);
  const company = c.company.trim() || c.name.trim();
  return (
    <Modal onClose={onClose} label="Send the proposal" width={560}>
      <div className="crm-dialog">
        <DialogHeader eyebrow={`Send · ${p.number}`} title={`Send the proposal to ${first}?`} body={`${first} gets an email with a link to read it and press Accept. No account needed.`} onClose={onClose} />
        <div className="wp-field"><span className="wp-field-label">To</span><div className="pr-to"><Icon name="mail" size={16} />{c.name.trim()} · {c.email.trim()}</div></div>
        <TextArea label="Message (optional)" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={`e.g. Hi ${first}, here's our plan. Happy to talk it through.`} />
        <hr className="wp-divider" />
        <Checkbox checked={move} onChange={setMove} label={`Also move ${company} to Quoted in your pipeline`} hint="Only if you tick this. Nothing moves on its own." />
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" loading={busy} onClick={async () => { setBusy(true); await onSend(message, move); setBusy(false); }}>Send proposal</Button>
        </div>
      </div>
    </Modal>
  );
}

function StartContract({ p, doc, onClose, onStart }: { p: ProposalInfo; doc: BuildDoc; onClose: () => void; onStart: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const r = p.response;
  const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <Modal onClose={onClose} label="Start the contract" width={560}>
      <div className="crm-dialog">
        <DialogHeader eyebrow={`Accepted · ${p.number}`} title="Start the contract?" body={`${r?.name ?? p.who.name} accepted the proposal${r ? ` on ${longDay(r.at).replace(/, \d{4}$/, "")}` : ""}. Make a Service Agreement draft in Docs from it? Nothing is sent.`} onClose={onClose} />
        <span className="wp-eyebrow pr-carries">Carries over</span>
        <dl className="crm-dl pr-dl">
          <dt>Client</dt><dd>{[p.who.company, p.who.name].filter(Boolean).join(" · ")}</dd>
          <dt>Project</dt><dd>{doc.fields.project || doc.title}</dd>
          <dt>Line items</dt><dd>{p.money.lines} line{p.money.lines === 1 ? "" : "s"} · {usd(p.money.totalCents)}</dd>
          <dt>Deposit</dt><dd>{p.money.depositPct ? `${p.money.depositPct}% · sets the Stripe draft` : "None"}</dd>
        </dl>
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Not now</button>
          <Button variant="primary" loading={busy} onClick={async () => { setBusy(true); await onStart(); setBusy(false); }}>Start the contract draft</Button>
        </div>
      </div>
    </Modal>
  );
}

/** The Insert panel's Pitch deck part (716:4980) and its dialog (717:4428, D72): Claude makes a Claude Slides deck on
 *  the owner's own computer through the Sign connector, in the business's brand kit or the client's. */
function PitchDeck({ p, show }: { p: ProposalInfo; show: (m: string) => void }) {
  const setDeck = useMutation(api.proposals.setDeck);
  const [open, setOpen] = useState(false);
  const kit = p.deck?.kit ?? (p.client ? "client" : "business");
  const company = p.who.company || p.client?.name || "";
  const poss = company ? `${company}${/s$/i.test(company) ? "'" : "'s"}` : "the client's";
  const whose = kit === "client" ? `${poss} brand kit` : "your brand kit (Settings › Brand kit)";
  const phrase = `Make a pitch deck for proposal ${p.number} in Wrangler Portal`;
  const [note, setNote] = useState(p.deck?.note ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <div className="pr-deck">
      <span className="wp-eyebrow">Pitch deck</span>
      <span className="wsb-hint">Brand kit for the deck</span>
      <span className="pr-kitseg" role="group" aria-label="Brand kit for the deck">
        {(["business", "client"] as const).map((k) => <button key={k} type="button" aria-pressed={kit === k} onClick={() => void setDeck({ proposalId: p._id, kit: k }).catch((e) => show(errText(e)))}>{k === "business" ? "Business" : "Client"}</button>)}
      </span>
      <span className="wsb-hint">Uses {whose}.</span>
      <button type="button" className="btn pr-deckbtn" onClick={() => setOpen(true)}>Make a pitch deck</button>
      <span className="wsb-hint">Claude makes a Claude Slides deck on your computer from this proposal. It exports to PowerPoint or PDF.</span>
      {open && (
        <Modal onClose={() => setOpen(false)} label="Make a pitch deck" width={560}>
          <div className="crm-dialog">
            <DialogHeader eyebrow={`Pitch deck · ${p.number}`} title="Make a pitch deck." body={`Claude makes a Claude Slides deck on your computer, from this proposal, in ${whose}. It exports to PowerPoint or PDF. Say this in your Claude app:`} onClose={() => setOpen(false)} />
            <div className="qz-phrase"><span>“{phrase}”</span><button type="button" className="btn sm" onClick={() => void navigator.clipboard?.writeText(phrase).then(() => show("Copied"), () => show("Couldn't copy"))}>Copy</button></div>
            <span className="wp-eyebrow pr-carries">Claude gets</span>
            <ul className="pr-gets">
              <li><Icon name="check" size={14} plain />The proposal: every section and the investment</li>
              <li><Icon name="check" size={14} plain />{kit === "client" ? poss.replace(/^the/, "The") : "Your"} brand kit: logo, colours, fonts, files, links, tone words</li>
              <li><Icon name="check" size={14} plain />Your note below, if you add one</li>
            </ul>
            <TextArea label="A note for Claude (optional)" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Keep it to 8 slides. Lead with last year's recap." />
            <div className="dfoot">
              <Button variant="primary" loading={busy} onClick={async () => { setBusy(true); try { await setDeck({ proposalId: p._id, kit, note, asked: true }); setOpen(false); } catch (e) { show(errText(e)); } finally { setBusy(false); } }}>Done</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
