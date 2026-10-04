import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** Files under .edit/ shared by the agent's tools and the studio's helper. */
export const stateFile = (projectRoot: string, name: string) => path.join(projectRoot, ".edit", name);

export async function writeState(projectRoot: string, name: string, data: unknown) {
  const file = stateFile(projectRoot, name);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, file);
}

export function readState<T>(projectRoot: string, name: string): T | null {
  const file = stateFile(projectRoot, name);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export interface ActivityEvent {
  id: string;
  at: string;
  agent: string;
  /** What happened, short: "Checked 12 frames". */
  title: string;
  /** One line under it. */
  detail?: string;
  /** Image file in .edit/activity/, shown in the studio's feed. */
  image?: string;
  kind: "read" | "frame" | "sheet" | "render" | "audio" | "errors" | "selection" | "edit";
}

let seq = 0;

/** Adds an entry to the studio's agent activity feed (.edit/activity.jsonl). */
export async function logActivity(projectRoot: string, event: Omit<ActivityEvent, "id" | "at">, image?: Buffer): Promise<void> {
  const id = `${Date.now().toString(36)}-${process.pid.toString(36)}-${(seq++).toString(36)}`;
  const entry: ActivityEvent = { id, at: new Date().toISOString(), ...event };
  try {
    if (image) {
      const dir = stateFile(projectRoot, "activity");
      await mkdir(dir, { recursive: true });
      entry.image = `${id}.png`;
      await writeFile(path.join(dir, entry.image), image);
    }
    await mkdir(stateFile(projectRoot, ""), { recursive: true });
    await appendFile(stateFile(projectRoot, "activity.jsonl"), `${JSON.stringify(entry)}\n`);
  } catch {
    // The feed is a nicety; never fail a tool call over it.
  }
}

interface HelperInfo {
  url: string;
  token: string;
  pid: number;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The running `edit dev` helper for this project, if there is one. */
export function findHelper(projectRoot: string): HelperInfo | null {
  const info = readState<HelperInfo>(projectRoot, "helper.json");
  if (!info || !info.url || !info.token || !alive(info.pid)) return null;
  return info;
}

export async function callHelper<T>(helper: HelperInfo, method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(helper.url + route, {
    method,
    headers: { "x-edit-token": helper.token, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${method} ${route} failed with ${res.status}`);
  return data;
}

/** "claude-code" → "Claude Code". */
export function agentName(clientName: string | undefined): string {
  if (!clientName) return "Your agent";
  const known: Record<string, string> = { "claude-code": "Claude Code", "claude-ai": "Claude", codex: "Codex", "codex-mcp-client": "Codex", cursor: "Cursor", "cursor-vscode": "Cursor" };
  if (known[clientName.toLowerCase()]) return known[clientName.toLowerCase()]!;
  return clientName
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}
