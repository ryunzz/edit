// Puts an `edit` command on your PATH that runs this checkout's CLI, so you can use
// `edit init`, `edit dev` and `edit render` in any folder without publishing anything.
//   bun run link-cli            → ~/.bun/bin/edit
//   bun run link-cli <dir>      → <dir>/edit
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MARK = "# edit: linked from a source checkout";
const cli = path.resolve(import.meta.dir, "..", "packages", "cli", "src", "index.ts");
const dir = path.resolve(process.argv[2] ?? path.join(os.homedir(), ".bun", "bin"));
const target = path.join(dir, "edit");

if (existsSync(target) && !readFileSync(target, "utf8").includes(MARK)) {
  console.error(`${target} already exists and isn't ours; not touching it. Pass another folder on your PATH.`);
  process.exit(1);
}
writeFileSync(target, `#!/bin/sh\n${MARK}\nexec bun "${cli}" "$@"\n`);
chmodSync(target, 0o755);
console.log(`Linked ${target} → ${cli}`);
if (!(process.env.PATH ?? "").split(path.delimiter).includes(dir)) console.log(`Add ${dir} to your PATH to run \`edit\` anywhere.`);
