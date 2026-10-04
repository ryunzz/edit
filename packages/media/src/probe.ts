import { mkdir, readFile, rename, stat, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { ffprobePath, runTool } from "./tools";

export type MediaKind = "image" | "audio" | "video" | "font" | "other";

export interface MediaInfo {
  kind: MediaKind;
  bytes: number;
  /** Container/format name, e.g. "mov,mp4,m4a,3gp,3g2,mj2", "png_pipe", "svg", "woff2". */
  format?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio?: boolean;
  /** Codec of the main stream (video stream for video/image, audio stream for audio). */
  codec?: string;
  /** Set by listAssets when the file could not be read; the other fields are then partial. */
  error?: string;
}

const FONT = new Set([".woff2", ".woff", ".ttf", ".otf"]);
const IMAGE = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);
const AUDIO = new Set([".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac"]);
const VIDEO = new Set([".mp4", ".mov", ".webm", ".m4v", ".mkv"]);

export function kindFromExtension(file: string): MediaKind {
  const ext = path.extname(file).toLowerCase();
  if (FONT.has(ext)) return "font";
  if (ext === ".svg" || IMAGE.has(ext)) return "image";
  if (AUDIO.has(ext)) return "audio";
  if (VIDEO.has(ext)) return "video";
  return "other";
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  disposition?: { attached_pic?: number };
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { format_name?: string; duration?: string };
}

/** Parses "30000/1001" or "25" into a number; undefined for "0/0" and junk. */
export function parseRate(rate: string | undefined): number | undefined {
  if (!rate) return undefined;
  const [num, den] = rate.split("/");
  const n = Number(num);
  const d = den === undefined ? 1 : Number(den);
  if (!Number.isFinite(n) || !Number.isFinite(d) || n <= 0 || d <= 0) return undefined;
  return Math.round((n / d) * 1000) / 1000;
}

