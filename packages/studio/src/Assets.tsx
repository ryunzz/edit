import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { DropTarget } from "./Drop";
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

export function detail(a: Asset): string {
  if (a.error) return "unreadable";
  if ((a.kind === "audio" || a.kind === "video") && a.durationSeconds) return clock(a.durationSeconds);
  if (a.kind === "image" && a.width && a.height) return `${a.width}×${a.height}`;
  if (a.kind === "font") return "font";
  return bytes(a.bytes);
}

export function KindIcon({ kind }: { kind: Asset["kind"] }) {
  if (kind === "audio") return <Icon.audio />;
  if (kind === "image") return <Icon.image />;
  if (kind === "video") return <Icon.composition />;
  return <Icon.file />;
}

export interface DropProps {
  over: DropTarget | null;
  uploading: { name: string; target: DropTarget }[];
  error: { target: DropTarget; message: string } | null;
  addFiles(target: DropTarget, files: File[]): Promise<void>;
}

/** The ASSETS section of the bin: material for the video, in _assets/. Drop files anywhere to add them. */
export function Assets({ version, drop }: { version: number; drop: DropProps }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<Asset[]>("/api/assets").then(setAssets, () => undefined);
  }, [version]);

  const active = drop.over === "assets";
  const failed = drop.error?.target === "assets" ? drop.error.message : null;
  return (
    <>
      <div className="panel-header">
        <span className="panel-title">Assets</span>
        <span className="muted" style={{ fontSize: 11 }}>
          for the video
        </span>
        <span className="grow" />
        <span className="muted">{assets.length}</span>
      </div>
      <ul className={`list assets${active ? " drop-over" : ""}`}>
        {assets.map((a) => (
          <li key={a.name} className="row" title={a.error ?? `asset("${a.name}")`}>
            <KindIcon kind={a.kind} />
            <span className="name">{a.name}</span>
            <span className="grow" />
            <span className={`meta${a.error ? " bad" : ""}`}>{detail(a)}</span>
          </li>
        ))}
        {drop.uploading
          .filter((u) => u.target === "assets")
          .map((u) => (
            <li key={`up-${u.name}`} className="row">
              <Icon.upload />
              <span className="name">{u.name}</span>
              <span className="grow" />
              <span className="meta">uploading</span>
            </li>
          ))}
      </ul>
      <button type="button" className={`dropzone${active ? " active" : ""}`} onClick={() => input.current?.click()}>
        <Icon.upload />
        <span>{active ? "Drop to add to _assets/" : "Drop images, audio or video"}</span>
        <span className={failed ? "err" : "muted"} style={{ fontSize: 12 }}>
          {failed ?? "Material the video can use, saved to _assets/"}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void drop.addFiles("assets", Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </>
  );
}
