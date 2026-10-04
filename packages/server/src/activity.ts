import { serveFile } from "@ryunzz/edit-renderer";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { appendFile, mkdir, open } from "node:fs/promises";
import path from "node:path";
import type { HelperContext, Route } from "./helper";
import type { Changes } from "./watch";

export interface ActivityEvent {
  id: string;
  at: string;
  agent: string;
  kind: string;
  title: string;
  detail?: string;
  image?: string;
  /** For file edits: a few changed lines. */
  diff?: { op: "+" | "-"; text: string }[];
  added?: number;
  removed?: number;
}

const KEEP = 200;
const IGNORED = new Set(["node_modules", "renders", "dist", "assets"]);
const SOURCE = new Set([".tsx", ".ts", ".jsx", ".js", ".mjs", ".css", ".json"]);
const MAX_FILE = 512 * 1024;

/** Lines removed and added between two versions: trims the common start and end, the rest changed. */
export function lineDiff(before: string, after: string): { removed: string[]; added: string[] } {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { removed: a.slice(start, endA), added: b.slice(start, endB) };
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * The studio's agent activity feed. Agent tools append to .edit/activity.jsonl; the helper
 * adds file edits it sees, tails the file and streams new entries to the studio.
 */
export class ActivityFeed {
  readonly events: ActivityEvent[] = [];
  private offset = 0;
  private snapshots = new Map<string, string>();
  private file: string;
  private reading: Promise<void> = Promise.resolve();
  private seq = 0;

  constructor(private ctx: HelperContext) {
    this.file = path.join(ctx.projectRoot, ".edit", "activity.jsonl");
    if (existsSync(this.file)) {
      const text = readFileSync(this.file, "utf8");
      this.offset = Buffer.byteLength(text);
      for (const line of text.split("\n").slice(-KEEP - 1)) this.push(line);
    }
  }

  private push(line: string): ActivityEvent | null {
    if (!line.trim()) return null;
    try {
      const e = JSON.parse(line) as ActivityEvent;
      if (!e.id || !e.title) return null;
      this.events.push(e);
      if (this.events.length > KEEP) this.events.splice(0, this.events.length - KEEP);
      return e;
    } catch {
      return null;
    }
  }

  /** Reads entries appended since last time and sends them to the studio. */
  readNew() {
    this.reading = this.reading.then(async () => {
      if (!existsSync(this.file)) return;
      const size = statSync(this.file).size;
      if (size < this.offset) this.offset = 0;
      if (size === this.offset) return;
      const fh = await open(this.file, "r");
      try {
        const buf = Buffer.alloc(size - this.offset);
        await fh.read(buf, 0, buf.length, this.offset);
        const text = buf.toString("utf8");
        const complete = text.lastIndexOf("\n") + 1;
        this.offset += Buffer.byteLength(text.slice(0, complete));
        const added = text
          .slice(0, complete)
          .split("\n")
          .map((l) => this.push(l))
          .filter((e): e is ActivityEvent => e !== null);
        if (added.length) this.ctx.events.send("activity", { events: added });
      } finally {
        await fh.close();
      }
    });
    return this.reading;
  }

  /** Remembers every source file in the project, so the first edit to each shows as a diff. */
  snapshotAll() {
    const walk = (dir: string, rel: string) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith(".") || IGNORED.has(e.name)) continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), r);
        else if (SOURCE.has(path.extname(e.name))) this.snapshot(r);
      }
    };
    walk(this.ctx.projectRoot, "");
  }

  /** Remembers source files as they are now, so later edits can be shown as diffs. */
  snapshot(rel: string) {
    const abs = path.join(this.ctx.projectRoot, rel);
    try {
      if (statSync(abs).size <= MAX_FILE) this.snapshots.set(rel, readFileSync(abs, "utf8"));
    } catch {
      this.snapshots.delete(rel);
    }
  }

  async recordEdits(files: string[]) {
    const agent = this.agent();
    for (const rel of files) {
      const abs = path.join(this.ctx.projectRoot, rel);
      const before = this.snapshots.get(rel);
      let after: string | null = null;
      try {
        if (statSync(abs).size <= MAX_FILE) after = readFileSync(abs, "utf8");
      } catch {
        after = null;
      }
      if (after === null) {
        if (before === undefined) continue;
        this.snapshots.delete(rel);
        await this.append({ kind: "edit", agent: agent?.name ?? "", title: `Deleted ${rel}` });
        continue;
      }
      this.snapshots.set(rel, after);
      if (before === after) continue;
      const name = rel.split("/").pop()!;
      if (before === undefined) {
        await this.append({ kind: "edit", agent: agent?.name ?? "", title: `Created ${name}`, detail: rel, added: after.split("\n").length, removed: 0 });
        continue;
      }
      const { removed, added } = lineDiff(before, after);
      const diff = [...removed.slice(0, 4).map((text) => ({ op: "-" as const, text })), ...added.slice(0, 4).map((text) => ({ op: "+" as const, text }))].map((d) => ({
        ...d,
        text: d.text.trim().slice(0, 120),
      }));
      await this.append({ kind: "edit", agent: agent?.name ?? "", title: `Edited ${name}`, detail: rel, diff, added: added.length, removed: removed.length });
    }
  }

  private async append(event: Omit<ActivityEvent, "id" | "at">) {
    const entry: ActivityEvent = { id: `h${Date.now().toString(36)}${(this.seq++).toString(36)}`, at: new Date().toISOString(), ...event };
    await mkdir(path.dirname(this.file), { recursive: true });
    await appendFile(this.file, `${JSON.stringify(entry)}\n`);
    await this.readNew();
  }

  /** The agent whose tools are connected right now, from .edit/agent.json. */
  agent(): { name: string; connected: boolean; at: string } | null {
    try {
      const a = JSON.parse(readFileSync(path.join(this.ctx.projectRoot, ".edit", "agent.json"), "utf8")) as { name: string; pid: number; at: string };
      return { name: a.name, connected: alive(a.pid), at: a.at };
    } catch {
      return null;
    }
  }

  onChange(c: Changes) {
    if (c.source.length) void this.recordEdits(c.source).catch(() => undefined);
    if (c.state.includes(".edit/activity.jsonl")) void this.readNew();
    if (c.state.includes(".edit/agent.json")) this.ctx.events.send("agent", this.agent());
  }
}

export function activityRoutes(ctx: HelperContext, feed: ActivityFeed): Route {
  return (req, res, url) => {
    if (req.method === "GET" && url.pathname === "/api/activity") {
      ctx.json(res, 200, { events: feed.events, agent: feed.agent() });
      return true;
    }
    const img = /^\/api\/activity\/image\/([\w.-]+\.png)$/.exec(url.pathname);
    if (req.method === "GET" && img) {
      if (serveFile(req, res, path.join(ctx.projectRoot, ".edit", "activity", img[1]!), { "cache-control": "max-age=86400" })) return true;
    }
    return false;
  };
}
