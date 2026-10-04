import type { CompositionMeta } from "@ryunzz/edit-core";
import type { AudioClip, TimelineClip } from "@ryunzz/edit-core/runtime";
import { copyFile, mkdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Browser, Page } from "puppeteer-core";
import { launchBrowser } from "./browser";
import { bundleComposition } from "./bundle";
import { muxAudio, startVideoEncoder, type AudioInput } from "./ffmpeg";
import { assetFile, compositionPath } from "./project";
import { serveComposition, type CompositionServer } from "./server";

export type Log = (message: string) => void;

interface FramePage {
  page: Page;
  capture(frame: number, type: "png" | "jpeg", quality?: number): Promise<Buffer>;
  audio(): Promise<AudioClip[]>;
}

interface Session {
  meta: CompositionMeta;
  first: FramePage;
  newPage(): Promise<FramePage>;
  close(): Promise<void>;
}

async function openPage(browser: Browser, url: string, scale: number): Promise<{ framePage: FramePage; meta: CompositionMeta }> {
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e instanceof Error ? e.message : String(e)));
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });
  await page.goto(url, { waitUntil: "load" });
  try {
    await page.waitForFunction(() => window.__edit || window.__editMountError, { timeout: 15_000 });
  } catch {
    throw new Error(`The composition did not start.${pageErrors.length ? `\n${pageErrors.join("\n")}` : ""}`);
  }
  const mountError = await page.evaluate(() => window.__editMountError);
  if (mountError) throw new Error(mountError);
  const meta = (await page.evaluate(() => window.__edit!.meta)) as CompositionMeta;
  await page.setViewport({ width: meta.width, height: meta.height, deviceScaleFactor: scale });

  const framePage: FramePage = {
    page,
    async capture(frame, type, quality) {
      try {
        await page.evaluate((f) => window.__edit!.setFrame(f), frame);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message.replace(/^Error:\s*/, ""));
      }
      const shot = await page.screenshot({
        type,
        quality: type === "jpeg" ? (quality ?? 92) : undefined,
        omitBackground: type === "png",
        clip: { x: 0, y: 0, width: meta.width, height: meta.height },
      });
      return Buffer.from(shot);
    },
    audio: () => page.evaluate(() => window.__edit!.audio()) as Promise<AudioClip[]>,
  };
  return { framePage, meta };
}

async function openSession(options: { projectRoot: string; id: string; scale?: number; log?: Log }): Promise<Session> {
  const scale = options.scale ?? 1;
  const file = compositionPath(options.projectRoot, options.id);
  const { js } = await bundleComposition({ projectRoot: options.projectRoot, compositionFile: file, id: options.id, mode: "render" });
  const server: CompositionServer = await serveComposition(options.projectRoot, js);
  let browser: Browser | undefined;
  try {
    browser = await launchBrowser(options.log);
    const { framePage, meta } = await openPage(browser, server.url, scale);
    const b = browser;
    return {
      meta,
      first: framePage,
      newPage: async () => (await openPage(b, server.url, scale)).framePage,
      close: async () => {
        await b.close().catch(() => undefined);
        await server.close();
      },
    };
  } catch (error) {
    await browser?.close().catch(() => undefined);
    await server.close();
    throw error;
  }
}

export interface StillOptions {
  projectRoot: string;
  id: string;
  frame?: number;
  out: string;
  scale?: number;
  log?: Log;
}

/** Renders one frame to a PNG. */
export async function renderStill(options: StillOptions): Promise<{ out: string; meta: CompositionMeta; frame: number }> {
  const session = await openSession(options);
  try {
    const frame = options.frame ?? 0;
    const png = await session.first.capture(frame, "png");
    await mkdir(path.dirname(options.out), { recursive: true });
    await writeFile(options.out, png);
    return { out: options.out, meta: session.meta, frame };
  } finally {
    await session.close();
  }
}

export interface CompositionInfo {
  id: string;
  meta: CompositionMeta;
  clips: TimelineClip[];
  /** Runtime errors seen while visiting every frame, each with its first frame. */
  errors: string[];
}

/** Loads a composition headlessly and returns its settings and read-only timeline. */
export async function inspectComposition(options: { projectRoot: string; id: string; log?: Log }): Promise<CompositionInfo> {
  const session = await openSession(options);
  try {
    const { clips, errors } = (await session.first.page.evaluate(() => window.__edit!.timeline())) as {
      clips: TimelineClip[];
      errors: string[];
    };
    return { id: options.id, meta: session.meta, clips, errors };
  } finally {
    await session.close();
  }
}

