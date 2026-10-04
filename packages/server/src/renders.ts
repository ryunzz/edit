import { listCompositions, readCompositionMeta, RenderCancelled, renderStill, renderVideo, serveFile, type Progress } from "@ryunzz/edit-renderer";
import { OUT_DIR, probeCached, RENDERS_DIR } from "@ryunzz/edit-media";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { HelperContext, Route } from "./helper";

export interface RenderRequest {
  composition: string;
  format?: "mp4" | "png";
  /** "draft" renders at half size. */
  quality?: "final" | "draft";
  /** Inclusive frame range for MP4s. */
  frames?: [number, number];
  /** Frame for PNG stills. */
  frame?: number;
  /** Output path relative to the project, inside _renders/ or __out/. Default: _renders/<id>.mp4, then _v2, _v3… */
  out?: string;
  /** Who asked: "Studio", or the agent's name. */
  startedBy?: string;
}

export interface RenderJob {
  id: string;
  composition: string;
  format: "mp4" | "png";
  quality: "final" | "draft";
  frames?: [number, number];
  frame?: number;
  out: string;
  startedBy: string;
  status: "queued" | "rendering" | "done" | "failed" | "cancelled";
  progress: Progress | null;
  width?: number;
  height?: number;
  fps?: number;
  createdAt: string;
  finishedAt?: string;
  error?: string;
}

export interface RenderFile {
  name: string;
  bytes: number;
  finishedAt: string;
  durationSeconds?: number;
  kind: "video" | "image" | "other";
}

let counter = 0;

/** A one-at-a-time render queue shared by the studio and the agent's tools. */
export class RenderQueue {
  readonly jobs: RenderJob[] = [];
  private controllers = new Map<string, AbortController>();
  private thumbs = new Map<string, Buffer>();
  private running = false;
  private lastSent = 0;

  constructor(private ctx: HelperContext) {}

  private broadcast(force = false) {
    const now = Date.now();
    if (!force && now - this.lastSent < 150) return;
    this.lastSent = now;
    this.ctx.events.send("renders", { jobs: this.jobs });
  }

  private nextOut(id: string, ext: string): string {
    for (let v = 1; ; v++) {
      const name = v === 1 ? `${id}.${ext}` : `${id}_v${v}.${ext}`;
      const rel = `${RENDERS_DIR}/${name}`;
      if (!existsSync(path.join(this.ctx.projectRoot, rel)) && !this.jobs.some((j) => j.out === rel && (j.status === "queued" || j.status === "rendering"))) return rel;
    }
  }

  add(req: RenderRequest): RenderJob {
    if (!listCompositions(this.ctx.projectRoot).includes(req.composition)) {
      throw new Error(`No composition "${req.composition}". Available: ${listCompositions(this.ctx.projectRoot).join(", ") || "none"}`);
    }
    const format = req.format ?? "mp4";
    let out = req.out?.trim();
    if (out) {
      const abs = path.resolve(this.ctx.projectRoot, out);
      const inside = [RENDERS_DIR, OUT_DIR].some((d) => abs.startsWith(path.join(this.ctx.projectRoot, d) + path.sep));
      if (!inside) throw new Error(`Renders are saved inside ${RENDERS_DIR}/ (or ${OUT_DIR}/ for final deliverables)`);
      if (path.extname(abs).toLowerCase() !== `.${format}`) throw new Error(`The file name must end in .${format}`);
      out = path.relative(this.ctx.projectRoot, abs).split(path.sep).join("/");
    } else {
      out = format === "png" ? `${RENDERS_DIR}/${req.composition}-f${req.frame ?? 0}.png` : this.nextOut(req.composition, "mp4");
    }
    const job: RenderJob = {
      id: `r${Date.now().toString(36)}${(counter++).toString(36)}`,
      composition: req.composition,
      format,
      quality: req.quality ?? "final",
      frames: req.frames,
      frame: req.frame,
      out,
      startedBy: req.startedBy ?? "Studio",
      status: "queued",
      progress: null,
      createdAt: new Date().toISOString(),
    };
    this.jobs.push(job);
    this.broadcast(true);
    void this.pump();
    return job;
  }

  /** Cancels a queued or running job, or forgets a finished one. */
  remove(id: string): boolean {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return false;
    if (job.status === "rendering") {
      this.controllers.get(id)?.abort();
    } else {
      this.jobs.splice(this.jobs.indexOf(job), 1);
      this.thumbs.delete(id);
    }
    this.broadcast(true);
    return true;
  }

  get(id: string) {
    return this.jobs.find((j) => j.id === id);
  }

  thumb(id: string) {
    return this.thumbs.get(id);
  }

  /** Resolves when the job finishes, fails or is cancelled. */
  wait(id: string): Promise<RenderJob> {
    return new Promise((resolve) => {
      const check = () => {
        const job = this.get(id);
        if (!job || (job.status !== "queued" && job.status !== "rendering")) resolve(job!);
        else setTimeout(check, 200);
      };
      check();
    });
  }

