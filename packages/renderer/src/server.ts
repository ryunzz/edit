import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { extractFrames } from "@ryunzz/edit-media";
import { assetFile } from "./project";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".json": "application/json",
};

export function contentType(file: string): string {
  return TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** Streams a file, honouring Range requests so <video> and <audio> can seek. Returns false if it is not a file. */
export function serveFile(req: IncomingMessage, res: ServerResponse, file: string, headers: Record<string, string> = {}): boolean {
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  const size = statSync(file).size;
  const base = { "content-type": contentType(file), "accept-ranges": "bytes", ...headers };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) {
      res.writeHead(416, { "content-range": `bytes */${size}` }).end();
      return true;
    }
    res.writeHead(206, { ...base, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
    if (req.method === "HEAD") res.end();
    else createReadStream(file, { start, end }).pipe(res);
    return true;
  }
  res.writeHead(200, { ...base, "content-length": size });
  if (req.method === "HEAD") res.end();
  else createReadStream(file).pipe(res);
  return true;
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>`;

/**
 * One exact frame of footage, for <Video> in renders: the clip is extracted once at the
 * composition's fps into .edit/cache/frames/, then each frame is a cached JPEG.
 */
async function serveVideoFrame(projectRoot: string, url: URL, req: IncomingMessage, res: ServerResponse) {
  const src = url.searchParams.get("src") ?? "";
  const fps = Number(url.searchParams.get("fps"));
  const index = Number(url.searchParams.get("i"));
  const file = assetFile(projectRoot, src);
  if (!file || !existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain" }).end(`Video not found: ${src}. Put footage in assets/ and use asset("name").`);
    return;
  }
  if (!(fps > 0) || !Number.isInteger(index) || index < 0) {
    res.writeHead(400, { "content-type": "text/plain" }).end("Bad video frame request");
    return;
  }
  try {
    const frames = await extractFrames({ projectRoot, file, fps });
    if (!serveFile(req, res, frames.frameFile(index), { "cache-control": "max-age=3600" })) {
      res.writeHead(404, { "content-type": "text/plain" }).end(`No frames could be read from ${src}`);
    }
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain" }).end(error instanceof Error ? error.message : String(error));
  }
}

export interface CompositionServer {
  url: string;
  close(): Promise<void>;
}

/** Serves the bundled composition and the project's assets on 127.0.0.1 at a random port. */
export async function serveComposition(projectRoot: string, js: string): Promise<CompositionServer> {
  const server: Server = createServer((req, res) => {
    const urlPath = new URL(req.url ?? "/", "http://localhost").pathname;
    if (urlPath === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE);
      return;
    }
    if (urlPath === "/bundle.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }).end(js);
      return;
    }
    if (urlPath === "/__edit/video-frame") {
      void serveVideoFrame(projectRoot, new URL(req.url ?? "/", "http://localhost"), req, res);
      return;
    }
    const file = assetFile(projectRoot, urlPath);
    if (file && serveFile(req, res, file)) return;
    res.writeHead(404).end("Not found");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
