import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createEditServer } from "../src/index";

let root: string;
let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text?: string; data?: string }[] };
const textOf = (r: Awaited<ReturnType<typeof call>>) => r.content.find((c) => c.type === "text")?.text ?? "";

beforeAll(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "edit-mcp-"));
  cpSync(path.join(import.meta.dir, "../../../examples/hello/compositions"), path.join(root, "compositions"), { recursive: true });
  cpSync(path.join(import.meta.dir, "../../../examples/hello/_assets"), path.join(root, "_assets"), { recursive: true });
  const server = createEditServer({ projectRoot: root });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "claude-code", version: "1.0.0" });
  await client.connect(b);
});

afterAll(async () => {
  await client.close();
  rmSync(root, { recursive: true, force: true });
});

describe("edit MCP tools", () => {
  test("offers the spec's tools", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "analyze_audio",
      "get_composition",
      "get_errors",
      "get_render_status",
      "get_selection",
      "list_assets",
      "list_compositions",
      "render_contact_sheet",
      "render_frame",
      "render_video",
    ]);
  });

  test("records the connected agent", async () => {
    await Bun.sleep(50);
    expect(JSON.parse(readFileSync(path.join(root, ".edit", "agent.json"), "utf8")).name).toBe("Claude Code");
  });

  test("list_compositions and list_assets", async () => {
    expect(JSON.parse(textOf(await call("list_compositions")))).toEqual([{ id: "title", width: 1920, height: 1080, fps: 30, durationInFrames: 180, seconds: 6 }]);
    const assets = JSON.parse(textOf(await call("list_assets"))) as { name: string; kind: string }[];
    expect(assets.map((a) => [a.name, a.kind])).toEqual([
      ["logo.svg", "image"],
      ["score.m4a", "audio"],
    ]);
  });

  test("get_composition returns the timeline with source lines", async () => {
    const info = JSON.parse(textOf(await call("get_composition", { id: "title" })));
    const move = info.clips.find((c: { name: string }) => c.name === "move");
    expect(move).toMatchObject({ kind: "sequence", from: 30, to: 120 });
    expect(move.source).toMatch(/^compositions\/title\.tsx:\d+$/);
  }, 30_000);

  test("render_contact_sheet returns an image and logs activity", async () => {
    const r = await call("render_contact_sheet", { id: "title", count: 4 });
    expect(r.isError).toBeFalsy();
    const image = r.content.find((c) => c.type === "image")!;
    expect(Buffer.from(image.data!, "base64").subarray(1, 4).toString()).toBe("PNG");
    const feed = readFileSync(path.join(root, ".edit", "activity.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(feed.at(-1)).toMatchObject({ agent: "Claude Code", kind: "sheet", title: "Checked 4 frames" });
  }, 30_000);

  test("analyze_audio reports beats in frames", async () => {
    const a = JSON.parse(textOf(await call("analyze_audio", { asset: "score.m4a" })));
    expect(a.fps).toBe(30);
    expect(a.durationInFrames).toBeGreaterThan(170);
    expect(a.loudness.length).toBe(a.durationInFrames);
  }, 30_000);

  test("get_errors names the file and line of a build error", async () => {
    writeFileSync(path.join(root, "compositions", "broken.tsx"), "export const meta = {};\nexport default function B() { return <div>; }\n");
    const report = textOf(await call("get_errors", { id: "broken" }));
    expect(report).toContain("compositions/broken.tsx:2");
    expect(textOf(await call("get_errors", { id: "title" }))).toContain("No errors");
  }, 30_000);

  test("get_selection explains how to point", async () => {
    expect(textOf(await call("get_selection"))).toContain("Point agent here");
  });

  test("tool errors are returned to the agent, not thrown", async () => {
    const r = await call("render_frame", { id: "nope", frame: 0 });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('No composition "nope"');
  });
});
