import { addLink, LINKS_FILE, listRefs, REFS_DIR, removeLink } from "@ryunzz/edit-media";
import { serveFile } from "@ryunzz/edit-renderer";
import path from "node:path";
import { safeAssetName, uploadRoute } from "./assets";
import type { HelperContext, Route } from "./helper";

/**
 * _refs/: references the agent learns from but never puts in a video. Files are uploaded like
 * assets; links (YouTube, TikTok, Instagram…) are kept in _refs/links.md.
 */
export function refsRoutes(ctx: HelperContext): Route {
  const upload = uploadRoute(ctx, { prefix: "/api/refs/files/", folder: REFS_DIR, event: "refs", reserved: [LINKS_FILE] });
  return async (req, res, url) => {
    const p = url.pathname;
    if (req.method === "GET" && p === "/api/refs") {
      ctx.json(res, 200, await listRefs(ctx.projectRoot));
      return true;
    }
    if (p === "/api/refs/links" && req.method === "POST") {
      const body = (await ctx.readJson(req)) as { url?: unknown; note?: unknown };
      try {
        const link = await addLink(ctx.projectRoot, String(body.url ?? ""), typeof body.note === "string" ? body.note.slice(0, 300) : "");
        ctx.events.send("refs", { links: [link.url] });
        ctx.json(res, 200, link);
      } catch (e) {
        ctx.json(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
      return true;
    }
    if (p === "/api/refs/links" && req.method === "DELETE") {
      const removed = await removeLink(ctx.projectRoot, url.searchParams.get("url") ?? "");
      if (removed) ctx.events.send("refs", {});
      ctx.json(res, removed ? 200 : 404, { ok: removed });
      return true;
    }
    if ((req.method === "GET" || req.method === "HEAD") && p.startsWith("/refs/")) {
      const name = safeAssetName(decodeURIComponent(p.slice("/refs/".length)));
      if (name && serveFile(req, res, path.join(ctx.projectRoot, REFS_DIR, ...name.split("/")), { "cache-control": "no-cache" })) return true;
    }
    return upload(req, res, url);
  };
}
