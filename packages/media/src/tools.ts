import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** ffmpeg binary: EDIT_FFMPEG_PATH or "ffmpeg" on PATH. */
export function ffmpegPath(): string {
  return process.env.EDIT_FFMPEG_PATH || "ffmpeg";
}

/**
 * ffprobe binary: EDIT_FFPROBE_PATH, else the ffprobe next to EDIT_FFMPEG_PATH when that is set
 * and the sibling exists, else "ffprobe" on PATH.
 */
export function ffprobePath(): string {
  if (process.env.EDIT_FFPROBE_PATH) return process.env.EDIT_FFPROBE_PATH;
  const ffmpeg = process.env.EDIT_FFMPEG_PATH;
  if (ffmpeg && (ffmpeg.includes("/") || ffmpeg.includes("\\"))) {
    const base = path.basename(ffmpeg).replace(/ffmpeg/i, "ffprobe");
    const sibling = path.join(path.dirname(ffmpeg), base === path.basename(ffmpeg) ? "ffprobe" : base);
    if (existsSync(sibling)) return sibling;
  }
  return "ffprobe";
}

export interface RunResult {
  stdout: Buffer;
  stderr: string;
}

/**
 * Runs a tool and collects stdout as a Buffer (streamed, so there is no maxBuffer limit).
 * Rejects with a message naming the tool, the file being worked on and ffmpeg's own stderr.
 */
export function runTool(bin: string, args: string[], context: { file: string; action: string }): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => chunks.push(d));
    proc.stderr.on("data", (d: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += d.toString();
    });
    proc.on("error", (err: NodeJS.ErrnoException) => {
      const name = path.basename(bin).startsWith("ffprobe") ? "ffprobe" : "ffmpeg";
      const env = name === "ffprobe" ? "EDIT_FFPROBE_PATH" : "EDIT_FFMPEG_PATH";
      if (err.code === "ENOENT") {
        reject(
          new Error(
            `${context.action} ${context.file}: ${name} was not found ("${bin}"). Install it (macOS: brew install ffmpeg) or set ${env}.`,
          ),
        );
      } else {
        reject(new Error(`${context.action} ${context.file}: could not start ${name} ("${bin}"): ${err.message}`));
      }
    });
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout: Buffer.concat(chunks), stderr });
      else {
        const detail = stderr.trim().split("\n").slice(-6).join("\n") || `exit code ${code}`;
        reject(new Error(`${context.action} ${context.file} failed (${path.basename(bin)} exited with ${code}):\n${detail}`));
      }
    });
  });
}