export interface Progress {
  stage: "capturing" | "encoding" | "mixing";
  done: number;
  total: number;
}

export interface VideoOptions {
  projectRoot: string;
  id: string;
  out: string;
  /** Inclusive frame range. Default: the whole composition. */
  frames?: [number, number];
  concurrency?: number;
  scale?: number;
  log?: Log;
  onProgress?: (p: Progress) => void;
}

export function defaultConcurrency(): number {
  return Math.max(1, Math.min(8, Math.floor(os.availableParallelism() / 2)));
}

async function moveFile(from: string, to: string) {
  try {
    await rename(from, to);
  } catch {
    await copyFile(from, to);
    await unlink(from);
  }
}

/** Renders frames in parallel tabs, encodes them with ffmpeg and mixes in the audio. */
export async function renderVideo(options: VideoOptions): Promise<{ out: string; meta: CompositionMeta; frames: number }> {
  const session = await openSession(options);
  const { meta } = session;
  const scale = options.scale ?? 1;
  const start = options.frames?.[0] ?? 0;
  const end = options.frames?.[1] ?? meta.durationInFrames - 1;
  if (start < 0 || end >= meta.durationInFrames || start > end) {
    await session.close();
    throw new Error(`Frame range ${start}–${end} is outside 0–${meta.durationInFrames - 1}`);
  }
  const total = end - start + 1;
  const tmpDir = path.join(options.projectRoot, ".edit", "tmp", `${options.id}-${process.pid}-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  await mkdir(path.dirname(options.out), { recursive: true });
  const silent = path.join(tmpDir, "video.mp4");

  const encoder = await startVideoEncoder({
    out: silent,
    width: Math.round(meta.width * scale),
    height: Math.round(meta.height * scale),
    fps: meta.fps,
  });

  try {
    const concurrency = Math.min(options.concurrency ?? defaultConcurrency(), total);
    const pages = [session.first, ...(await Promise.all(Array.from({ length: concurrency - 1 }, () => session.newPage())))];

    let next = start;
    let writeIndex = start;
    const ready = new Map<number, Buffer>();
    let writing = Promise.resolve();
    const flush = async () => {
      while (ready.has(writeIndex)) {
        const buf = ready.get(writeIndex)!;
        ready.delete(writeIndex);
        await encoder.write(buf);
        writeIndex++;
        options.onProgress?.({ stage: "capturing", done: writeIndex - start, total });
      }
    };

    await Promise.all(
      pages.map(async (p) => {
        for (;;) {
          const frame = next++;
          if (frame > end) return;
          ready.set(frame, await p.capture(frame, "jpeg", 92));
          writing = writing.then(flush);
          await writing;
        }
      }),
    );
    await writing;
    options.onProgress?.({ stage: "encoding", done: total, total });
    await encoder.finish();

    // Union of the audio every tab saw: each tab only mounts the sequences it drew.
    const clips = new Map<string, AudioClip>();
    for (const p of pages) {
      for (const c of await p.audio()) clips.set(`${c.src}|${c.startFrame}|${c.trimStart}`, c);
    }
    const audio: AudioInput[] = [];
    for (const c of clips.values()) {
      const from = Math.max(c.startFrame, start);
      const to = Math.min(c.endFrame, end + 1);
      if (to <= from) continue;
      const input = assetFile(options.projectRoot, c.src) ?? c.src;
      const rate = c.rate ?? 1;
      audio.push({
        input,
        startSeconds: (from - start) / meta.fps,
        durationSeconds: (to - from) / meta.fps,
        trimSeconds: (c.trimStart + (from - c.startFrame) * rate) / meta.fps,
        volume: c.volume,
        rate,
      });
    }

    if (audio.length) {
      options.onProgress?.({ stage: "mixing", done: total, total });
      await muxAudio({ video: silent, out: options.out, audio, durationSeconds: total / meta.fps });
    } else {
      await moveFile(silent, options.out);
    }
    return { out: options.out, meta, frames: total };
  } catch (error) {
    encoder.abort();
    throw error;
  } finally {
    await session.close();
    await rm(tmpDir, { recursive: true, force: true });
  }
}
