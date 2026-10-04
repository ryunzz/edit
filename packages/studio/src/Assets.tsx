import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { bytes, clock } from "./format";
import { Icon } from "./icons";

export interface Asset {
  name: string;
  kind: "image" | "audio" | "video" | "font" | "other";
  bytes: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  error?: string;
}

function detail(a: Asset): string {
  if (a.error) return "unreadable";
  if ((a.kind === "audio" || a.kind === "video") && a.durationSeconds) return clock(a.durationSeconds);
  if (a.kind === "image" && a.width && a.height) return `${a.width}×${a.height}`;
  if (a.kind === "font") return "font";
  return bytes(a.bytes);
}

function KindIcon({ kind }: { kind: Asset["kind"] }) {
  if (kind === "audio") return <Icon.audio />;
  if (kind === "image") return <Icon.image />;
  if (kind === "video") return <Icon.composition />;
  return <Icon.file />;
}

async function upload(file: File): Promise<string> {
  const res = await fetch(`/api/assets/${encodeURIComponent(file.name)}`, { method: "PUT", body: file });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Upload of ${file.name} failed`);
  return body.name as string;
}

/** The ASSETS half of the bin: what's in assets/, plus drag-and-drop uploads anywhere on the page. */
export function Assets({ version }: { version: number }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [uploading, setUploading] = useState<string[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<Asset[]>("/api/assets").then(setAssets, () => undefined);
  }, [version]);

  const add = async (files: File[]) => {
    setFailed(null);
    setUploading((u) => [...u, ...files.map((f) => f.name)]);
    for (const f of files) {
      try {
        await upload(f);
      } catch (e) {
        setFailed(e instanceof Error ? e.message : String(e));
      } finally {
        setUploading((u) => u.filter((n) => n !== f.name));
      }
    }
    api.get<Asset[]>("/api/assets").then(setAssets, () => undefined);
  };

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void add(Array.from(e.dataTransfer!.files));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return (
    <>
      <div className="panel-header">
        <span className="panel-title">Assets</span>
        <span className="grow" />
        <span className="muted">{assets.length}</span>
      </div>
      <ul className="list assets">
        {assets.map((a) => (
          <li key={a.name} className="row" title={a.error ?? `asset("${a.name}")`}>
            <KindIcon kind={a.kind} />
            <span className="name">{a.name}</span>
            <span className="grow" />
            <span className={`meta${a.error ? " bad" : ""}`}>{detail(a)}</span>
          </li>
        ))}
        {uploading.map((n) => (
          <li key={`up-${n}`} className="row">
            <Icon.upload />
            <span className="name">{n}</span>
            <span className="grow" />
            <span className="meta">uploading</span>
          </li>
        ))}
      </ul>
      <button type="button" className={`dropzone${dragging ? " active" : ""}`} onClick={() => input.current?.click()}>
        <Icon.upload />
        <span>{dragging ? "Drop to add to assets/" : "Drop images, audio or video"}</span>
        <span className="muted" style={{ fontSize: 12 }}>
          {failed ?? "Saved to assets/ on this computer"}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void add(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </>
  );
}
