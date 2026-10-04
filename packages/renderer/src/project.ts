import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const COMPOSITION_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"];

/** Walks up from `start` to the first folder that has a compositions/ directory. */
export function findProjectRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, "compositions")) && statSync(path.join(dir, "compositions")).isDirectory()) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`No compositions/ folder found in ${start} or any folder above it. Run this inside an edit project.`);
    }
    dir = parent;
  }
}

export function listCompositions(projectRoot: string): string[] {
  const dir = path.join(projectRoot, "compositions");
  return readdirSync(dir)
    .filter((f) => COMPOSITION_EXTENSIONS.includes(path.extname(f)) && !f.startsWith("_") && !f.endsWith(".d.ts"))
    .map((f) => path.basename(f, path.extname(f)))
    .sort();
}

export function compositionPath(projectRoot: string, id: string): string {
  if (!/^[\w.-]+$/.test(id)) throw new Error(`Invalid composition id "${id}"`);
  for (const ext of COMPOSITION_EXTENSIONS) {
    const file = path.join(projectRoot, "compositions", id + ext);
    if (existsSync(file)) return file;
  }
  const available = listCompositions(projectRoot);
  throw new Error(
    `No composition "${id}" in ${path.join(projectRoot, "compositions")}.` +
      (available.length ? ` Available: ${available.join(", ")}` : " The folder is empty."),
  );
}

/** Resolves a URL path like /assets/logo.png to a file inside the project's assets folder, or null. */
export function assetFile(projectRoot: string, urlPath: string): string | null {
  if (!urlPath.startsWith("/assets/")) return null;
  const rel = decodeURIComponent(urlPath.slice("/assets/".length));
  const root = path.join(projectRoot, "assets");
  const file = path.resolve(root, rel);
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  return file;
}
