#!/usr/bin/env bun
import { defaultConcurrency, findProjectRoot, listCompositions, renderStill, renderVideo } from "@ryunzz/edit-renderer";
import { runMcpServer } from "@ryunzz/edit-mcp";
import { startHelper } from "@ryunzz/edit-server";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { initProject, TEMPLATES, type TemplateName } from "./init";
import path from "node:path";
import { parseArgs } from "node:util";

const HELP = `edit — motion graphics your agent can make

Usage
  edit init <folder> [--template t] Create a project (templates: blank, kinetic, logo)
  edit dev                          Open the studio: live preview, timeline, renders
  edit mcp                          Serve the agent tools over stdio (for .mcp.json)
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
  --port <n>           Port for \`dev\` (default 3210, or the next free one)
  --no-open            Don't open the browser for \`dev\`
  --template <name>    Template for \`init\`: blank, kinetic or logo
  --no-install         Don't install packages after \`init\`
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

async function ask(question: string, fallback: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await rl.question(`${question} (${fallback}): `)).trim() || fallback;
  } finally {
    rl.close();
  }
}

function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  spawn(cmd as string, args as string[], { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
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
      port: { type: "string" },
      "no-open": { type: "boolean" },
      template: { type: "string" },
      "no-install": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  const [command, id] = positionals;
  if (values.help || !command) {
    process.stdout.write(HELP);
    return;
  }

  const log = (m: string) => process.stderr.write(`${m}\n`);

  if (command === "init") {
    const dir = id ?? (process.stdin.isTTY ? await ask("Project folder name", "my-video") : undefined);
    if (!dir) fail("Where? Usage: edit init <folder> [--template blank|kinetic|logo]");
    let template = values.template as TemplateName | undefined;
    if (template && !(template in TEMPLATES)) fail(`Unknown template "${template}". Pick one of: ${Object.keys(TEMPLATES).join(", ")}`);
    if (!template && process.stdin.isTTY) {
      const names = Object.keys(TEMPLATES) as TemplateName[];
      log("\nTemplates");
      names.forEach((n, i) => log(`  ${i + 1}. ${TEMPLATES[n].title.padEnd(14)} ${TEMPLATES[n].about}`));
      const pick = await ask("Template", "1");
      template = names[Number(pick) - 1] ?? (names.includes(pick as TemplateName) ? (pick as TemplateName) : undefined);
      if (!template) fail(`Pick 1–${names.length}`);
    }
    template ??= "blank";
    const result = initProject({ dir, template, install: !values["no-install"], log });
    const rel = path.relative(process.cwd(), result.root) || ".";
    if (result.existing) {
      log(result.created.length ? `Added to ${rel}: ${result.created.join(", ")}` : `${rel} already has everything.`);
    } else {
      log(`\nCreated ${rel} from the ${TEMPLATES[template].title.toLowerCase()} template.\n`);
      log(`Next:\n  cd ${rel}\n  edit dev        # opens the studio\n  claude          # in another terminal; or Codex, Cursor…\n`);
      log(`Then ask: "${TEMPLATES[template].prompt}"\n`);
    }
    return;
  }

  const projectRoot = findProjectRoot(values.project ?? process.cwd());
  const scale = values.scale === undefined ? undefined : Number(values.scale);
  if (scale !== undefined && !(scale > 0 && scale <= 4)) fail(`--scale must be between 0 and 4, got "${values.scale}"`);

  switch (command) {
    case "dev": {
      const helper = await startHelper({ projectRoot, port: int(values.port, "port"), log });
      log(`\n  \x1b[1medit\x1b[0m studio for ${path.basename(projectRoot)}\n\n  ${helper.studioUrl}\n\n  Edits to compositions/ show up live. Press Ctrl+C to stop.\n`);
      if (!values["no-open"]) openBrowser(helper.studioUrl);
      const stop = async () => {
        await helper.close();
        process.exit(0);
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      await new Promise(() => {});
      return;
    }

    case "mcp": {
      // stdout carries the MCP protocol; anything else goes to stderr.
      await runMcpServer({ projectRoot });
      return;
    }

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
