import { describe, expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { extractFrames } from "../src/index";
import { fixtures } from "./fixtures";

describe("extractFrames", () => {
  const { root } = fixtures();

  test("extracts every frame at the requested fps and caches", async () => {
    const t0 = performance.now();
    const [a, b] = await Promise.all([
      extractFrames({ projectRoot: root, file: "assets/clip.mp4", fps: 30 }),
      extractFrames({ projectRoot: root, file: "assets/clip.mp4", fps: 30 }),
    ]);
    expect(a.dir).toBe(b.dir);
    expect(Math.abs(a.count - 60)).toBeLessThanOrEqual(1);
    expect(a.dir.startsWith(path.join(root, ".edit/cache/frames"))).toBe(true);
    expect(existsSync(a.frameFile(0))).toBe(true);
    expect(existsSync(a.frameFile(a.count - 1))).toBe(true);
    expect(a.frameFile(10_000)).toBe(a.frameFile(a.count - 1));
    expect(statSync(a.frameFile(0)).size).toBeGreaterThan(0);
    const first = performance.now() - t0;

    const t1 = performance.now();
    const again = await extractFrames({ projectRoot: root, file: "assets/clip.mp4", fps: 30 });
    expect(again.count).toBe(a.count);
    expect(again.dir).toBe(a.dir);
    expect(performance.now() - t1).toBeLessThan(Math.max(20, first / 2));
  });

  test("start and duration", async () => {
    const r = await extractFrames({ projectRoot: root, file: "assets/clip.mp4", fps: 10, startSeconds: 0.5, durationSeconds: 1 });
    expect(Math.abs(r.count - 10)).toBeLessThanOrEqual(1);
  });

  test("missing file", async () => {
    await expect(extractFrames({ projectRoot: root, file: "assets/none.mp4", fps: 30 })).rejects.toThrow(/none\.mp4/);
  });
});
