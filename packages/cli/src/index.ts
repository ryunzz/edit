#!/usr/bin/env bun
import { defaultConcurrency, findProjectRoot, listCompositions, renderStill, renderVideo } from "@ryunzz/edit-renderer";
import path from "node:path";
import { parseArgs } from "node:util";

const HELP = `edit — motion graphics your agent can make

Usage
  edit compositions                 List the compositions in this project
  edit still <id> [options]         Render one frame to PNG
  edit render <id> [options]        Render a composition to MP4

Options
  --frame <n>          Frame for \`still\` (default 0)
  --frames <a-b>       Frame range for \`render\`, inclusive (default: all)
  --out <path>         Output file (default: renders/<id>.mp4 or renders/<id>-f<n>.png)
  --scale <n>          Resolution multiplier, e.g. 0.5 for a draft (default 1)
  --concurrency <n>    Browser tabs rendering in parallel (default ${defaultConcurrency()})
  --project <dir>      Project folder (default: nearest folder with compositions/)
  -h, --help           Show this help
`;

function fail(message: string): never {
  process.stderr.write(`\x1b[31merror\x1b[0m ${message}\n`);
  process.exit(1);
}

function int(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) fail(`--${name} must be a whole number, got "${value}"`);
  return n;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      frame: { type: "string" },
      frames: { type: "string" },
      out: { type: "string" },
      scale: { type: "string" },
      concurrency: { type: "string" },
      project: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  const [command, id] = positionals;
  if (values.help || !command) {
    process.stdout.write(HELP);
    return;
  }

  const projectRoot = findProjectRoot(values.project ?? process.cwd());
  const log = (m: string) => process.stderr.write(`${m}\n`);
  const scale = values.scale === undefined ? undefined : Number(values.scale);
  if (scale !== undefined && !(scale > 0 && scale <= 4)) fail(`--scale must be between 0 and 4, got "${values.scale}"`);

  switch (command) {
    case "compositions": {
      const ids = listCompositions(projectRoot);
      process.stdout.write(ids.length ? `${ids.join("\n")}\n` : "No compositions yet. Add a .tsx file to compositions/.\n");
      return;
    }

    case "still": {
      if (!id) fail("Which composition? Usage: edit still <id> [--frame n]");
      const frame = int(values.frame, "frame") ?? 0;
      const out = path.resolve(values.out ?? path.join(projectRoot, "renders", `${id}-f${frame}.png`));
      const started = performance.now();
      const result = await renderStill({ projectRoot, id, frame, out, scale, log });
      log(`Rendered frame ${result.frame} of ${id} in ${Math.round(performance.now() - started)}ms`);
      process.stdout.write(`${path.relative(process.cwd(), result.out) || result.out}\n`);
      return;
    }

    case "render": {
      if (!id) fail("Which composition? Usage: edit render <id>");
      let frames: [number, number] | undefined;
      if (values.frames) {
        const m = /^(\d+)-(\d+)$/.exec(values.frames);
        if (!m) fail(`--frames must look like 0-89, got "${values.frames}"`);
        frames = [Number(m[1]), Number(m[2])];
      }
      const out = path.resolve(values.out ?? path.join(projectRoot, "renders", `${id}.mp4`));
      const started = performance.now();
      const isTTY = process.stderr.isTTY;
      const result = await renderVideo({
        projectRoot,
        id,
        out,
        frames,
        scale,
        concurrency: int(values.concurrency, "concurrency"),
        log,
        onProgress: (p) => {
          const line = p.stage === "capturing" ? `Rendering frames ${p.done}/${p.total}` : p.stage === "encoding" ? "Encoding…" : "Mixing audio…";
          if (isTTY) process.stderr.write(`\r\x1b[K${line}`);
          else if (p.stage !== "capturing" || p.done === p.total || p.done % 30 === 0) log(line);
        },
      });
      if (isTTY) process.stderr.write("\r\x1b[K");
      const seconds = (performance.now() - started) / 1000;
      log(`Rendered ${result.frames} frames of ${id} in ${seconds.toFixed(1)}s (${(result.frames / seconds).toFixed(1)} fps)`);
      process.stdout.write(`${path.relative(process.cwd(), result.out) || result.out}\n`);
      return;
    }

    default:
      fail(`Unknown command "${command}". Run edit --help.`);
  }
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
