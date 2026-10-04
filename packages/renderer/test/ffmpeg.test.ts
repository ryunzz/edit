import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startVideoEncoder } from "../src/ffmpeg";

describe("startVideoEncoder", () => {
  test("encodes small plain-colour JPEG frames (ffmpeg can't probe those from a pipe)", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "edit-ffmpeg-"));
    const jpg = path.join(dir, "flat.jpg");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0xf3ede1:size=480x270", "-frames:v", "1", "-q:v", "2", jpg]);
    const frame = readFileSync(jpg);
    const out = path.join(dir, "out.mp4");
    const encoder = await startVideoEncoder({ out, width: 480, height: 270, fps: 30, frameFormat: "jpeg" });
    for (let i = 0; i < 10; i++) await encoder.write(frame);
    await encoder.finish();
    const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height", "-of", "csv=p=0", out]).toString().trim();
    expect(probe).toBe("h264,480,270");
    rmSync(dir, { recursive: true, force: true });
  });
});