function num(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

async function statFile(file: string) {
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error(`Cannot probe ${file}: it is not a file.`);
    return s;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Cannot probe ${file}: file not found.`);
    throw error;
  }
}

function svgLength(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(value);
  return m ? Number(m[1]) : undefined;
}

/** Reads width/height (or the viewBox size) from the root <svg> element. */
export function parseSvgSize(text: string): { width?: number; height?: number } {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!tag) return {};
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];
  let width = svgLength(attr("width"));
  let height = svgLength(attr("height"));
  const viewBox = attr("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (viewBox && viewBox.length === 4 && viewBox.every(Number.isFinite)) {
    const [, , vw, vh] = viewBox as [number, number, number, number];
    if (width === undefined && height === undefined) {
      width = vw;
      height = vh;
    } else if (width === undefined && height !== undefined && vh > 0) {
      width = (height * vw) / vh;
    } else if (height === undefined && width !== undefined && vw > 0) {
      height = (width * vh) / vw;
    }
  }
  const out: { width?: number; height?: number } = {};
  if (width !== undefined) out.width = Math.round(width);
  if (height !== undefined) out.height = Math.round(height);
  return out;
}

async function ffprobe(file: string): Promise<FfprobeOutput> {
  const { stdout } = await runTool(
    ffprobePath(),
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
    { file, action: "Probing" },
  );
  try {
    return JSON.parse(stdout.toString("utf8")) as FfprobeOutput;
  } catch {
    throw new Error(`Probing ${file}: ffprobe returned output that is not JSON.`);
  }
}

/** Describes a media file. Fonts, SVGs and unknown extensions are handled without ffprobe. */
export async function probe(file: string): Promise<MediaInfo> {
  const s = await statFile(file);
  const kind = kindFromExtension(file);
  const ext = path.extname(file).toLowerCase();
  const bytes = s.size;

  if (kind === "font") return { kind, bytes, format: ext.slice(1) };
  if (kind === "other") return { kind, bytes };
  if (ext === ".svg") {
    const text = await readFile(file, "utf8");
    return { kind, bytes, format: "svg", ...parseSvgSize(text) };
  }

  const data = await ffprobe(file);
  const streams = data.streams ?? [];
  const video = streams.find((st) => st.codec_type === "video" && !st.disposition?.attached_pic);
  const anyVideo = video ?? streams.find((st) => st.codec_type === "video");
  const audio = streams.find((st) => st.codec_type === "audio");
  const info: MediaInfo = { kind, bytes };
  if (data.format?.format_name) info.format = data.format.format_name;

  if (kind === "image") {
    if (!anyVideo || !anyVideo.width || !anyVideo.height)
      throw new Error(`Probing ${file}: ffprobe could not read an image size; the file may be corrupt or not a ${ext} image.`);
    if (anyVideo.width) info.width = anyVideo.width;
    if (anyVideo.height) info.height = anyVideo.height;
    if (anyVideo.codec_name) info.codec = anyVideo.codec_name;
    return info;
  }

  const duration = num(data.format?.duration) ?? num(video?.duration) ?? num(audio?.duration);
  if (duration !== undefined) info.durationSeconds = duration;

  if (kind === "audio") {
    if (!audio) throw new Error(`Probing ${file}: ffprobe found no audio stream.`);
    if (audio.codec_name) info.codec = audio.codec_name;
    return info;
  }

  // video
  if (!video) throw new Error(`Probing ${file}: ffprobe found no video stream${audio ? " (only audio)" : ""}.`);
  if (video.width) info.width = video.width;
  if (video.height) info.height = video.height;
  const fps = parseRate(video.avg_frame_rate) ?? parseRate(video.r_frame_rate);
  if (fps !== undefined) info.fps = fps;
  info.hasAudio = Boolean(audio);
  if (video.codec_name) info.codec = video.codec_name;
  return info;
}

// ---- cache -------------------------------------------------------------------------------

interface CacheEntry {
  mtimeMs: number;
  size: number;
  info: MediaInfo;
}

interface CacheFile {
  version: 1;
  entries: Record<string, CacheEntry>;
}

function cachePath(projectRoot: string) {
  return path.join(projectRoot, ".edit", "cache", "probe.json");
}

async function readCache(projectRoot: string): Promise<CacheFile> {
  try {
    const parsed = JSON.parse(await readFile(cachePath(projectRoot), "utf8")) as CacheFile;
    if (parsed && parsed.version === 1 && parsed.entries && typeof parsed.entries === "object") return parsed;
  } catch {
    // missing or corrupt: start over
  }
  return { version: 1, entries: {} };
}

/** Writes are serialised per cache file within this process; across processes the rename is atomic. */
const writeChains = new Map<string, Promise<void>>();

function updateCache(projectRoot: string, updates: Record<string, CacheEntry>): Promise<void> {
  const target = cachePath(projectRoot);
  const prev = writeChains.get(target) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      const cache = await readCache(projectRoot); // re-read to merge other writers
      Object.assign(cache.entries, updates);
      await mkdir(path.dirname(target), { recursive: true });
      const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      await writeFile(tmp, JSON.stringify(cache, null, 1));
      try {
        await rename(tmp, target);
      } catch (error) {
        await unlink(tmp).catch(() => undefined);
        throw error;
      }
    });
  writeChains.set(target, next);
  return next;
}

function cacheKey(projectRoot: string, abs: string) {
  return path.relative(projectRoot, abs).split(path.sep).join("/");
}

/** Probes several files (relative paths resolve against projectRoot), reusing and updating the cache. */
export async function probeManyCached(projectRoot: string, files: string[], options: { tolerant?: boolean } = {}): Promise<MediaInfo[]> {
  const root = path.resolve(projectRoot);
  const cache = await readCache(root);
  const updates: Record<string, CacheEntry> = {};
  const results: MediaInfo[] = new Array(files.length);
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      const abs = path.resolve(root, files[i]!);
      const s = await statFile(abs);
      const key = cacheKey(root, abs);
      const hit = cache.entries[key];
      if (hit && hit.mtimeMs === s.mtimeMs && hit.size === s.size) {
        results[i] = hit.info;
        continue;
      }
      let info: MediaInfo;
      try {
        info = await probe(abs);
      } catch (error) {
        if (!options.tolerant) throw error;
        // Not cached, so a fixed file is picked up on the next call.
        results[i] = { kind: kindFromExtension(abs), bytes: s.size, error: error instanceof Error ? error.message : String(error) };
        continue;
      }
      updates[key] = { mtimeMs: s.mtimeMs, size: s.size, info };
      results[i] = info;
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, files.length) }, worker));
  if (Object.keys(updates).length > 0) await updateCache(root, updates);
  return results;
}

/**
 * Like probe(), cached in <projectRoot>/.edit/cache/probe.json keyed by the path relative to
 * projectRoot; re-probes when the file's mtime or size changes. A relative `file` resolves
 * against projectRoot.
 */
export async function probeCached(projectRoot: string, file: string): Promise<MediaInfo> {
  const [info] = await probeManyCached(projectRoot, [file]);
  return info!;
}
