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

/**
 * PUT <prefix><name> streams a file into a project folder (_assets/ or _refs/), through a temp
 * file so a half-finished upload never shows up. Existing names get a -2 suffix.
 */
export function uploadRoute(ctx: HelperContext, options: { prefix: string; folder: string; event: string; reserved?: string[] }): Route {
  const root = path.join(ctx.projectRoot, options.folder);
  return async (req, res, url) => {
    if (req.method !== "PUT" || !url.pathname.startsWith(options.prefix)) return false;
    const name = safeAssetName(decodeURIComponent(url.pathname.slice(options.prefix.length)));
    if (!name || options.reserved?.includes(name)) {
      ctx.json(res, 400, { error: `File names must be plain names inside ${options.folder}/` });
      return true;
    }
    const length = Number(req.headers["content-length"] ?? 0);
    if (length > MAX_BYTES) {
      ctx.json(res, 413, { error: `Files over 8 GB can't be uploaded; copy them into ${options.folder}/ instead` });
      return true;
    }
    const finalName = url.searchParams.get("replace") === "1" ? name : freeName(root, name);
    const dest = path.join(root, ...finalName.split("/"));
    if (!dest.startsWith(root + path.sep)) {
      ctx.json(res, 400, { error: `File names must stay inside ${options.folder}/` });
      return true;
    }
    await mkdir(path.dirname(dest), { recursive: true });
    const tmp = path.join(ctx.projectRoot, ".edit", "tmp", `upload-${process.pid}-${Date.now()}-${path.basename(dest)}`);
    await mkdir(path.dirname(tmp), { recursive: true });
    try {
      await pipeline(req, createWriteStream(tmp));
      await rename(tmp, dest);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    ctx.log(`Added ${options.folder}/${finalName}`);
    ctx.events.send(options.event, { files: [`${options.folder}/${finalName}`] });
    ctx.json(res, 200, { name: finalName });
    return true;
  };
}

/** GET /api/assets lists _assets/ with probed info; PUT /api/assets/<name> uploads into it. */
export function assetRoutes(ctx: HelperContext): Route {
  const upload = uploadRoute(ctx, { prefix: "/api/assets/", folder: ASSETS_DIR, event: "assets" });
  return async (req, res, url) => {
    if (req.method === "GET" && url.pathname === "/api/assets") {
      ctx.json(res, 200, await listAssets(ctx.projectRoot));
      return true;
    }
    return upload(req, res, url);
  };
}
