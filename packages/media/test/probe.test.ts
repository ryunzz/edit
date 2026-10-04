import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { listAssets, probe, probeCached } from "../src/index";
import { fixtures } from "./fixtures";

describe("probe", () => {
  const { root, p } = fixtures();

  test("video", async () => {
    const info = await probe(p("clip.mp4"));
    expect(info.kind).toBe("video");
    expect(info.width).toBe(160);
    expect(info.height).toBe(120);
    expect(info.fps).toBe(24);
    expect(info.hasAudio).toBe(true);
    expect(info.codec).toBe("mpeg4");
    expect(info.durationSeconds!).toBeCloseTo(2, 0);
    expect(info.bytes).toBe(statSync(p("clip.mp4")).size);
  });

  test("audio, image, svg, font, other", async () => {
    const audio = await probe(p("click.wav"));
    expect(audio.kind).toBe("audio");
    expect(audio.durationSeconds!).toBeCloseTo(8, 1);
    expect(audio.codec).toBe("pcm_s16le");

    const png = await probe(p("sub/logo.png"));
    expect(png).toMatchObject({ kind: "image", width: 64, height: 48 });

    expect(await probe(p("shape.svg"))).toMatchObject({ kind: "image", format: "svg", width: 300, height: 150 });
    expect(await probe(p("font.woff2"))).toEqual({ kind: "font", bytes: 17, format: "woff2" });
    expect(await probe(p("notes.txt"))).toEqual({ kind: "other", bytes: 5 });
  });

  test("missing file names the file", async () => {
    await expect(probe(p("nope.mp4"))).rejects.toThrow(/nope\.mp4.*not found/);
  });

  test("probeCached writes and reuses the cache, re-probes on change", async () => {
    const first = await probeCached(root, "_assets/sub/logo.png");
    const cacheFile = path.join(root, ".edit/cache/probe.json");
    expect(existsSync(cacheFile)).toBe(true);
    const cache = JSON.parse(readFileSync(cacheFile, "utf8"));
    expect(cache.entries["_assets/sub/logo.png"].info).toEqual(first);

    // a poisoned cache entry with matching mtime/size is returned as-is (proves it is a cache hit)
    cache.entries["_assets/sub/logo.png"].info.width = 999;
    await Bun.write(cacheFile, JSON.stringify(cache));
    expect((await probeCached(root, p("sub/logo.png"))).width).toBe(999);

    // touching the file invalidates it
    const later = new Date(Date.now() + 5000);
    utimesSync(p("sub/logo.png"), later, later);
    expect((await probeCached(root, "_assets/sub/logo.png")).width).toBe(64);
  });

  test("listAssets", async () => {
    const assets = await listAssets(root);
    expect(assets.map((a) => a.name)).toEqual([
      "click.wav",
      "clip.mp4",
      "font.woff2",
      "notes.txt",
      "shape.svg",
      "silence.wav",
      "sub/logo.png",
    ]);
    expect(assets.find((a) => a.name === "clip.mp4")).toMatchObject({ kind: "video", fps: 24 });
    expect(await listAssets(path.join(root, "nowhere"))).toEqual([]);
  });

  test("listAssets keeps going past an unreadable file", async () => {
    const project = mkdtempSync(path.join(os.tmpdir(), "edit-media-bad-"));
    mkdirSync(path.join(project, "_assets"));
    writeFileSync(path.join(project, "_assets", "broken.png"), "x");
    writeFileSync(path.join(project, "_assets", "ok.woff2"), "font");
    const assets = await listAssets(project);
    expect(assets.map((a) => a.name)).toEqual(["broken.png", "ok.woff2"]);
    expect(assets[0]!.error).toContain("broken.png");
    expect(assets[1]!.error).toBeUndefined();
  });
});
