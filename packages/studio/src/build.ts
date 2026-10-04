import { build } from "esbuild";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** Bundles the studio app into one script and one stylesheet. */
export async function buildStudio(): Promise<{ js: string; css: string }> {
  const result = await build({
    entryPoints: [path.join(here, "main.tsx")],
    bundle: true,
    write: false,
    outdir: "out",
    format: "esm",
    platform: "browser",
    target: "chrome120",
    jsx: "automatic",
    minify: true,
    logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".woff2": "file" },
    external: ["*.woff2"],
  });
  const js = result.outputFiles!.find((f) => f.path.endsWith(".js"))!.text;
  const css = result.outputFiles!.find((f) => f.path.endsWith(".css"))?.text ?? "";
  return { js, css };
}

// The Reel type: Geist for UI, Geist Mono for timecodes, Instrument Serif for display.
// Served by the helper so the studio works offline.
const FONTS: Record<string, string> = {
  "geist.woff2": "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
  "geist-mono.woff2": "@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2",
  "instrument-serif.woff2": "@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2",
  "instrument-serif-italic.woff2": "@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2",
};

export function fontFile(name: string): string | null {
  const spec = FONTS[name];
  if (!spec) return null;
  try {
    return require.resolve(spec);
  } catch {
    return null;
  }
}
