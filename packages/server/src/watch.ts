import { ASSETS_DIR, OUT_DIR, REFS_DIR, RENDERS_DIR } from "@ryunzz/edit-media";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";

const IGNORED = new Set(["node_modules", ".edit", ".git", RENDERS_DIR, OUT_DIR, "dist"]);
const SOURCE = new Set([".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".css", ".json"]);

export interface Changes {
  /** Project-relative paths of changed code files. */
  source: string[];
  /** Paths inside _assets/ that changed. */
  assets: string[];
  /** Paths inside _refs/ that changed. */
  refs: string[];
  /** Paths inside .edit/ that changed (agent activity, selection). */
  state: string[];
}

/** Watches the project folder and reports batched changes, ignoring build output and dependencies. */
export function watchProject(projectRoot: string, onChange: (c: Changes) => void, delayMs = 60): FSWatcher {
  let pending: Changes = { source: [], assets: [], refs: [], state: [] };
  let timer: ReturnType<typeof setTimeout> | null = null;

  const watcher = watch(projectRoot, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const rel = filename.toString().split(path.sep).join("/");
    const top = rel.split("/")[0]!;
    let bucket: keyof Changes | null = null;
    if (top === ".edit") {
      if (!rel.startsWith(".edit/tmp/") && !rel.startsWith(".edit/cache/")) bucket = "state";
    } else if (IGNORED.has(top) || rel.split("/").some((p) => p.startsWith(".") && p.length > 1)) {
      return;
    } else if (top === ASSETS_DIR) {
      bucket = "assets";
    } else if (top === REFS_DIR) {
      bucket = "refs";
    } else if (SOURCE.has(path.extname(rel))) {
      bucket = "source";
    }
    if (!bucket) return;
    if (!pending[bucket].includes(rel)) pending[bucket].push(rel);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const batch = pending;
      pending = { source: [], assets: [], refs: [], state: [] };
      timer = null;
      onChange(batch);
    }, delayMs);
  });
  return watcher;
}
