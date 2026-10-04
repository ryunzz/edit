import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export function ffmpegPath(): string {
  return process.env.EDIT_FFMPEG_PATH ?? "ffmpeg";
}

let encoderCache: string[] | null = null;

async function availableEncoders(): Promise<string[]> {
  if (encoderCache) return encoderCache;
  try {
    const { stdout } = await run(ffmpegPath(), ["-hide_banner", "-encoders"], { maxBuffer: 4 * 1024 * 1024 });
    encoderCache = stdout
      .split("\n")
      .map((l) => l.trim().split(/\s+/)[1])
      .filter((n): n is string => Boolean(n));
    return encoderCache;
  } catch {
    throw new Error(
      `ffmpeg was not found ("${ffmpegPath()}"). Install it (macOS: brew install ffmpeg) or set EDIT_FFMPEG_PATH.`,
    );
  }
}

/**
 * Picks an H.264 encoder. The system's hardware encoder comes first (VideoToolbox on macOS),
 * which also works with LGPL ffmpeg builds; libx264 and OpenH264 are fallbacks.
 */
export async function h264Args(width: number, height: number, fps: number): Promise<string[]> {
  const encoders = await availableEncoders();
  const bitrate = `${Math.max(2, Math.round((width * height * fps * 0.2) / 1_000_000))}M`;
  if (process.platform === "darwin" && encoders.includes("h264_videotoolbox")) {
    return ["-c:v", "h264_videotoolbox", "-b:v", bitrate, "-allow_sw", "1"];
  }
  if (encoders.includes("libx264")) return ["-c:v", "libx264", "-preset", "medium", "-crf", "18"];
  if (encoders.includes("libopenh264")) return ["-c:v", "libopenh264", "-b:v", bitrate];
  throw new Error("This ffmpeg has no H.264 encoder (VideoToolbox, libx264 or OpenH264).");
}

export interface Encoder {
  write(frame: Buffer): Promise<void>;
  finish(): Promise<void>;
  abort(): void;
}

/** Starts ffmpeg reading JPEG/PNG frames from stdin and writing an H.264 MP4 with no audio. */
export async function startVideoEncoder(options: {
  out: string;
  width: number;
  height: number;
  fps: number;
}): Promise<Encoder> {
  const codec = await h264Args(options.width, options.height, options.fps);
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "image2pipe",
    "-framerate",
    String(options.fps),
    "-i",
    "-",
    "-vf",
    "pad=ceil(iw/2)*2:ceil(ih/2)*2",
    ...codec,
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    options.out,
  ];
  const proc: ChildProcessWithoutNullStreams = spawn(ffmpegPath(), args);
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d));
  const exited = new Promise<void>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim()}`))));
  });
  exited.catch(() => undefined);

  return {
    write(frame) {
      return new Promise((resolve, reject) => {
        if (!proc.stdin.writable) return reject(new Error(`ffmpeg stopped accepting frames: ${stderr.trim()}`));
        proc.stdin.write(frame, (err) => (err ? reject(err) : resolve()));
      });
    },
    async finish() {
      proc.stdin.end();
      await exited;
    },
    abort() {
      proc.kill("SIGKILL");
    },
  };
}

export interface AudioInput {
  /** File path or URL ffmpeg can read. */
  input: string;
  startSeconds: number;
  durationSeconds: number;
  trimSeconds: number;
  volume: number;
  /** Source playback speed. Default 1. */
  rate?: number;
}

/** Mixes audio clips onto a silent video, copying the video stream. */
export async function muxAudio(options: { video: string; out: string; audio: AudioInput[]; durationSeconds: number }) {
  const inputs = options.audio.flatMap((a) => ["-i", a.input]);
  const chains = options.audio.map((a, i) => {
    const delay = Math.round(a.startSeconds * 1000);
    const rate = a.rate ?? 1;
    // atrim works in source time, so a sped-up clip reads rate × its length.
    const speed = rate === 1 ? "" : `,atempo=${rate}`;
    return `[${i + 1}:a]atrim=start=${a.trimSeconds}:duration=${a.durationSeconds * rate},asetpts=PTS-STARTPTS${speed},volume=${a.volume},adelay=${delay}:all=1[a${i}]`;
  });
  const labels = options.audio.map((_, i) => `[a${i}]`).join("");
  const mix =
    options.audio.length === 1 ? `${labels}anull[aout]` : `${labels}amix=inputs=${options.audio.length}:normalize=0:duration=longest[aout]`;

  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    options.video,
    ...inputs,
    "-filter_complex",
    [...chains, mix].join(";"),
    "-map",
    "0:v",
    "-map",
    "[aout]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-t",
    String(options.durationSeconds),
    "-movflags",
    "+faststart",
    options.out,
  ];
  try {
    await run(ffmpegPath(), args, { maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    const e = error as { stderr?: string };
    throw new Error(`Mixing audio failed: ${e.stderr?.trim() || String(error)}`);
  }
}
