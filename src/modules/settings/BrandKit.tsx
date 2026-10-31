// Brand kit (Phase 3b, D71): Settings › Brand kit (708:1235) and the company page's Brand kit tab (718:7694).
// Logo, colours, fonts, reference files, links and tone words; Claude uses it to make a pitch deck in that look.
// Uploads: 25 MB a file, 20 files (D90). The business's logos and accent/background come from Settings › Business.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, Card, Divider, ListRow, SectionHead, SkeletonRows } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { linkProps } from "../../lib/router";
import { errText } from "../docs/pages/common";

const TONE = ["Cinematic", "Direct", "Warm", "Playful", "Premium", "Bold", "Calm", "Technical", "Community", "Minimal", "Gritty", "Luxurious"];
// A short list of Google Fonts to pick from; any other name can be typed (or a font file uploaded below).
const GOOGLE_FONTS = ["Inter", "Roboto", "Open Sans", "Montserrat", "Poppins", "Lato", "Oswald", "Raleway", "Playfair Display", "Merriweather", "Bebas Neue", "Anton",
  "DM Sans", "DM Serif Display", "Work Sans", "Space Grotesk", "Archivo", "Archivo Black", "Barlow", "Barlow Condensed", "Manrope", "Sora", "Syne", "Outfit",
  "Libre Baskerville", "Cormorant Garamond", "EB Garamond", "Lora", "Source Serif 4", "IBM Plex Sans", "IBM Plex Mono", "JetBrains Mono", "Chivo", "Rubik", "Fraunces", "Instrument Serif"];
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const typeWord = (t: string, name: string) => (/pdf/.test(t) ? "PDF" : /^image\//.test(t) ? "Image" : /font|ttf|otf|woff/.test(t + name) ? "Font" : /presentation|keynote|pptx?$/.test(t + name) ? "Deck" : (name.split(".").pop() ?? "File").toUpperCase());

export function BrandKitEditor({ clientId, show }: { clientId?: Id<"clients">; show: (m: string) => void }) {
  const kit = useQuery(api.brandKit.get, clientId ? { clientId } : {});
  const save = useMutation(api.brandKit.save);
  const uploadUrl = useMutation(api.brandKit.uploadUrl);
  const addFile = useMutation(api.brandKit.addFile);
  const removeFile = useMutation(api.brandKit.removeFile);
  type Draft = { colors: Array<{ hex: string; name?: string }>; fonts: { heading?: string; body?: string }; links: Array<{ url: string; label?: string }>; tone: string[] };
  const [d, setD] = useState<Draft | null>(null);
  const [newLink, setNewLink] = useState(""), [newWord, setNewWord] = useState(""), [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false), [uploading, setUploading] = useState<string | null>(null), [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null), logoInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (kit && !d) setD({ colors: kit.colors, fonts: kit.fonts, links: kit.links, tone: kit.tone }); }, [kit, d]);
  if (!kit || !d) return <Card label="Loading"><SkeletonRows n={4} /></Card>;
  const dirty = JSON.stringify(d) !== JSON.stringify({ colors: kit.colors, fonts: kit.fonts, links: kit.links, tone: kit.tone });
  const up = (p: Partial<Draft>) => setD({ ...d, ...p });
  const tones = [...new Set([...TONE, ...d.tone])];
  const upload = async (files: FileList | File[], logo = false) => {
    for (const f of Array.from(files)) {
      if (f.size > kit.limits.bytes) { show(`${f.name} is ${mb(f.size)}. The limit is 25 MB; link to big files (like videos) instead.`); continue; }
      setUploading(f.name);
      try {
        const url = await uploadUrl(clientId ? { clientId } : {});
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": f.type || "application/octet-stream" }, body: f });
        if (!res.ok) throw new Error("The upload didn't finish. Try again.");
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        const r = await addFile({ ...(clientId ? { clientId } : {}), storageId, name: f.name, ...(logo ? { logo: true } : {}) });
        show(r.error ?? (logo ? "Logo added." : `${f.name} added.`));
      } catch (e) { show(errText(e)); } finally { setUploading(null); }
    }
  };
  const onSave = async () => {
    setBusy(true);
    try { await save({ ...(clientId ? { clientId } : {}), ...d }); show("Brand kit saved."); setD(null); } catch (e) { show(errText(e)); } finally { setBusy(false); }
  };
  const addLink = () => { const u = newLink.trim(); if (!u) return; up({ links: [...d.links, { url: u }] }); setNewLink(""); };
  return (
    <div className="bk">
      <Card label="Logo" head={<SectionHead label="Logo" />}>
        {kit.kind === "business" ? (
          <div className="bk-pad">
            <div className="bk-logos">
              <div><span className="wp-field-label">On dark</span><div className="bk-logo dark">{kit.logo.dark ? <img src={kit.logo.dark} alt="Logo on dark" /> : <span className="wp-small">Not set</span>}</div></div>
              <div><span className="wp-field-label">On light</span><div className="bk-logo light">{kit.logo.light ? <img src={kit.logo.light} alt="Logo on light" /> : <span className="wp-small">Not set</span>}</div></div>
            </div>
            <p className="rt-note nopad">From Settings › Business. <a {...linkProps("/settings/business")}>Change them there.</a></p>
          </div>
        ) : kit.logo.dark ? (
          <div className="bk-pad bk-row"><div className="bk-logo dark"><img src={kit.logo.dark} alt={`${kit.name} logo`} /></div><span className="sp" />
            <Button size="sm" onClick={() => logoInput.current?.click()}>Replace</Button>
            {kit.logo.fileId && <Button size="sm" variant="ghost" onClick={() => void removeFile({ clientId: clientId!, fileId: kit.logo.fileId!, logo: true }).then(() => show("Logo removed."), (e) => show(errText(e)))}>Remove</Button>}</div>
        ) : (
          <div className="bk-pad"><button type="button" className="bk-drop" onClick={() => logoInput.current?.click()}><Icon name="upload" size={14} />Drop a logo (SVG or PNG), or <b>browse</b></button></div>
        )}
        <input ref={logoInput} type="file" hidden accept="image/svg+xml,image/png,image/jpeg,image/webp" onChange={(e) => { if (e.target.files) void upload(e.target.files, true); e.target.value = ""; }} />
      </Card>

      <Card label="Colours" head={<SectionHead label="Colours" count={kit.fixedColors.length + d.colors.length} />}>
        <div className="bk-pad">
          <div className="bk-swatches">
            {kit.fixedColors.map((c) => <span key={c.name} className="bk-swatch fixed" title={`${c.name}, from Settings › Business`}><i style={{ background: c.hex }} />{c.hex.toUpperCase()}</span>)}
            {d.colors.map((c, i) => (
              <span key={i} className="bk-swatch">
                <input type="color" aria-label={`Colour ${i + 1}`} value={/^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : "#000000"} onChange={(e) => up({ colors: d.colors.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)) })} />
                <input className="hex" aria-label={`Colour ${i + 1} hex`} value={c.hex} onChange={(e) => up({ colors: d.colors.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)) })} />
                <button type="button" aria-label="Remove colour" onClick={() => up({ colors: d.colors.filter((_, j) => j !== i) })}><Icon name="close" size={12} /></button>
              </span>
            ))}
          </div>
          {kit.kind === "business" && <p className="rt-note nopad">Accent and background come from Settings › Business. Add any others your decks use.</p>}
          <button type="button" className="rt-add" onClick={() => up({ colors: [...d.colors, { hex: "#FFFFFF" }] })}><Icon name="plus" size={14} />Add colour</button>
        </div>
      </Card>

      <Card label="Fonts" head={<SectionHead label="Fonts" />}>
        <div className="bk-pad">
          <div className="rt-two">
            {(["heading", "body"] as const).map((k) => (
              <label key={k} className="wp-field"><span className="wp-field-label">{k === "heading" ? "Headings" : "Body"}</span>
                <input className="input" list="bk-fonts" value={d.fonts[k] ?? ""} placeholder={kit.kind === "company" ? "Not set" : k === "heading" ? "Heading font" : "Body font"} onChange={(e) => up({ fonts: { ...d.fonts, [k]: e.target.value } })} /></label>
            ))}
          </div>
          <datalist id="bk-fonts">{[...GOOGLE_FONTS, ...kit.files.filter((f) => /font|ttf|otf|woff/i.test(f.type + f.name)).map((f) => f.name.replace(/\.[a-z0-9]+$/i, ""))].map((f) => <option key={f} value={f} />)}</datalist>
          <p className="rt-note nopad">Pick from Google Fonts or upload font files below.</p>
        </div>
      </Card>

      <Card label="Reference files" head={<SectionHead label="Reference files" count={kit.files.length} />}>
        {kit.files.map((f, i) => (
          <div key={f.fileId} className="wp-rowwrap">{i > 0 && <Divider />}
            <ListRow className="ilead" lead={{ icon: "document" }} title={f.url ? <a href={f.url} target="_blank" rel="noreferrer">{f.name}</a> : f.name}
              meta={`${typeWord(f.type, f.name)} · ${mb(f.size)} · ${f.source ?? "added"} ${new Date(f.addedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
              action={<Button size="sm" onClick={() => void removeFile({ ...(clientId ? { clientId } : {}), fileId: f.fileId }).then(() => show("Removed."), (e) => show(errText(e)))}>Remove</Button>} />
          </div>
        ))}
        <div className="bk-pad">
          <button type="button" className={`bk-drop${drag ? " over" : ""}`} disabled={!!uploading || kit.files.length >= kit.limits.files} onClick={() => fileInput.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); void upload(e.dataTransfer.files); }}>
            <Icon name="upload" size={14} />{uploading ? `Uploading ${uploading}…` : kit.files.length >= kit.limits.files ? "This kit is full (20 files). Remove one, or add a link." : <>Drop files (PDF, images, fonts, decks), or <b>browse</b></>}
          </button>
          <p className="rt-note nopad">Up to 20 files, 25 MB each. Link videos instead.</p>
          <input ref={fileInput} type="file" hidden multiple onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
        </div>
      </Card>

      <Card label="Links" head={<SectionHead label="Links" count={d.links.length} />}>
        {d.links.map((l, i) => (
          <div key={i} className="wp-rowwrap">{i > 0 && <Divider />}
            <ListRow className="ilead" lead={{ icon: "globe" }} title={l.url.replace(/^https?:\/\//, "")} meta={l.label || "Link"} action={<Button size="sm" onClick={() => up({ links: d.links.filter((_, j) => j !== i) })}>Remove</Button>} />
          </div>
        ))}
        <div className="bk-pad bk-row">
          <input className="input" value={newLink} onChange={(e) => setNewLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }} placeholder="Paste a link (website, Instagram, a video you like)" aria-label="Add a link" />
          <Button onClick={addLink} disabled={!newLink.trim()}>Add</Button>
        </div>
      </Card>

      <Card label="Tone words" head={<SectionHead label="Tone words" count={d.tone.length} />}>
        <div className="bk-pad">
          <div className="bk-tones">
            {tones.map((t) => <button type="button" key={t} className={`bk-tone${d.tone.includes(t) ? " on" : ""}`} aria-pressed={d.tone.includes(t)} onClick={() => up({ tone: d.tone.includes(t) ? d.tone.filter((x) => x !== t) : [...d.tone, t] })}>{t}</button>)}
          </div>
          {adding ? (
            <span className="bk-row"><input className="input" autoFocus value={newWord} onChange={(e) => setNewWord(e.target.value)} placeholder="A word"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (newWord.trim()) up({ tone: [...d.tone, newWord.trim()] }); setNewWord(""); setAdding(false); } if (e.key === "Escape") setAdding(false); }} /></span>
          ) : <button type="button" className="rt-add" onClick={() => setAdding(true)}><Icon name="plus" size={14} />Add a word</button>}
        </div>
      </Card>

      <div className="bk-save">
        <Button variant="primary" loading={busy} disabled={!dirty} onClick={() => void onSave()}>Save</Button>
        {dirty && <button type="button" className="btn ghost" onClick={() => setD(null)}>Discard</button>}
      </div>
    </div>
  );
}
