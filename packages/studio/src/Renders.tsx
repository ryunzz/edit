import { useEffect, useState } from "react";
import { api, type CompositionEntry } from "./api";
import { bytes } from "./format";

export interface RenderJob {
  id: string;
  composition: string;
  format: "mp4" | "png";
  quality: "final" | "draft";
  out: string;
  startedBy: string;
  status: "queued" | "rendering" | "done" | "failed" | "cancelled";
  progress: { stage: "capturing" | "encoding" | "mixing"; done: number; total: number } | null;
  width?: number;
  height?: number;
  fps?: number;
  error?: string;
}

interface RenderFile {
  name: string;
  bytes: number;
  finishedAt: string;
  durationSeconds?: number;
  kind: "video" | "image" | "other";
}

const STAGE = { capturing: "Capturing frames", encoding: "Encoding", mixing: "Mixing audio" };

function length(file: RenderFile): string {
  if (file.kind === "image") return "still";
  if (file.durationSeconds === undefined) return bytes(file.bytes);
  const s = file.durationSeconds;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(Math.floor(s) % 60)}.${Math.floor((s % 1) * 10)}`;
}

function time(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString();
}

function Thumb({ job, background }: { job: RenderJob; background?: string }) {
  const [n, setN] = useState(0);
  useEffect(() => setN((x) => x + 1), [job.progress?.done]);
  return (
    <div className="thumb" style={{ background: background ?? "var(--panel-000)" }}>
      {job.status === "rendering" && (job.progress?.done ?? 0) > 0 && <img src={`/api/renders/${job.id}/thumb?n=${n}`} alt="" />}
    </div>
  );
}

function FileTable({ title, hint, folder, files, empty }: { title: string; hint: string; folder: "out" | "renders"; files: RenderFile[]; empty: string }) {
  return (
    <>
      <div className="panel-header" style={{ borderTop: "1px solid var(--line)" }}>
        <span className="panel-title">{title}</span>
        <span className="muted mono" style={{ fontSize: 11 }}>
          {hint}
        </span>
      </div>
      <div className="table-wrap">
        <table className="files">
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col">Length</th>
              <th scope="col">Finished</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.name}>
                <td className="mono">{f.name}</td>
                <td className="mono muted">{length(f)}</td>
                <td className="muted">{time(f.finishedAt)}</td>
                <td className="actions">
                  <a className="btn" href={`/${folder}/${encodeURIComponent(f.name)}`} target="_blank" rel="noreferrer">
                    {f.kind === "video" ? "Play" : "Open"}
                  </a>{" "}
                  <button type="button" className="btn" onClick={() => void api.post("/api/reveal", { file: f.name, folder })}>
                    Show in folder
                  </button>
                </td>
              </tr>
            ))}
            {files.length === 0 && (
              <tr>
                <td colSpan={4} className="empty">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function Renders({
  compositions,
  jobs,
  current,
  refreshKey,
}: {
  compositions: CompositionEntry[];
  jobs: RenderJob[];
  current: string;
  refreshKey: number;
}) {
  const [files, setFiles] = useState<RenderFile[]>([]);
  const [deliverables, setDeliverables] = useState<RenderFile[]>([]);
  const [composition, setComposition] = useState(current);
  const [format, setFormat] = useState<"mp4" | "png">("mp4");
  const [quality, setQuality] = useState<"final" | "draft">("final");
  const [range, setRange] = useState("");
  const [out, setOut] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setComposition((c) => c || current), [current]);
  useEffect(() => {
    api.get<{ files: RenderFile[]; deliverables: RenderFile[] }>("/api/renders").then((r) => {
      setFiles(r.files);
      setDeliverables(r.deliverables ?? []);
    }, () => undefined);
  }, [refreshKey, jobs.filter((j) => j.status === "done").length]);

  const active = jobs.filter((j) => j.status !== "done");
  const bg = (id: string) => compositions.find((c) => c.id === id)?.meta?.background;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const body: Record<string, unknown> = { composition, format, quality };
    const r = range.trim();
    if (r && r.toLowerCase() !== "all frames") {
      const m = /^(\d+)\s*[-–]\s*(\d+)$/.exec(r);
      const single = /^\d+$/.exec(r);
      if (format === "png" && single) body.frame = Number(r);
      else if (format === "mp4" && m) body.frames = [Number(m[1]), Number(m[2])];
      else return setError(format === "png" ? "Range for a still is one frame number, like 54" : "Range looks like 0-89, or leave it empty for all frames");
    }
    if (out.trim()) body.out = out.trim();
    try {
      await api.post("/api/renders", body);
      setOut("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="workspace renders">
      <main className="panel center">
        <div className="panel-header">
          <span className="panel-title">Queue</span>
        </div>
        <ul className="list queue">
          {active.map((job) => {
            const pct = job.progress && job.progress.total ? Math.round((job.progress.done / job.progress.total) * 100) : 0;
            return (
              <li key={job.id} className="job">
                <Thumb job={job} background={bg(job.composition)} />
                <div className="job-body">
                  <div className="job-title">
                    <span className="name">{job.composition}</span>
                    <span className="mono muted" style={{ fontSize: 11 }}>
                      {job.format.toUpperCase()}
                      {job.width ? ` · ${job.width}×${job.height} · ${job.fps} fps` : ""}
                      {job.quality === "draft" ? " · draft" : ""}
                    </span>
                  </div>
                  {job.status === "rendering" && (
                    <div className="bar" role="progressbar" aria-label={`Rendering ${job.composition}`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                      <div style={{ width: `${job.progress?.stage === "capturing" ? pct : 100}%` }} />
                    </div>
                  )}
                  <div className="job-status muted">
                    {job.status === "rendering" && job.progress && (
                      <>
                        {job.progress.total > 0 && <span className="mono">frame {job.progress.done} / {job.progress.total}</span>}
                        <span>{STAGE[job.progress.stage]}</span>
                      </>
                    )}
                    {job.status === "queued" && <span>Queued</span>}
                    {job.status === "cancelled" && <span>Cancelled</span>}
                    {job.status === "failed" && <span className="err">Failed: {job.error}</span>}
                    <span>Started by {job.startedBy}</span>
                    <span className="mono">{job.out}</span>
                  </div>
                </div>
                <button type="button" className="btn" onClick={() => void api.del(`/api/renders/${job.id}`)}>
                  {job.status === "rendering" ? "Cancel" : "Remove"}
                </button>
              </li>
            );
          })}
          {active.length === 0 && <li className="empty">Nothing rendering. Add a render here, click Render in the studio, or ask your agent.</li>}
        </ul>

        <FileTable title="Deliverables" hint="__out/ · final files only" folder="out" files={deliverables} empty="Final deliverables go in __out/. Ask your agent to put the finished video there." />
        <FileTable title="Working renders" hint="_renders/ · drafts and checks" folder="renders" files={files} empty="Drafts, stills and checks land in _renders/." />
      </main>

      <aside className="panel side" aria-label="Render settings">
        <div className="panel-header">
          <span className="panel-title">New render</span>
        </div>
        <form className="form" onSubmit={(e) => void submit(e)}>
          <label>
            <span className="muted">Composition</span>
            <select value={composition} onChange={(e) => setComposition(e.target.value)}>
              {compositions.map((c) => (
                <option key={c.id}>{c.id}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="muted">Format</span>
            <select value={format} onChange={(e) => setFormat(e.target.value as "mp4" | "png")}>
              <option value="mp4">MP4 (H.264)</option>
              <option value="png">PNG still</option>
            </select>
          </label>
          <label>
            <span className="muted">Quality</span>
            <select value={quality} onChange={(e) => setQuality(e.target.value as "final" | "draft")}>
              <option value="final">Final</option>
              <option value="draft">Draft (half size)</option>
            </select>
          </label>
          <label>
            <span className="muted">{format === "png" ? "Frame" : "Range"}</span>
            <input type="text" value={range} placeholder={format === "png" ? "0" : "All frames"} onChange={(e) => setRange(e.target.value)} />
          </label>
          <label>
            <span className="muted">Save as</span>
            <input type="text" className="mono" value={out} placeholder={`_renders/${composition || "id"}.${format}`} onChange={(e) => setOut(e.target.value)} />
          </label>
          <button type="submit" className="btn primary big" disabled={!composition}>
            Add to queue
          </button>
          <span className={error ? "err" : "muted"} style={{ fontSize: 12 }}>
            {error ?? "Renders run on this computer. Your agent can start them too."}
          </span>
        </form>
      </aside>
    </div>
  );
}
