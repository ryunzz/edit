import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HelperContext, Route } from "./helper";

export interface Selection {
  composition: string;
  frame: number;
  timecode: string;
  element: {
    tag: string;
    text: string;
    /** "compositions/title.tsx:24" */
    source: string | null;
    /** Name of the enclosing <Sequence>, if any. */
    sequence: string | null;
    /** In composition pixels. */
    box: { x: number; y: number; width: number; height: number };
  };
  at: string;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);

function parse(body: unknown): Selection | null {
  const b = body as Record<string, any>;
  if (!b || typeof b.composition !== "string" || !Number.isInteger(b.frame) || !b.element) return null;
  const e = b.element;
  return {
    composition: b.composition.slice(0, 100),
    frame: b.frame,
    timecode: str(b.timecode, 20) ?? "",
    element: {
      tag: str(e.tag, 40) ?? "element",
      text: str(e.text, 200) ?? "",
      source: str(e.source, 300),
      sequence: str(e.sequence, 100),
      box: { x: num(e.box?.x), y: num(e.box?.y), width: num(e.box?.width), height: num(e.box?.height) },
    },
    at: new Date().toISOString(),
  };
}

/** "Point agent here": the studio stores what the user clicked in .edit/selection.json, read by get_selection. */
export function selectionRoutes(ctx: HelperContext): Route {
  const file = path.join(ctx.projectRoot, ".edit", "selection.json");
  return async (req, res, url) => {
    if (url.pathname !== "/api/selection") return false;
    if (req.method === "GET") {
      ctx.json(res, 200, existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);
    } else if (req.method === "POST") {
      const sel = parse(await ctx.readJson(req));
      if (!sel) return ctx.json(res, 400, { error: "Expected { composition, frame, element }" }), true;
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify(sel, null, 2));
      await rename(`${file}.tmp`, file);
      ctx.events.send("selection", sel);
      ctx.json(res, 200, sel);
    } else if (req.method === "DELETE") {
      await rm(file, { force: true });
      ctx.events.send("selection", null);
      ctx.json(res, 200, null);
    } else return false;
    return true;
  };
}
