import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { addLink, listRefs, parseLinks, platformOf, removeLink } from "../src/index";

describe("reference links", () => {
  test("knows the platforms", () => {
    expect(platformOf("https://youtu.be/abc")).toBe("YouTube");
    expect(platformOf("https://www.youtube.com/shorts/abc")).toBe("YouTube");
    expect(platformOf("https://www.tiktok.com/@a/video/1")).toBe("TikTok");
    expect(platformOf("https://www.instagram.com/reel/x/")).toBe("Instagram");
    expect(platformOf("https://example.com/a")).toBe("example.com");
  });

  test("parses markdown lines and skips the header's example", () => {
    const links = parseLinks(
      "# Reference links\n- https://www.youtube.com/watch?v=… — example\n- https://youtu.be/a — fast cuts on the beat\n* <https://tiktok.com/@x/video/2>\nnot a link\n- https://youtu.be/a",
    );
    expect(links).toEqual([
      { url: "https://youtu.be/a", note: "fast cuts on the beat", platform: "YouTube" },
      { url: "https://tiktok.com/@x/video/2", note: "", platform: "TikTok" },
    ]);
  });

  test("adds, updates and removes links in _refs/links.md, keeping the user's other lines", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "edit-refs-"));
    await addLink(root, "https://youtu.be/a", "the type");
    await addLink(root, "https://www.instagram.com/reel/b/");
    await addLink(root, "https://youtu.be/a", "the colour");
    const file = path.join(root, "_refs", "links.md");
    writeFileSync(file, readFileSync(file, "utf8") + "my own notes stay here\n");
    expect((await listRefs(root)).links.map((l) => [l.url, l.note])).toEqual([
      ["https://youtu.be/a", "the colour"],
      ["https://www.instagram.com/reel/b/", ""],
    ]);
    expect(await removeLink(root, "https://youtu.be/a")).toBe(true);
    expect((await listRefs(root)).links.length).toBe(1);
    expect(readFileSync(file, "utf8")).toContain("my own notes stay here");
    await expect(addLink(root, "javascript:alert(1)")).rejects.toThrow("Not a web link");
  });

  test("lists files in _refs/ without links.md", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "edit-refs-"));
    mkdirSync(path.join(root, "_refs"));
    writeFileSync(path.join(root, "_refs", "links.md"), "");
    writeFileSync(path.join(root, "_refs", "mood.woff2"), "x");
    expect((await listRefs(root)).files.map((f) => f.name)).toEqual(["mood.woff2"]);
  });
});
