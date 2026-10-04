import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.join(here, "..");
const templatesDir = path.join(cliRoot, "templates");

export const TEMPLATES = {
  blank: { title: "Blank", about: "One composition with a title that fades in", prompt: "Make a 5 second intro for my project with its name, on a dark background." },
  kinetic: { title: "Kinetic type", about: "Words that land one per beat", prompt: "Make a 6 second title that hits on the beats of my music and ends on my logo." },
  logo: { title: "Logo sting", about: "A 3 second logo reveal with a burst", prompt: "Replace assets/logo.svg with my logo and make the sting feel heavier." },
} as const;

export type TemplateName = keyof typeof TEMPLATES;

/**
 * True when this CLI runs from a source checkout of the repo rather than from an npm install.
 * Then new projects use this checkout's packages directly and nothing is installed.
 */
export function fromCheckout(): boolean {
  return !cliRoot.split(path.sep).includes("node_modules") && existsSync(path.join(cliRoot, "..", "core", "src", "index.ts"));
}

/** The root of the source checkout this CLI runs from, whatever its folder is called; null when installed from npm. */
export function checkoutRoot(): string | null {
  return fromCheckout() ? path.resolve(cliRoot, "..", "..") : null;
}

/**
 * Where a project named on the command line lives. From a checkout, a bare name like
 * "my-video" means <checkout>/projects/my-video (that folder is git-ignored). Anything that
 * looks like a path (".", "./x", "../x", "~/x", "/abs", "a/b") is taken as a path.
 */
export function resolveProjectDir(arg: string, cwd = process.cwd()): string {
  if (arg === "~" || arg.startsWith("~/")) return path.join(os.homedir(), arg.slice(2));
  const looksLikePath = arg === "." || arg === ".." || /[\/]/.test(arg) || path.isAbsolute(arg);
  const root = checkoutRoot();
  if (root && !looksLikePath) return path.join(root, "projects", arg);
  return path.resolve(cwd, arg);
}

/** How agents start the MCP tools for a project. */
export function mcpCommand(): { command: string; args: string[] } {
  if (fromCheckout()) return { command: "bun", args: [path.join(cliRoot, "src", "index.ts"), "mcp"] };
  return { command: "npx", args: ["--no-install", "edit", "mcp"] };
}

function packageVersion(): string {
  return (JSON.parse(readFileSync(path.join(cliRoot, "package.json"), "utf8")) as { version: string }).version;
}

function writeIfMissing(file: string, content: string, created: string[], root: string) {
  if (existsSync(file)) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  created.push(path.relative(root, file));
}

export interface InitOptions {
  dir: string;
  template: TemplateName;
  install: boolean;
  log: (m: string) => void;
}

/**
 * Creates a project, or adds what's missing to an existing one: compositions from the template,
 * assets/, AGENTS.md, CLAUDE.md, the Claude skill, .mcp.json for Claude Code and Cursor, .gitignore,
 * package.json and tsconfig.json. Never overwrites a file.
 */
export function initProject(options: InitOptions): { root: string; created: string[]; existing: boolean } {
  const root = resolveProjectDir(options.dir);
  const existing = existsSync(path.join(root, "compositions"));
  if (existsSync(root) && !existing) {
    const visible = readdirSync(root).filter((f) => !f.startsWith("."));
    if (visible.length) throw new Error(`${root} isn't empty and isn't an edit project. Pick a new folder name, e.g. edit init my-video.`);
  }
  mkdirSync(root, { recursive: true });
  const created: string[] = [];
  const name = path.basename(root).toLowerCase().replace(/[^a-z0-9-_.]/g, "-") || "my-video";

  if (!existing) {
    const t = path.join(templatesDir, options.template);
    cpSync(t, root, { recursive: true, errorOnExist: false, force: false });
    for (const sub of ["compositions", "assets"]) {
      const dir = path.join(t, sub);
      if (existsSync(dir)) for (const f of readdirSync(dir)) created.push(`${sub}/${f}`);
    }
  }
  mkdirSync(path.join(root, "assets"), { recursive: true });

  const agent = path.join(templatesDir, "agent");
  writeIfMissing(path.join(root, "AGENTS.md"), readFileSync(path.join(agent, "AGENTS.md"), "utf8"), created, root);
  writeIfMissing(path.join(root, "CLAUDE.md"), readFileSync(path.join(agent, "CLAUDE.md"), "utf8"), created, root);
  writeIfMissing(path.join(root, ".claude", "skills", "edit", "SKILL.md"), readFileSync(path.join(agent, "skill", "SKILL.md"), "utf8"), created, root);

  const mcp = `${JSON.stringify({ mcpServers: { edit: mcpCommand() } }, null, 2)}\n`;
  writeIfMissing(path.join(root, ".mcp.json"), mcp, created, root);
  writeIfMissing(path.join(root, ".cursor", "mcp.json"), mcp, created, root);
  writeIfMissing(path.join(root, ".gitignore"), "node_modules/\nrenders/\n.edit/\n.DS_Store\n", created, root);

  const local = fromCheckout();
  const repo = path.join(cliRoot, "..", "..");
  const pkg = local
    ? { name, private: true, type: "module", scripts: { dev: "edit dev", render: "edit render" } }
    : {
        name,
        private: true,
        type: "module",
        scripts: { dev: "edit dev", render: "edit render" },
        dependencies: { "@ryunzz/edit": `^${packageVersion()}`, "@ryunzz/edit-core": `^${packageVersion()}`, react: "^19.1.0", "react-dom": "^19.1.0" },
        devDependencies: { "@types/react": "^19.1.0", typescript: "^5.9.0" },
      };
  writeIfMissing(path.join(root, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`, created, root);

  // From a checkout, point the editor's types at this repo so imports resolve without an install.
  const compilerOptions: Record<string, unknown> = {
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "Bundler",
    jsx: "react-jsx",
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    lib: ["ES2022", "DOM", "DOM.Iterable"],
  };
  if (local) {
    compilerOptions.paths = {
      "@ryunzz/edit-core": [path.join(repo, "packages/core/src/index.ts")],
      "@ryunzz/edit-core/*": [path.join(repo, "packages/core/src/*")],
      react: [path.join(repo, "node_modules/@types/react")],
      "react/*": [path.join(repo, "node_modules/@types/react/*")],
    };
  }
  writeIfMissing(path.join(root, "tsconfig.json"), `${JSON.stringify({ compilerOptions, include: ["compositions"] }, null, 2)}\n`, created, root);

  if (!local && options.install && !existing) {
    const bun = Boolean(process.versions.bun);
    options.log(`Installing packages with ${bun ? "bun" : "npm"}…`);
    const r = spawnSync(bun ? "bun" : "npm", ["install"], { cwd: root, stdio: "inherit" });
    if (r.status !== 0) options.log("Install failed. Run it yourself in the project folder before edit dev.");
  }
  return { root, created, existing };
}