  private async pump() {
    if (this.running) return;
    const job = this.jobs.find((j) => j.status === "queued");
    if (!job) return;
    this.running = true;
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    job.status = "rendering";
    job.progress = { stage: "capturing", done: 0, total: 0 };
    this.broadcast(true);
    const projectRoot = this.ctx.projectRoot;
    const scale = job.quality === "draft" ? 0.5 : 1;
    try {
      const meta = await readCompositionMeta(projectRoot, job.composition);
      job.width = Math.round(meta.width * scale);
      job.height = Math.round(meta.height * scale);
      job.fps = meta.fps;
      const out = path.join(projectRoot, job.out);
      if (job.format === "png") {
        await renderStill({ projectRoot, id: job.composition, frame: job.frame ?? 0, out, scale, log: this.ctx.log });
      } else {
        let lastThumb = 0;
        await renderVideo({
          projectRoot,
          id: job.composition,
          out,
          frames: job.frames,
          scale,
          signal: controller.signal,
          log: this.ctx.log,
          onProgress: (p) => {
            job.progress = p;
            this.broadcast();
          },
          onFrame: (_f, jpeg) => {
            if (Date.now() - lastThumb > 500) {
              lastThumb = Date.now();
              this.thumbs.set(job.id, jpeg);
            }
          },
        });
      }
      job.status = "done";
      this.ctx.log(`Rendered ${job.out}`);
    } catch (e) {
      if (e instanceof RenderCancelled || controller.signal.aborted) job.status = "cancelled";
      else {
        job.status = "failed";
        job.error = e instanceof Error ? e.message : String(e);
        this.ctx.log(`Render of ${job.composition} failed: ${job.error}`);
      }
    } finally {
      job.finishedAt = new Date().toISOString();
      this.controllers.delete(job.id);
      this.running = false;
      this.broadcast(true);
      void this.pump();
    }
  }

  cancelAll() {
    for (const c of this.controllers.values()) c.abort();
  }
}

/** Files in _renders/ (or another project folder, e.g. __out/), newest first. */
export async function listRenderFiles(projectRoot: string, folder: string = RENDERS_DIR): Promise<RenderFile[]> {
  const dir = path.join(projectRoot, folder);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const files = await Promise.all(
    names
      .filter((n) => !n.startsWith("."))
      .map(async (name): Promise<RenderFile | null> => {
        const s = await stat(path.join(dir, name));
        if (!s.isFile()) return null;
        const ext = path.extname(name).toLowerCase();
        const kind: RenderFile["kind"] = ext === ".mp4" || ext === ".mov" || ext === ".webm" ? "video" : ext === ".png" || ext === ".jpg" ? "image" : "other";
        let durationSeconds: number | undefined;
        if (kind === "video") durationSeconds = (await probeCached(projectRoot, path.join(folder, name)).catch(() => null))?.durationSeconds;
        return { name, bytes: s.size, finishedAt: s.mtime.toISOString(), kind, ...(durationSeconds === undefined ? {} : { durationSeconds }) };
      }),
  );
  return files.filter((f): f is RenderFile => f !== null).sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
}

function reveal(file: string) {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", ["-R", file]] : process.platform === "win32" ? ["explorer", [`/select,${file}`]] : ["xdg-open", [path.dirname(file)]];
  spawn(cmd as string, args as string[], { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
}

function parseRequest(body: unknown): RenderRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.composition !== "string") throw new Error("Which composition? Send { composition }");
  const req: RenderRequest = { composition: b.composition };
  if (b.format === "png" || b.format === "mp4") req.format = b.format;
  if (b.quality === "draft" || b.quality === "final") req.quality = b.quality;
  if (Array.isArray(b.frames) && b.frames.length === 2 && b.frames.every((n) => Number.isInteger(n) && (n as number) >= 0)) req.frames = b.frames as [number, number];
  if (Number.isInteger(b.frame)) req.frame = b.frame as number;
  if (typeof b.out === "string" && b.out.trim()) req.out = b.out;
  if (typeof b.startedBy === "string") req.startedBy = b.startedBy.slice(0, 60);
  return req;
}

export function renderRoutes(ctx: HelperContext, queue: RenderQueue): Route {
  return async (req, res, url) => {
    const p = url.pathname;
    if (req.method === "GET" && p === "/api/renders") {
      ctx.json(res, 200, { jobs: queue.jobs, files: await listRenderFiles(ctx.projectRoot), deliverables: await listRenderFiles(ctx.projectRoot, OUT_DIR) });
      return true;
    }
    if (req.method === "POST" && p === "/api/renders") {
      try {
        ctx.json(res, 200, queue.add(parseRequest(await ctx.readJson(req))));
      } catch (e) {
        ctx.json(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
      return true;
    }
    const job = /^\/api\/renders\/([\w]+)(\/thumb)?$/.exec(p);
    if (job && req.method === "GET" && job[2]) {
      const jpeg = queue.thumb(job[1]!);
      if (!jpeg) res.writeHead(404).end();
      else res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" }).end(jpeg);
      return true;
    }
    if (job && req.method === "GET") {
      const found = queue.get(job[1]!);
      if (found) ctx.json(res, 200, found);
      else ctx.json(res, 404, { error: `No render ${job[1]}` });
      return true;
    }
    if (job && req.method === "DELETE") {
      ctx.json(res, queue.remove(job[1]!) ? 200 : 404, { ok: true });
      return true;
    }
    if (req.method === "POST" && p === "/api/reveal") {
      const body = (await ctx.readJson(req)) as { file?: unknown; folder?: unknown };
      const name = typeof body.file === "string" ? path.basename(body.file) : "";
      const file = path.join(ctx.projectRoot, body.folder === "out" ? OUT_DIR : RENDERS_DIR, name);
      if (!name || !existsSync(file)) return ctx.json(res, 404, { error: "No such render" }), true;
      reveal(file);
      ctx.json(res, 200, { ok: true });
      return true;
    }
    const served = /^\/(renders|out)\/(.+)$/.exec(p);
    if ((req.method === "GET" || req.method === "HEAD") && served) {
      const name = decodeURIComponent(served[2]!);
      if (name && !name.includes("/") && !name.includes("\\") && !name.startsWith(".")) {
        const folder = served[1] === "out" ? OUT_DIR : RENDERS_DIR;
        if (serveFile(req, res, path.join(ctx.projectRoot, folder, name), { "cache-control": "no-cache" })) return true;
      }
    }
    return false;
  };
}
