import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fromCheckout, initProject, invalidProjectName, resolveProjectDir } from "../src/init";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "edit-init-"));
const log = () => {};

describe("edit init", () => {
  test("creates a project with the template, agent files and MCP config", async () => {
    const parent = tmp();
    const { root, created } = await initProject({ dir: path.join(parent, "My Video"), template: "logo", install: false, log });
    for (const f of ["compositions/logo.tsx", "_assets/logo.svg", "_refs/links.md", "AGENTS.md", "CLAUDE.md", ".claude/skills/edit/SKILL.md", ".mcp.json", ".cursor/mcp.json", ".gitignore", "package.json", "tsconfig.json"]) {
      expect(existsSync(path.join(root, f))).toBe(true);
      expect(created).toContain(f);
    }
    expect(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).name).toBe("my-video");
    const mcp = JSON.parse(readFileSync(path.join(root, ".mcp.json"), "utf8")).mcpServers.edit;
    expect(mcp.args.at(-1)).toBe("mcp");
    expect(fromCheckout()).toBe(true);
    rmSync(parent, { recursive: true, force: true });
  });

  test("adds only what's missing to an existing project and never overwrites", async () => {
    const parent = tmp();
    const { root } = await initProject({ dir: path.join(parent, "p"), template: "blank", install: false, log });
    writeFileSync(path.join(root, "AGENTS.md"), "mine");
    rmSync(path.join(root, ".mcp.json"));
    const again = await initProject({ dir: root, template: "kinetic", install: false, log });
    expect(again.existing).toBe(true);
    expect(again.created).toEqual([".mcp.json"]);
    expect(readFileSync(path.join(root, "AGENTS.md"), "utf8")).toBe("mine");
    expect(existsSync(path.join(root, "compositions", "kinetic.tsx"))).toBe(false);
    rmSync(parent, { recursive: true, force: true });
  });

  test("refuses a folder with other things in it", async () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "notes.txt"), "x");
    await expect(initProject({ dir, template: "blank", install: false, log })).rejects.toThrow("isn't empty");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("project names", () => {
  test("a bare name goes in _projects/ of this checkout, whatever the checkout is called", async () => {
    const checkout = path.resolve(import.meta.dir, "..", "..", "..");
    expect(resolveProjectDir("my-video")).toBe(path.join(checkout, "_projects", "my-video"));
  });

  test("anything that looks like a path is taken as a path", async () => {
    expect(resolveProjectDir(".", "/tmp/x")).toBe("/tmp/x");
    expect(resolveProjectDir("./clip", "/tmp/x")).toBe("/tmp/x/clip");
    expect(resolveProjectDir("../clip", "/tmp/x")).toBe("/tmp/clip");
    expect(resolveProjectDir("a/b", "/tmp/x")).toBe("/tmp/x/a/b");
    expect(resolveProjectDir("/abs/p")).toBe("/abs/p");
    expect(resolveProjectDir("~/m/p")).toBe(path.join(os.homedir(), "m/p"));
  });
});

describe("project name collisions", () => {
  const checkout = path.resolve(import.meta.dir, "..", "..", "..");
  const name = `zz-test-${process.pid}`;
  const dir = path.join(checkout, "_projects", name);

  test("a name that's taken fails and says how to open the existing project", async () => {
    try {
      await initProject({ dir: name, template: "blank", install: false, log });
      expect(existsSync(path.join(dir, "compositions", "main.tsx"))).toBe(true);
      writeFileSync(path.join(dir, "AGENTS.md"), "mine");
      await expect(initProject({ dir: name, template: "kinetic", install: false, log })).rejects.toThrow(`You already have a project called "${name}"`);
      await expect(initProject({ dir: name, template: "kinetic", install: false, log })).rejects.toThrow(`edit dev ${name}`);
      // Same name in other letter case is the same folder on macOS: still a clash, naming the real one.
      await expect(initProject({ dir: name.toUpperCase(), template: "blank", install: false, log })).rejects.toThrow(`called "${name}"`);
      expect(readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toBe("mine");
      expect(existsSync(path.join(dir, "compositions", "kinetic.tsx"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("names that can't be folders are refused before anything is created", async () => {
    for (const bad of [".hidden", "-flag", "a:b", "what?", "trailing ", "con", ""]) {
      expect(invalidProjectName(bad)).not.toBeNull();
    }
    expect(invalidProjectName("Q4 Recap")).toBeNull();
    expect(invalidProjectName("logo_v2")).toBeNull();
    await expect(initProject({ dir: "a:b", template: "blank", install: false, log })).rejects.toThrow("Can't create a project");
    expect(existsSync(path.join(checkout, "_projects", "a:b"))).toBe(false);
  });
});
