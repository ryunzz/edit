import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { listFolder, type AssetInfo } from "./assets";
import { REFS_DIR } from "./dirs";

/** Links to reference videos live here, one per line: "- <url> — <what to take from it>". */
export const LINKS_FILE = "links.md";

export interface RefLink {
  url: string;
  /** What the user wants taken from it, if they said. */
  note: string;
  /** "YouTube", "TikTok", "Instagram", "Vimeo", "X", or the site's host name. */
  platform: string;
}

export interface Refs {
  files: AssetInfo[];
  links: RefLink[];
}

const LINKS_HEADER = `# Reference links

Videos and pages whose look or feel the agent should learn from. One per line:
- https://www.youtube.com/watch?v=… — what to take from it (pacing, type, colour, transitions…)

`;

export function platformOf(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\.|^m\./, "");
  } catch {
    return "Link";
  }
  if (host === "youtu.be" || host.endsWith("youtube.com")) return "YouTube";
  if (host.endsWith("tiktok.com")) return "TikTok";
  if (host.endsWith("instagram.com")) return "Instagram";
  if (host.endsWith("vimeo.com")) return "Vimeo";
  if (host === "x.com" || host.endsWith("twitter.com")) return "X";
  return host;
}

/** A http(s) URL, trimmed, or null. */
export function cleanUrl(input: string): string | null {
  const s = input.trim();
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Reads "- <url> — note" lines (also "-", "–" or ":" before the note); other lines are ignored. */
export function parseLinks(markdown: string): RefLink[] {
  const links: RefLink[] = [];
  for (const line of markdown.split("\n")) {
    const m = /^\s*[-*]\s+<?(https?:\/\/[^\s>]+)>?\s*(?:(?:—|–|-|:)\s*(.*))?$/.exec(line);
    if (!m || m[1]!.includes("…")) continue;
    const url = cleanUrl(m[1]!);
    if (url && !links.some((l) => l.url === url)) links.push({ url, note: (m[2] ?? "").trim(), platform: platformOf(url) });
  }
  return links;
}

const linksPath = (projectRoot: string) => path.join(projectRoot, REFS_DIR, LINKS_FILE);

export function readLinks(projectRoot: string): RefLink[] {
  const file = linksPath(projectRoot);
  return existsSync(file) ? parseLinks(readFileSync(file, "utf8")) : [];
}

/** Creates _refs/ and links.md with a short header, if missing. */
export async function ensureRefs(projectRoot: string): Promise<void> {
  await mkdir(path.join(projectRoot, REFS_DIR), { recursive: true });
  if (!existsSync(linksPath(projectRoot))) await writeFile(linksPath(projectRoot), LINKS_HEADER);
}

/** Adds a link (or updates its note), keeping everything else in links.md as the user wrote it. */
export async function addLink(projectRoot: string, url: string, note = ""): Promise<RefLink> {
  const clean = cleanUrl(url);
  if (!clean) throw new Error(`Not a web link: ${url}`);
  await ensureRefs(projectRoot);
  const file = linksPath(projectRoot);
  const lines = readFileSync(file, "utf8").split("\n");
  const line = `- ${clean}${note.trim() ? ` — ${note.trim().replace(/\s+/g, " ")}` : ""}`;
  const at = lines.findIndex((l) => parseLinks(l)[0]?.url === clean);
  if (at >= 0) lines[at] = line;
  else {
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push(line, "");
  }
  await writeFile(file, lines.join("\n"));
  return { url: clean, note: note.trim(), platform: platformOf(clean) };
}

export async function removeLink(projectRoot: string, url: string): Promise<boolean> {
  const file = linksPath(projectRoot);
  if (!existsSync(file)) return false;
  const lines = readFileSync(file, "utf8").split("\n");
  const kept = lines.filter((l) => parseLinks(l)[0]?.url !== (cleanUrl(url) ?? url));
  if (kept.length === lines.length) return false;
  await writeFile(file, kept.join("\n"));
  return true;
}

/** Everything in _refs/: files (probed) and the links in links.md. */
export async function listRefs(projectRoot: string): Promise<Refs> {
  return { files: await listFolder(projectRoot, REFS_DIR, [LINKS_FILE]), links: readLinks(projectRoot) };
}
