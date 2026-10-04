import { ASSETS_DIR, listAssets } from "@ryunzz/edit-media";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { HelperContext, Route } from "./helper";

const MAX_BYTES = 8 * 1024 * 1024 * 1024;

/** Checks an upload name: a relative path inside _assets/, no dotfiles, no "..". Returns the clean posix path or null. */
export function safeAssetName(name: string): string | null {
  const parts = name.replace(/\\/g, "/").split("/").filter(Boolean);
  if (!parts.length || parts.length > 8) return null;
  for (const p of parts) {
    if (p === "." || p === ".." || p.startsWith(".") || p.length > 200) return null;
    if (/[\u0000-\u001f<>:"|?*]/.test(p)) return null;
  }
  return parts.join("/");
}

/** "logo.png" → "logo-2.png" until the name is free. */
function freeName(root: string, name: string): string {
  if (!existsSync(path.join(root, name))) return name;
  const ext = path.posix.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 2; ; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!existsSync(path.join(root, candidate))) return candidate;
  }
}

/** GET /api/assets lists _assets/ with probed info; PUT /api/assets/<name> streams a file into _assets/. */
export function assetRoutes(ctx: HelperContext): Route {
  const root = path.join(ctx.projectRoot, ASSETS_DIR);
  return async (req, res, url) => {
    if (req.method === "GET" && url.pathname === "/api/assets") {
      ctx.json(res, 200, await listAssets(ctx.projectRoot));
      return true;
    }
    if (req.method === "PUT" && url.pathname.startsWith("/api/assets/")) {
      const name = safeAssetName(decodeURIComponent(url.pathname.slice("/api/assets/".length)));
      if (!name) {
        ctx.json(res, 400, { error: "Asset names must be plain file names inside _assets/" });
        return true;
      }
      const length = Number(req.headers["content-length"] ?? 0);
      if (length > MAX_BYTES) {
        ctx.json(res, 413, { error: "Files over 8 GB can't be uploaded; copy them into _assets/ instead" });
        return true;
      }
      const finalName = url.searchParams.get("replace") === "1" ? name : freeName(root, name);
      const dest = path.join(root, ...finalName.split("/"));
      if (!dest.startsWith(root + path.sep)) {
        ctx.json(res, 400, { error: "Asset names must stay inside _assets/" });
        return true;
      }
      await mkdir(path.dirname(dest), { recursive: true });
      // Write beside the target first, so a half-finished upload never shows up as an asset.
      const tmp = path.join(ctx.projectRoot, ".edit", "tmp", `upload-${process.pid}-${Date.now()}-${path.basename(dest)}`);
      await mkdir(path.dirname(tmp), { recursive: true });
      try {
        await pipeline(req, createWriteStream(tmp));
        await rename(tmp, dest);
      } catch (e) {
        await rm(tmp, { force: true });
        throw e;
      }
      ctx.log(`Added ${ASSETS_DIR}/${finalName}`);
      ctx.events.send("assets", { files: [`${ASSETS_DIR}/${finalName}`] });
      ctx.json(res, 200, { name: finalName });
      return true;
    }
    return false;
  };
}
