import { bundleComposition, compositionPath, listCompositions, readCompositionMeta, assetFile, serveFile } from "@ryunzz/edit-renderer";
import { buildStudio, fontFile } from "@ryunzz/edit-studio";
import type { CompositionMeta } from "@ryunzz/edit-core";
import type { FSWatcher } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { EventHub } from "./events";
import { Guard, newToken } from "./security";
import { watchProject, type Changes } from "./watch";

export type Log = (message: string) => void;

export interface HelperOptions {
  projectRoot: string;
  /** First port to try; the next free one is used if it is taken. Default 3210. */
  port?: number;
  log?: Log;
}

export interface Helper {
  url: string;
  /** The studio link, with the start-up token. */
  studioUrl: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

/** What the studio knows about a composition. */
export interface CompositionEntry {
  id: string;
  meta: CompositionMeta | null;
  error: string | null;
}

/** Context handed to route modules (assets, renders, activity…). */
export interface HelperContext {
  projectRoot: string;
  events: EventHub;
  log: Log;
  readJson(req: IncomingMessage, limit?: number): Promise<unknown>;
  json(res: ServerResponse, status: number, body: unknown): void;
}

export type Route = (req: IncomingMessage, res: ServerResponse, url: URL) => boolean | Promise<boolean>;

const PREVIEW_PAGE = (id: string, version: number) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style></head>` +
  `<body><div id="root"></div><script type="module" src="/preview/${encodeURIComponent(id)}/bundle.js?v=${version}"></script></body></html>`;

const STUDIO_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>edit</title><link rel="stylesheet" href="/studio.css"></head><body><div id="app"></div><script type="module" src="/studio.js"></script></body></html>`;

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }).end(JSON.stringify(body));
}

function readJson(req: IncomingMessage, limit = 1024 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("Request body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new Error("Request body is not JSON"));
      }
    });
    req.on("error", reject);
  });
}

/** Shows home-relative paths as ~/… in the studio. */
export function displayPath(p: string): string {
  const home = os.homedir();
  return p === home || p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p;
}

