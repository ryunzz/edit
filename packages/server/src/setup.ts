import { checkFfmpeg, hasChrome, listCompositions, resolveChrome, type FfmpegStatus } from "@ryunzz/edit-renderer";
import { ASSETS_DIR, REFS_DIR } from "@ryunzz/edit-media";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ActivityFeed } from "./activity";
import type { HelperContext, Route } from "./helper";

export interface SetupStatus {
  chrome: { ready: boolean; downloading: number | null; problem?: string };
  ffmpeg: FfmpegStatus;
  files: { compositions: number; assets: number; refs: boolean; agents: boolean; mcp: boolean };
  agent: { name: string; connected: boolean } | null;
  /** True until an agent has connected to this project once. */
  firstRun: boolean;
  /** The command in .mcp.json, for agents configured by hand. */
  mcpCommand: string | null;
  /** A first request that fits the project's assets. */
  examplePrompt: string;
}

const AUDIO = /\.(mp3|m4a|wav|aac|ogg|flac)$/i;
const IMAGE = /\.(png|jpe?g|webp|svg|avif|gif)$/i;

/** The first-run checklist: helper, Chromium (downloaded here once, in the background), ffmpeg, project files, agent. */
export class Setup {
  private chrome: SetupStatus["chrome"] = { ready: false, downloading: null };
  private ffmpeg: Promise<FfmpegStatus> = checkFfmpeg();
  private lastSent = 0;

  constructor(
    private ctx: HelperContext,
    private feed: ActivityFeed,
  ) {}

  async start() {
    if (await hasChrome()) {
      this.chrome = { ready: true, downloading: null };
      return;
    }
    this.chrome = { ready: false, downloading: 0 };
    this.ctx.log("Downloading headless Chromium (one time only)…");
    resolveChrome(this.ctx.log, (fraction) => {
      this.chrome.downloading = fraction;
      if (Date.now() - this.lastSent > 250) {
        this.lastSent = Date.now();
        void this.send();
      }
    }).then(
      () => {
        this.chrome = { ready: true, downloading: null };
        void this.send();
      },
      (e: unknown) => {
        this.chrome = { ready: false, downloading: null, problem: e instanceof Error ? e.message : String(e) };
        void this.send();
      },
    );
  }

  private async send() {
    this.ctx.events.send("setup", await this.status());
  }

  async status(): Promise<SetupStatus> {
    const root = this.ctx.projectRoot;
    let assets: string[] = [];
    try {
      assets = readdirSync(path.join(root, ASSETS_DIR)).filter((f) => !f.startsWith("."));
    } catch {
      // no assets yet
    }
    let mcpCommand: string | null = null;
    try {
      const edit = JSON.parse(readFileSync(path.join(root, ".mcp.json"), "utf8")).mcpServers?.edit as { command: string; args?: string[] } | undefined;
      if (edit) mcpCommand = [edit.command, ...(edit.args ?? [])].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
    } catch {
      // no .mcp.json
    }
    const audio = assets.find((a) => AUDIO.test(a));
    const image = assets.find((a) => IMAGE.test(a));
    const examplePrompt =
      audio && image
        ? `Make a 6 second title that hits on the beats of ${audio} and ends on ${image}.`
        : audio
          ? `Make a 6 second title that hits on the beats of ${audio}.`
          : image
            ? `Make a 4 second logo sting that ends on ${image}.`
            : "Make a 6 second kinetic type title that says “Make it move”.";
    const agent = this.feed.agent();
    return {
      chrome: this.chrome,
      ffmpeg: await this.ffmpeg,
      files: {
        compositions: listCompositions(root).length,
        assets: assets.length,
        refs: existsSync(path.join(root, REFS_DIR)),
        agents: existsSync(path.join(root, "AGENTS.md")),
        mcp: existsSync(path.join(root, ".mcp.json")),
      },
      agent: agent && { name: agent.name, connected: agent.connected },
      firstRun: !agent,
      mcpCommand,
      examplePrompt,
    };
  }
}

export function setupRoutes(ctx: HelperContext, setup: Setup): Route {
  return async (req, res, url) => {
    if (req.method === "GET" && url.pathname === "/api/setup") {
      ctx.json(res, 200, await setup.status());
      return true;
    }
    return false;
  };
}
