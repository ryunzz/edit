import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { detail, KindIcon, type Asset, type DropProps } from "./Assets";
import { Icon } from "./icons";

interface RefLink {
  url: string;
  note: string;
  platform: string;
}

/**
 * The REFS section of the bin: references the agent takes inspiration from but never puts in
 * the video. Drop images or clips on it, drag a link in from another tab, or paste one.
 */
export function Refs({ version, drop, onAddLink }: { version: number; drop: DropProps; onAddLink(url: string, note: string): Promise<boolean> }) {
  const [files, setFiles] = useState<Asset[]>([]);
  const [links, setLinks] = useState<RefLink[]>([]);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const load = () =>
    api.get<{ files: Asset[]; links: RefLink[] }>("/api/refs").then((r) => {
      setFiles(r.files);
      setLinks(r.links);
    }, () => undefined);
  useEffect(() => void load(), [version]);

  const active = drop.over === "refs";
  const failed = drop.error?.target === "refs" ? drop.error.message : null;

  return (
    <div className={`refs${active ? " drop-over" : ""}`} data-drop="refs">
      <div className="panel-header">
        <span className="panel-title">Refs</span>
        <span className="muted" style={{ fontSize: 11 }}>
          inspiration only
        </span>
        <span className="grow" />
        <span className="muted">{files.length + links.length}</span>
      </div>
      <ul className="list refs-list">
        {files.map((f) => (
          <li key={f.name} className="row" title={`_refs/${f.name}`}>
            {f.kind === "image" ? <img className="ref-thumb" src={`/refs/${encodeURIComponent(f.name)}`} alt="" /> : <KindIcon kind={f.kind} />}
            <a className="name" href={`/refs/${encodeURIComponent(f.name)}`} target="_blank" rel="noreferrer">
              {f.name}
            </a>
            <span className="grow" />
            <span className="meta">{detail(f)}</span>
          </li>
        ))}
        {links.map((l) => (
          <li key={l.url} className="row link-row">
            <span className="platform">{l.platform}</span>
            <a className="name" href={l.url} target="_blank" rel="noreferrer" title={l.url}>
              {l.note || l.url.replace(/^https?:\/\/(www\.)?/, "")}
            </a>
            <span className="grow" />
            <button
              type="button"
              className="remove"
              aria-label={`Remove ${l.url}`}
              onClick={() => void api.del(`/api/refs/links?url=${encodeURIComponent(l.url)}`).then(load, () => undefined)}
            >
              ×
            </button>
          </li>
        ))}
        {drop.uploading
          .filter((u) => u.target === "refs")
          .map((u) => (
            <li key={`up-${u.name}`} className="row">
              <Icon.upload />
              <span className="name">{u.name}</span>
              <span className="grow" />
              <span className="meta">uploading</span>
            </li>
          ))}
      </ul>
      <form
        className="link-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!url.trim()) return;
          void onAddLink(url.trim(), note.trim()).then((ok) => {
            if (ok) {
              setUrl("");
              setNote("");
              void load();
            }
          });
        }}
      >
        <input type="url" placeholder="Paste a YouTube, TikTok or Instagram link" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Reference link" />
        {url && <input type="text" placeholder="What to take from it (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note for the agent" />}
        <div className="link-actions">
          <button type="button" className="btn small" onClick={() => input.current?.click()}>
            Add files
          </button>
          <span className={failed ? "err" : "muted"} style={{ fontSize: 12 }}>
            {active ? "Drop to add to _refs/" : (failed ?? "Or drop images, clips or links here")}
          </span>
          <span className="grow" />
          {url && (
            <button type="submit" className="btn small">
              Add link
            </button>
          )}
        </div>
      </form>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void drop.addFiles("refs", Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </div>
  );
}