async function listen(server: Server, first: number): Promise<number> {
  for (let port = first; port < first + 50; port++) {
    const ok = await new Promise<boolean>((resolve) => {
      const onError = (e: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        if (e.code === "EADDRINUSE") resolve(false);
        else throw e;
      };
      const onListening = () => {
        server.off("error", onError);
        resolve(true);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    });
    if (ok) return (server.address() as AddressInfo).port;
  }
  throw new Error(`No free port between ${first} and ${first + 49}. Pass --port.`);
}

/**
 * The local helper behind `edit dev`: serves the studio and live previews on 127.0.0.1,
 * watches the project and tells the studio what changed.
 */
export class HelperServer {
  readonly projectRoot: string;
  readonly events = new EventHub();
  readonly log: Log;
  /** Bumped on every source change; previews and metadata are rebuilt lazily per version. */
  version = 1;
  private bundles = new Map<string, { version: number; js: Promise<string> }>();
  private metas = new Map<string, { version: number; entry: Promise<CompositionEntry> }>();
  /** Runtime errors the studio saw, per composition. */
  readonly runtimeErrors = new Map<string, string[]>();
  private routes: Route[] = [];
  private studio: Promise<{ js: string; css: string }> | null = null;
  private watcher: FSWatcher | null = null;
  private server: Server | null = null;
  private guard: Guard | null = null;
  private changeListeners: ((c: Changes) => void)[] = [];

  constructor(options: { projectRoot: string; log?: Log }) {
    this.projectRoot = path.resolve(options.projectRoot);
    this.log = options.log ?? (() => {});
  }

  get context(): HelperContext {
    return { projectRoot: this.projectRoot, events: this.events, log: this.log, readJson, json };
  }

  /** Adds API routes; each returns true when it handled the request. */
  use(route: Route) {
    this.routes.push(route);
  }

  onChange(listener: (c: Changes) => void) {
    this.changeListeners.push(listener);
  }

  async compositions(): Promise<CompositionEntry[]> {
    return Promise.all(listCompositions(this.projectRoot).map((id) => this.composition(id)));
  }

  composition(id: string): Promise<CompositionEntry> {
    const cached = this.metas.get(id);
    if (cached && cached.version === this.version) return cached.entry;
    const entry = readCompositionMeta(this.projectRoot, id).then(
      (meta) => ({ id, meta, error: null }),
      (e: unknown) => ({ id, meta: null, error: e instanceof Error ? e.message : String(e) }),
    );
    this.metas.set(id, { version: this.version, entry });
    return entry;
  }

  /** The preview bundle for a composition. A build error becomes code that reports it, so the studio shows it. */
  previewBundle(id: string): Promise<string> {
    const cached = this.bundles.get(id);
    if (cached && cached.version === this.version) return cached.js;
    const js = (async () => {
      try {
        const file = compositionPath(this.projectRoot, id);
        return (await bundleComposition({ projectRoot: this.projectRoot, compositionFile: file, id, mode: "preview" })).js;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return `window.__editMountError = ${JSON.stringify(message)};`;
      }
    })();
    this.bundles.set(id, { version: this.version, js });
    return js;
  }

  private async writeErrors() {
    const all = Object.fromEntries(this.runtimeErrors);
    await mkdir(path.join(this.projectRoot, ".edit"), { recursive: true });
    await writeFile(path.join(this.projectRoot, ".edit", "errors.json"), JSON.stringify({ at: new Date().toISOString(), errors: all }, null, 2));
  }

  private handleChanges(c: Changes) {
    if (c.source.length) {
      this.version++;
      this.events.send("source", { version: this.version, files: c.source });
    }
    if (c.assets.length) this.events.send("assets", { files: c.assets });
    if (c.refs.length) this.events.send("refs", { files: c.refs });
    for (const l of this.changeListeners) l(c);
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!this.guard!.check(req, res, url)) return;
    const p = url.pathname;

    if (req.method === "GET" && p === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(STUDIO_PAGE);
      return;
    }
    if (req.method === "GET" && (p === "/studio.js" || p === "/studio.css")) {
      this.studio ??= buildStudio();
      const built = await this.studio;
      const type = p.endsWith(".js") ? "text/javascript" : "text/css";
      res.writeHead(200, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" }).end(p.endsWith(".js") ? built.js : built.css);
      return;
    }
    if (req.method === "GET" && p.startsWith("/fonts/")) {
      const file = fontFile(p.slice("/fonts/".length));
      if (file && serveFile(req, res, file, { "cache-control": "max-age=86400" })) return;
    }
    if (req.method === "GET" && p === "/api/events") {
      this.events.attach(res);
      return;
    }
    if (req.method === "GET" && p === "/api/project") {
      json(res, 200, {
        name: path.basename(this.projectRoot),
        root: displayPath(this.projectRoot),
        version: this.version,
        port: (this.server!.address() as AddressInfo).port,
      });
      return;
    }
    if (req.method === "GET" && p === "/api/compositions") {
      json(res, 200, await this.compositions());
      return;
    }
    const preview = /^\/preview\/([\w.-]+)(\/bundle\.js)?$/.exec(p);
    if (req.method === "GET" && preview) {
      const id = preview[1]!;
      if (preview[2]) {
        const js = await this.previewBundle(id);
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" }).end(js);
      } else {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(PREVIEW_PAGE(id, this.version));
      }
      return;
    }
    if (req.method === "POST" && p === "/api/errors") {
      const body = (await readJson(req)) as { id?: unknown; errors?: unknown };
      if (typeof body.id !== "string" || !Array.isArray(body.errors)) return json(res, 400, { error: "Expected { id, errors: string[] }" });
      const errors = body.errors.filter((e): e is string => typeof e === "string").slice(0, 50);
      if (errors.length) this.runtimeErrors.set(body.id, errors);
      else this.runtimeErrors.delete(body.id);
      await this.writeErrors();
      json(res, 200, { ok: true });
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && p.startsWith("/assets/")) {
      const file = assetFile(this.projectRoot, p);
      if (file && serveFile(req, res, file, { "cache-control": "no-cache" })) return;
    }
    for (const route of this.routes) {
      if (await route(req, res, url)) return;
    }
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  }

  async start(port = 3210): Promise<Helper> {
    const token = newToken();
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        this.log(`helper: ${req.method} ${req.url}: ${message}`);
        if (!res.headersSent) json(res, 500, { error: message });
        else res.end();
      });
    });
    const bound = await listen(this.server, port);
    this.guard = new Guard(token, bound);
    this.watcher = watchProject(this.projectRoot, (c) => this.handleChanges(c));
    this.studio = buildStudio();
    this.studio.catch((e: unknown) => this.log(`Could not build the studio: ${e instanceof Error ? e.message : String(e)}`));

    const url = `http://127.0.0.1:${bound}`;
    const studioUrl = `${url}/?token=${token}`;
    // Lets `edit mcp` (the agent's tools) find this helper. Local processes are trusted; browsers are not.
    const infoFile = path.join(this.projectRoot, ".edit", "helper.json");
    await mkdir(path.dirname(infoFile), { recursive: true });
    // Owner-only: other users on this machine must not read the token.
    await rm(infoFile, { force: true });
    await writeFile(infoFile, JSON.stringify({ url, port: bound, token, pid: process.pid }, null, 2), { mode: 0o600 });

    return {
      url,
      studioUrl,
      port: bound,
      token,
      close: async () => {
        this.watcher?.close();
        this.events.close();
        const closed = new Promise<void>((resolve) => this.server!.close(() => resolve()));
        this.server!.closeAllConnections?.();
        await closed;
        await rm(infoFile, { force: true });
      },
    };
  }
}
