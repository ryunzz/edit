import { build, type Plugin } from "esbuild";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ownRequire = createRequire(path.join(here, "..", "package.json"));

// React and edit-core keep module-level state, so the composition and the runtime
// must share one copy. Prefer the project's own install, fall back to ours.
function dedupe(projectRoot: string): Plugin {
  // Only ask the project when it has its own install: under Bun, resolving from a folder
  // without node_modules auto-installs into the global cache, where react-dom can't find scheduler.
  const resolvers = existsSync(path.join(projectRoot, "node_modules"))
    ? [createRequire(path.join(projectRoot, "package.json")), ownRequire]
    : [ownRequire];
  return {
    name: "edit-dedupe",
    setup(b) {
      b.onResolve({ filter: /^(react|react-dom|@ryunzz\/edit-core)(\/.*)?$/ }, (args) => {
        for (const req of resolvers) {
          try {
            return { path: req.resolve(args.path) };
          } catch {
            // try the next resolver
          }
        }
        return undefined;
      });
    },
  };
}

export interface BundleResult {
  js: string;
}

export async function bundleComposition(options: {
  projectRoot: string;
  compositionFile: string;
  id: string;
  mode: "render" | "preview";
}): Promise<BundleResult> {
  const entry = [
    `import * as mod from ${JSON.stringify(options.compositionFile)};`,
    `import { mount } from "@ryunzz/edit-core/runtime";`,
    `mount(mod, { id: ${JSON.stringify(options.id)}, mode: ${JSON.stringify(options.mode)} });`,
  ].join("\n");

  try {
    const result = await build({
      stdin: { contents: entry, resolveDir: options.projectRoot, sourcefile: "edit-entry.js", loader: "js" },
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "chrome120",
      jsx: "automatic",
      // Our JSX runtime tags elements with their file and line for the studio and agents.
      jsxDev: true,
      jsxImportSource: "@ryunzz/edit-core",
      absWorkingDir: options.projectRoot,
      sourcemap: "inline",
      logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [dedupe(options.projectRoot)],
    });
    return { js: result.outputFiles[0]!.text };
  } catch (error) {
    const e = error as { errors?: { text: string; location?: { file: string; line: number; column: number; lineText: string } }[] };
    if (e.errors?.length) {
      const lines = e.errors.map((m) =>
        m.location ? `${m.location.file}:${m.location.line}:${m.location.column}: ${m.text}\n  ${m.location.lineText}` : m.text,
      );
      throw new Error(`Could not build composition "${options.id}":\n${lines.join("\n")}`);
    }
    throw error;
  }
}
