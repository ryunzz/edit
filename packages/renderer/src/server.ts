import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
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

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>`;

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
    const file = assetFile(projectRoot, urlPath);
    if (file && existsSync(file) && statSync(file).isFile()) {
      res.writeHead(200, {
        "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
        "content-length": statSync(file).size,
      });
      createReadStream(file).pipe(res);
      return;
    }
    res.writeHead(404).end("Not found");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
