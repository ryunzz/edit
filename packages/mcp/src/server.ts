import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { analyzeAudio, listAssets } from "@ryunzz/edit-media";
import {
  assetFile,
  inspectComposition,
  listCompositions,
  readCompositionMeta,
  renderContactSheet,
  renderFrames,
  renderVideo,
  type Progress,
} from "@ryunzz/edit-renderer";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { agentName, callHelper, findHelper, logActivity, readState, writeState } from "./project";

const text = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

const failure = (e: unknown): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
});

const pad = (n: number) => String(n).padStart(2, "0");
const timecode = (frame: number, fps: number) => {
  const s = Math.floor(frame / fps);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(frame - Math.round(s * fps))}`;
};

interface LocalJob {
  id: string;
  composition: string;
  out: string;
  status: "rendering" | "done" | "failed";
  progress: Progress | null;
  error?: string;
}

export interface McpOptions {
  projectRoot: string;
  /** Overrides the client's reported name in the activity feed. */
  agent?: string;
}

/** Builds the MCP server with every edit tool registered. */
export function createEditServer(options: McpOptions): McpServer {
  const { projectRoot } = options;
  const server = new McpServer(
    { name: "edit", version: "0.0.1" },
    {
      instructions:
        "Tools for the edit motion graphics project in this folder. Compositions are React components in compositions/*.tsx, " +
        "driven by useFrame(). Write or edit them with your file tools; the studio reloads live. Then use render_contact_sheet " +
        "or render_frame to look at the result, get_errors to catch problems, and render_video for the final MP4. " +
        "See AGENTS.md in the project for the API and rules.",
    },
  );
  const agent = () => options.agent ?? agentName(server.server.getClientVersion()?.name);
  const jobs = new Map<string, LocalJob>();

  // The studio shows "<agent> connected" while this process is alive; refreshed on every call.
  const touch = () => writeState(projectRoot, "agent.json", { name: agent(), pid: process.pid, at: new Date().toISOString() }).catch(() => undefined);
  server.server.oninitialized = () => void touch();
  const tool: typeof server.registerTool = (name, config, handler) =>
    server.registerTool(name, config, ((...args: unknown[]) => {
      void touch();
      return (handler as (...a: unknown[]) => unknown)(...args);
    }) as typeof handler);

  const defaultFps = async () => {
    const first = listCompositions(projectRoot)[0];
    if (!first) return 30;
    return (await readCompositionMeta(projectRoot, first).catch(() => null))?.fps ?? 30;
  };

  tool(
    "list_compositions",
    {
      title: "List compositions",
      description: "Every composition in compositions/ with its size, fps and length. Compositions that fail to build are listed with their error.",
      inputSchema: {},
    },
    async () => {
      const ids = listCompositions(projectRoot);
      if (!ids.length) return text("No compositions yet. Create compositions/<id>.tsx exporting `meta` and a default component.");
      const out = await Promise.all(
        ids.map(async (id) => {
          try {
            const m = await readCompositionMeta(projectRoot, id);
            return { id, width: m.width, height: m.height, fps: m.fps, durationInFrames: m.durationInFrames, seconds: +(m.durationInFrames / m.fps).toFixed(3) };
          } catch (e) {
            return { id, error: e instanceof Error ? e.message : String(e) };
          }
        }),
      );
      return text(out);
    },
  );

  tool(
    "get_composition",
    {
      title: "Get a composition's timeline",
      description:
        "The read-only timeline of one composition: every <Sequence> and media layer (<Img>, <Audio>, <Video>) with its absolute " +
        "from/to frames, parent sequence and source line, plus runtime errors seen while visiting every frame.",
      inputSchema: { id: z.string().describe("Composition id, the file name in compositions/ without extension") },
    },
    async ({ id }) => {
      try {
        const info = await inspectComposition({ projectRoot, id });
        await logActivity(projectRoot, { agent: agent(), kind: "read", title: `Read the timeline of ${id}`, detail: `${info.clips.length} clips` });
        return text({
          id,
          meta: info.meta,
          clips: info.clips.map((c) => ({ id: c.id, kind: c.kind, name: c.name, from: c.from, to: c.to, parent: c.parent, source: c.source, src: c.src })),
          errors: info.errors,
        });
      } catch (e) {
        return failure(e);
      }
    },
  );

  tool(
    "render_frame",
    {
      title: "Render one frame",
      description: "Renders one frame to PNG and returns it as an image you can look at. Also saved in renders/.",
      inputSchema: {
        id: z.string().describe("Composition id"),
        frame: z.number().int().min(0).describe("Frame number, from 0"),
        scale: z.number().positive().max(2).optional().describe("Resolution multiplier. Default: fits 1280 px wide"),
      },
    },
    async ({ id, frame, scale }) => {
      try {
        const meta = await readCompositionMeta(projectRoot, id);
        const s = scale ?? Math.min(1, 1280 / meta.width);
        const { frames } = await renderFrames({ projectRoot, id, frames: [frame], scale: s });
        const png = frames[0]!.png;
        await mkdir(path.join(projectRoot, "renders"), { recursive: true });
        await writeFile(path.join(projectRoot, "renders", `${id}-f${frame}.png`), png);
        await logActivity(projectRoot, { agent: agent(), kind: "frame", title: `Checked frame ${frame}`, detail: `${id} at ${timecode(frame, meta.fps)}` }, png);
        return {
          content: [
            { type: "image", data: png.toString("base64"), mimeType: "image/png" },
            { type: "text", text: `Frame ${frame} of ${id} (${timecode(frame, meta.fps)}), saved to renders/${id}-f${frame}.png` },
          ],
        };
      } catch (e) {
        return failure(e);
      }
    },
  );

  tool(
    "render_contact_sheet",
    {
      title: "Render a contact sheet",
      description:
        "Renders up to 12 frames into one labelled image, for reviewing a whole animation cheaply. By default 12 frames spread " +
        "evenly from first to last; pass `frames` to choose them (e.g. around a beat or a transition).",
      inputSchema: {
        id: z.string().describe("Composition id"),
        frames: z.array(z.number().int().min(0)).max(12).optional().describe("Frames to show, at most 12"),
        count: z.number().int().min(1).max(12).optional().describe("How many evenly spaced frames when `frames` is not given. Default 12"),
      },
    },
    async ({ id, frames, count }) => {
      try {
        let chosen = frames;
        if (!chosen?.length && count) {
          const meta = await readCompositionMeta(projectRoot, id);
          const n = Math.min(count, meta.durationInFrames);
          chosen = [...new Set(Array.from({ length: n }, (_, i) => (n === 1 ? 0 : Math.round((i * (meta.durationInFrames - 1)) / (n - 1)))))];
        }
        const sheet = await renderContactSheet({ projectRoot, id, frames: chosen, cellWidth: 400 });
        await logActivity(
          projectRoot,
          { agent: agent(), kind: "sheet", title: `Checked ${sheet.frames.length} frames`, detail: `${id}: f${sheet.frames.join(", f")}` },
          sheet.png,
        );
        return {
          content: [
            { type: "image", data: sheet.png.toString("base64"), mimeType: "image/png" },
            { type: "text", text: `Frames ${sheet.frames.join(", ")} of ${id} (${sheet.meta.width}×${sheet.meta.height}, ${sheet.meta.fps} fps, ${sheet.meta.durationInFrames} frames).` },
          ],
        };
      } catch (e) {
        return failure(e);
      }
    },
  );

  tool(
    "render_video",
    {
      title: "Render to MP4",
      description:
        "Starts rendering a composition to MP4 in the background and returns a job id; poll get_render_status. " +
        "When the studio (edit dev) is running, the render joins its queue and shows its progress there.",
      inputSchema: {
        id: z.string().describe("Composition id"),
        frames: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional().describe("Inclusive frame range, e.g. [0, 89]. Default: all"),
        quality: z.enum(["final", "draft"]).optional().describe("draft renders at half size. Default final"),
        out: z.string().optional().describe("Output path inside renders/, ending in .mp4. Default renders/<id>.mp4, versioned if it exists"),
      },
    },
    async ({ id, frames, quality, out }) => {
      try {
        if (!listCompositions(projectRoot).includes(id)) throw new Error(`No composition "${id}". Available: ${listCompositions(projectRoot).join(", ") || "none"}`);
        const helper = findHelper(projectRoot);
        let job: { id: string; out: string };
        if (helper) {
          job = await callHelper<{ id: string; out: string }>(helper, "POST", "/api/renders", { composition: id, frames, quality, out, startedBy: agent() });
        } else {
          const rel = out ?? `renders/${id}.mp4`;
          const abs = path.resolve(projectRoot, rel);
          if (!abs.startsWith(path.join(projectRoot, "renders") + path.sep) || !abs.endsWith(".mp4")) throw new Error("out must be a .mp4 path inside renders/");
          const local: LocalJob = { id: `local-${Date.now().toString(36)}`, composition: id, out: rel, status: "rendering", progress: null };
          jobs.set(local.id, local);
          void renderVideo({ projectRoot, id, out: abs, frames, scale: quality === "draft" ? 0.5 : 1, onProgress: (p) => (local.progress = p) }).then(
            () => (local.status = "done"),
            (e: unknown) => {
              local.status = "failed";
              local.error = e instanceof Error ? e.message : String(e);
            },
          );
          job = local;
        }
        await logActivity(projectRoot, { agent: agent(), kind: "render", title: `Started a render of ${id}`, detail: job.out });
        return text({ job: job.id, out: job.out, next: "Call get_render_status with this job id until status is done." });
      } catch (e) {
        return failure(e);
      }
    },
  );

  tool(
    "get_render_status",
    {
      title: "Get render status",
      description: "Progress of a render started with render_video: status (queued, rendering, done, failed, cancelled), frames done and the output path.",
      inputSchema: { job: z.string().describe("Job id from render_video") },
    },
    async ({ job }) => {
      try {
        const local = jobs.get(job);
        if (local) return text(local);
        const helper = findHelper(projectRoot);
        if (!helper) throw new Error(`No render "${job}". The studio that ran it may have stopped; check renders/.`);
        return text(await callHelper(helper, "GET", `/api/renders/${encodeURIComponent(job)}`));
      } catch (e) {
        return failure(e);
      }
    },
  );

  tool(
    "list_assets",
    {
      title: "List assets",
      description: 'Every file in _assets/ (material for the video; use what fits, not necessarily all of it) with its kind, size, duration, dimensions and fps. Use them in compositions with asset("name").',
      inputSchema: {},
    },
    async () => {
      try {
        const assets = await listAssets(projectRoot);
        return text(assets.length ? assets : "_assets/ is empty. The user can drop files into the studio or copy them into _assets/.");
      } catch (e) {
        return failure(e);
      }
    },
  );

  tool(
    "analyze_audio",
    {
      title: "Analyse audio",
      description:
        "Tempo, beats, onsets and a per-frame loudness curve (dBFS) for an audio or video asset, all in frames at the given fps, " +
        "so animation can land on the music.",
      inputSchema: {
        asset: z.string().describe('Asset name, as passed to asset(), e.g. "score.m4a"'),
        fps: z.number().positive().optional().describe("Frames per second for the results. Default: the project's first composition's fps"),
      },
    },
    async ({ asset, fps }) => {
      try {
        const file = assetFile(projectRoot, `/assets/${asset.replace(/^\/?(_?assets\/)?/, "")}`);
        if (!file || !existsSync(file)) throw new Error(`No asset "${asset}" in _assets/. Call list_assets to see what's there.`);
        const rate = fps ?? (await defaultFps());
        const a = await analyzeAudio(file, { fps: rate });
        const shown = a.beats.slice(0, 8).map((b) => `f${b}`).join(", ");
        await logActivity(projectRoot, {
          agent: agent(),
          kind: "audio",
          title: `Analysed ${asset}`,
          detail: a.beats.length ? `${a.bpm ?? "?"} BPM · beats at ${shown}${a.beats.length > 8 ? "…" : ""}` : "No clear beat",
        });
        return text({ asset, fps: rate, ...a });
      } catch (e) {
        return failure(e);
      }
    },
  );

  tool(
    "get_errors",
    {
      title: "Get errors",
      description:
        "Build and runtime errors for one composition or all of them: builds each one, visits every frame headlessly, and adds " +
        "what the studio's preview reported. Each error names the composition, frame, file and line where known.",
      inputSchema: { id: z.string().optional().describe("Composition id. Default: all") },
    },
    async ({ id }) => {
      const ids = id ? [id] : listCompositions(projectRoot);
      const studio = readState<{ errors: Record<string, string[]> }>(projectRoot, "errors.json")?.errors ?? {};
      const report: Record<string, string[]> = {};
      for (const c of ids) {
        const found: string[] = [];
        try {
          const info = await inspectComposition({ projectRoot, id: c });
          found.push(...info.errors);
        } catch (e) {
          found.push(e instanceof Error ? e.message : String(e));
        }
        for (const s of studio[c] ?? []) if (!found.some((f) => f.includes(s) || s.includes(f))) found.push(`In the studio preview: ${s}`);
        if (found.length) report[c] = found;
      }
      const count = Object.values(report).reduce((n, e) => n + e.length, 0);
      await logActivity(projectRoot, { agent: agent(), kind: "errors", title: count ? `Found ${count} error${count > 1 ? "s" : ""}` : "Checked for errors", detail: count ? Object.keys(report).join(", ") : `${ids.length} composition${ids.length === 1 ? "" : "s"}, none` });
      return text(count ? report : `No errors in ${ids.join(", ") || "any composition"}.`);
    },
  );

  tool(
    "get_selection",
    {
      title: "Get the user's selection",
      description:
        'What the user pointed at in the studio with "Point agent here": the composition, frame, and element with its tag, text, ' +
        "file and line. Use it when the user says \"this\" or \"here\".",
      inputSchema: {},
    },
    async () => {
      const sel = readState<Record<string, unknown> & { element?: { text?: string; source?: string }; frame?: number }>(projectRoot, "selection.json");
      if (!sel) return text("Nothing is selected. Ask the user to click an element in the studio preview and choose Point agent here.");
      await logActivity(projectRoot, { agent: agent(), kind: "selection", title: "Read your selection", detail: [sel.element?.text, sel.frame !== undefined ? `f${sel.frame}` : "", sel.element?.source].filter(Boolean).join(" · ") });
      return text(sel);
    },
  );

  return server;
}

/** Serves the tools over stdio, for .mcp.json: { "command": "edit", "args": ["mcp"] }. */
export async function runMcpServer(options: McpOptions): Promise<void> {
  const server = createEditServer(options);
  await server.connect(new StdioServerTransport());
}
