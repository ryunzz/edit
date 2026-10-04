import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ffmpegPath, runTool } from "./tools";

export interface ExtractFramesOptions {
  projectRoot: string;
  /** Video file; a relative path resolves against projectRoot. */
  file: string;
  fps: number;
  startSeconds?: number;
  durationSeconds?: number;
}

export interface ExtractedFrames {
  dir: string;
  count: number;
  /** JPEG path for frame `index` (0 = first frame), clamped to [0, count - 1]. */
  frameFile(index: number): string;
}

const inflight = new Map<string, Promise<ExtractedFrames>>();

function frameName(index: number) {
  return `${String(index).padStart(6, "0")}.jpg`;
}

function result(dir: string, count: number): ExtractedFrames {
  return {
    dir,
    count,
    frameFile(index: number) {
      const i = Math.min(Math.max(0, Math.floor(index)), Math.max(0, count - 1));
      return path.join(dir, frameName(i));
    },
  };
}

async function readDone(dir: string): Promise<number | null> {
  try {
    const done = JSON.parse(await readFile(path.join(dir, "done"), "utf8")) as { count?: number };
    return typeof done.count === "number" ? done.count : null;
  } catch {
    return null;
  }
}

/**
 * Extracts every frame of a clip, resampled to `fps`, as JPEGs into
 * <projectRoot>/.edit/cache/frames/<hash>/000000.jpg… Cached by file, mtime, size, fps and range.
 */
export async function extractFrames(options: ExtractFramesOptions): Promise<ExtractedFrames> {
  const root = path.resolve(options.projectRoot);
  const abs = path.resolve(root, options.file);
  const { fps, startSeconds, durationSeconds } = options;
  if (!(fps > 0) || !Number.isFinite(fps)) throw new Error(`Extracting frames from ${abs}: fps must be a positive number (got ${fps}).`);
  if (startSeconds !== undefined && !(startSeconds >= 0))
    throw new Error(`Extracting frames from ${abs}: startSeconds must be >= 0 (got ${startSeconds}).`);
  if (durationSeconds !== undefined && !(durationSeconds > 0))
    throw new Error(`Extracting frames from ${abs}: durationSeconds must be > 0 (got ${durationSeconds}).`);

  let s;
  try {
    s = await stat(abs);
  } catch {
    throw new Error(`Extracting frames from ${abs}: file not found.`);
  }
  const rel = path.relative(root, abs).split(path.sep).join("/");
  const hash = createHash("sha1")
    .update(JSON.stringify([rel, s.mtimeMs, s.size, fps, startSeconds ?? null, durationSeconds ?? null]))
    .digest("hex");
  const framesRoot = path.join(root, ".edit", "cache", "frames");
  const dir = path.join(framesRoot, hash);

  const existing = inflight.get(hash);
  if (existing) return existing;

  const job = (async () => {
    const cached = await readDone(dir);
    if (cached !== null) return result(dir, cached);

    await mkdir(framesRoot, { recursive: true });
    const tmp = path.join(framesRoot, `${hash}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmp, { recursive: true });
    try {
      const args = ["-hide_banner", "-loglevel", "error", "-y"];
      if (startSeconds !== undefined && startSeconds > 0) args.push("-ss", String(startSeconds));
      args.push("-i", abs);
      if (durationSeconds !== undefined) args.push("-t", String(durationSeconds));
      args.push("-map", "0:v:0", "-vf", `fps=${fps}`, "-q:v", "2", "-start_number", "0", path.join(tmp, "%06d.jpg"));
      await runTool(ffmpegPath(), args, { file: abs, action: "Extracting frames from" });

      const count = (await readdir(tmp)).filter((n) => n.endsWith(".jpg")).length;
      if (count === 0) {
        throw new Error(
          `Extracting frames from ${abs}: ffmpeg produced no frames` +
            (startSeconds ? ` (startSeconds ${startSeconds} may be past the end of the clip)` : "") +
            ".",
        );
      }
      await writeFile(path.join(tmp, "done"), JSON.stringify({ count, file: rel, fps, startSeconds, durationSeconds }));

      // A stale, unfinished dir from a crashed run is replaced; a finished one from another process wins.
      if ((await readDone(dir)) !== null) {
        await rm(tmp, { recursive: true, force: true });
        return result(dir, (await readDone(dir))!);
      }
      await rm(dir, { recursive: true, force: true });
      try {
        await rename(tmp, dir);
      } catch (error) {
        const other = await readDone(dir);
        await rm(tmp, { recursive: true, force: true });
        if (other !== null) return result(dir, other);
        throw error;
      }
      return result(dir, count);
    } catch (error) {
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  })();

  inflight.set(hash, job);
  try {
    return await job;
  } finally {
    inflight.delete(hash);
  }
}
