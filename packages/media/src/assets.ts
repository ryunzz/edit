import { readdir } from "node:fs/promises";
import path from "node:path";
import { ASSETS_DIR } from "./dirs";
import { probeManyCached, type MediaInfo } from "./probe";

export type AssetInfo = { name: string } & MediaInfo;

async function walk(dir: string, prefix: string, out: string[]) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel, out);
    else if (entry.isFile()) out.push(rel);
  }
}

/**
 * Every file under <projectRoot>/_assets (dotfiles skipped), probed (cached) and sorted by name.
 * A file that cannot be read is still listed, with `error` set, so one bad upload doesn't hide the rest.
 */
export async function listAssets(projectRoot: string): Promise<AssetInfo[]> {
  const root = path.resolve(projectRoot);
  const names: string[] = [];
  await walk(path.join(root, ASSETS_DIR), "", names);
  names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const infos = await probeManyCached(
    root,
    names.map((n) => path.join(ASSETS_DIR, ...n.split("/"))),
    { tolerant: true },
  );
  return names.map((name, i) => ({ name, ...infos[i]! }));
}
