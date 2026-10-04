import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fromCheckout, initProject } from "../src/init";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "edit-init-"));
const log = () => {};

describe("edit init", () => {
  test("creates a project with the template, agent files and MCP config", () => {
    const parent = tmp();
    const { root, created } = initProject({ dir: path.join(parent, "My Video"), template: "logo", install: false, log });
    for (const f of ["compositions/logo.tsx", "assets/logo.svg", "AGENTS.md", "CLAUDE.md", ".claude/skills/edit/SKILL.md", ".mcp.json", ".cursor/mcp.json", ".gitignore", "package.json", "tsconfig.json"]) {
      expect(existsSync(path.join(root, f))).toBe(true);
      expect(created).toContain(f);
    }
    expect(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).name).toBe("my-video");
    const mcp = JSON.parse(readFileSync(path.join(root, ".mcp.json"), "utf8")).mcpServers.edit;
    expect(mcp.args.at(-1)).toBe("mcp");
    expect(fromCheckout()).toBe(true);
    rmSync(parent, { recursive: true, force: true });
  });

  test("adds only what's missing to an existing project and never overwrites", () => {
    const parent = tmp();
    const { root } = initProject({ dir: path.join(parent, "p"), template: "blank", install: false, log });
    writeFileSync(path.join(root, "AGENTS.md"), "mine");
    rmSync(path.join(root, ".mcp.json"));
    const again = initProject({ dir: root, template: "kinetic", install: false, log });
    expect(again.existing).toBe(true);
    expect(again.created).toEqual([".mcp.json"]);
    expect(readFileSync(path.join(root, "AGENTS.md"), "utf8")).toBe("mine");
    expect(existsSync(path.join(root, "compositions", "kinetic.tsx"))).toBe(false);
    rmSync(parent, { recursive: true, force: true });
  });

  test("refuses a folder with other things in it", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "notes.txt"), "x");
    expect(() => initProject({ dir, template: "blank", install: false, log })).toThrow("isn't empty");
    rmSync(dir, { recursive: true, force: true });
  });
});
