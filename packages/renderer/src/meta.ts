import type { CompositionMeta } from "@ryunzz/edit-core";
import { validateMeta } from "@ryunzz/edit-core/config";
import { build } from "esbuild";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildError, compileOptions } from "./bundle";
import { compositionPath } from "./project";

let counter = 0;

/**
 * Reads a composition's `meta` without a browser: bundles the file for the server
 * and imports it. Module-level code runs, so it must not touch the DOM.
 */
export async function readCompositionMeta(projectRoot: string, id: string): Promise<CompositionMeta> {
  const file = compositionPath(projectRoot, id);
  let code: string;
  try {
    const result = await build({
      ...compileOptions(projectRoot),
      entryPoints: [file],
      platform: "node",
      target: "node20",
    });
    code = result.outputFiles![0]!.text;
  } catch (error) {
    throw buildError(error, id);
  }
  const dir = path.join(projectRoot, ".edit", "tmp");
  await mkdir(dir, { recursive: true });
  const out = path.join(dir, `meta-${id}-${process.pid}-${counter++}.mjs`);
  await writeFile(out, code);
  try {
    const mod = (await import(pathToFileURL(out).href)) as { meta?: unknown };
    return validateMeta(mod.meta, id);
  } finally {
    await rm(out, { force: true });
  }
}
