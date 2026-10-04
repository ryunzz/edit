import path from "node:path";
import { probe } from "./probe";
import { ffmpegPath, runTool } from "./tools";

/**
 * A grid of frames spread evenly through a video, as one PNG: a cheap way for an agent to
 * see what a reference clip looks like (palette, framing, type, pacing).
 */
export async function videoSheet(file: string, options: { count?: number; width?: number } = {}): Promise<{ png: Buffer; times: number[] }> {
  const count = Math.max(1, Math.min(options.count ?? 9, 16));
  const width = options.width ?? 400;
  const info = await probe(file);
  const duration = info.durationSeconds ?? 0;
  if (info.kind !== "video" || duration <= 0) throw new Error(`${path.basename(file)} is not a video ffmpeg can read`);
  const cols = count <= 3 ? count : count <= 4 ? 2 : count <= 9 ? 3 : 4;
  const rows = Math.ceil(count / cols);
  // Sample the middle of each slice so the first black frame and the last fade are skipped.
  const times = Array.from({ length: count }, (_, i) => +(((i + 0.5) * duration) / count).toFixed(2));
  const select = times.map((t) => `lt(prev_pts*TB\\,${t})*gte(pts*TB\\,${t})`).join("+");
  const { stdout } = await runTool(
    ffmpegPath(),
    ["-v", "error", "-i", file, "-vf", `select='${select}',scale=${width}:-2,tile=${cols}x${rows}:padding=6:color=0x0f0f11`, "-frames:v", "1", "-vsync", "vfr", "-f", "image2pipe", "-c:v", "png", "-"],
    { file: path.basename(file), action: "Making a frame grid of" },
  );
  return { png: stdout, times };
}

/** A still image scaled to fit `maxSize` pixels, as PNG. For showing large reference images to an agent. */
export async function imagePreview(file: string, maxSize = 1280): Promise<Buffer> {
  const { stdout } = await runTool(
    ffmpegPath(),
    ["-v", "error", "-i", file, "-vf", `scale='min(${maxSize},iw)':'min(${maxSize},ih)':force_original_aspect_ratio=decrease`, "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "-"],
    { file: path.basename(file), action: "Scaling" },
  );
  return stdout;
}
