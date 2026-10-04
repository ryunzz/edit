import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function ffmpeg(args: string[]) {
  execFileSync(process.env.EDIT_FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
}

function build() {
  const root = mkdtempSync(path.join(tmpdir(), "edit-media-"));
  const assets = path.join(root, "assets");
  mkdirSync(path.join(assets, "sub"), { recursive: true });
  const p = (name: string) => path.join(assets, name);

  // 120 BPM click track: a decaying 1 kHz burst every 0.5 s for 8 s.
  ffmpeg([
    "-f", "lavfi",
    "-i", "aevalsrc=sin(2*PI*1000*t)*exp(-mod(t\\,0.5)*60)*lt(mod(t\\,0.5)\\,0.08):s=44100:d=8",
    "-c:a", "pcm_s16le", p("click.wav"),
  ]);
  ffmpeg(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "4", "-c:a", "pcm_s16le", p("silence.wav")]);
  ffmpeg([
    "-f", "lavfi", "-i", "testsrc=size=160x120:rate=24:duration=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:v", "mpeg4", "-q:v", "5", "-c:a", "aac", "-shortest", p("clip.mp4"),
  ]);
  ffmpeg(["-f", "lavfi", "-i", "color=c=red:size=64x48", "-frames:v", "1", p("sub/logo.png")]);
  writeFileSync(p("shape.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150"><rect width="10" height="10"/></svg>');
  writeFileSync(p("font.woff2"), "not really a font");
  writeFileSync(p("notes.txt"), "hello");
  writeFileSync(p(".DS_Store"), "x");
  return { root, assets, p };
}

let cached: ReturnType<typeof build> | null = null;

/** Builds the fixture project once per test process (ffmpeg-generated media in a temp dir). */
export function fixtures() {
  cached ??= build();
  return cached;
}
