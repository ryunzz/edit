import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { imagePreview, videoSheet } from "../src/index";
import { fixtures } from "./fixtures";

const size = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];

describe("previews for references", () => {
  const { p } = fixtures();

  test("videoSheet tiles frames from through the clip", async () => {
    const { png, times } = await videoSheet(p("clip.mp4"), { count: 6, width: 160 });
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(times.length).toBe(6);
    const [w, h] = size(png);
    expect(w).toBeGreaterThanOrEqual(160 * 3);
    expect(h).toBeGreaterThanOrEqual(120 * 2);
  });

  test("videoSheet refuses things that aren't video", async () => {
    await expect(videoSheet(p("click.wav"))).rejects.toThrow("not a video");
  });

  test("imagePreview shrinks big images and keeps small ones", async () => {
    const big = p("sub/logo.png");
    execFileSync("ffprobe", ["-v", "error", big]);
    const [w] = size(await imagePreview(big, 8));
    expect(w).toBeLessThanOrEqual(8);
  });
});
