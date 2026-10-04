import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export function newToken(): string {
  return randomBytes(24).toString("hex");
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/**
 * The helper can read and write the project, so it answers only this machine and this studio:
 * the Host must be our own address (stops DNS rebinding), any Origin must be our own (stops
 * other websites), and every request must carry the start-up token, as a cookie set when the
 * studio link is opened or as an x-edit-token header.
 */
export class Guard {
  readonly cookieName: string;
  private readonly hosts: string[];

  constructor(
    readonly token: string,
    readonly port: number,
  ) {
    this.cookieName = `edit_token_${port}`;
    this.hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  }

  /** Returns true if the request may proceed; otherwise it has already been answered. */
  check(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
    if (!this.hosts.includes(req.headers.host ?? "")) {
      res.writeHead(403, { "content-type": "text/plain" }).end("Forbidden: wrong host");
      return false;
    }
    const origin = req.headers.origin;
    if (origin && origin !== "null" && !this.hosts.some((h) => origin === `http://${h}`)) {
      res.writeHead(403, { "content-type": "text/plain" }).end("Forbidden: wrong origin");
      return false;
    }

    // Opening the studio link: trade the token in the URL for a cookie, then drop it from the address bar.
    const fromUrl = url.searchParams.get("token");
    if (fromUrl && req.method === "GET" && same(fromUrl, this.token)) {
      url.searchParams.delete("token");
      res
        .writeHead(302, {
          "set-cookie": `${this.cookieName}=${this.token}; HttpOnly; SameSite=Strict; Path=/`,
          location: url.pathname + url.search,
        })
        .end();
      return false;
    }

    const given = (req.headers["x-edit-token"] as string | undefined) ?? cookie(req, this.cookieName);
    if (given && same(given, this.token)) return true;

    if (url.pathname === "/") {
      res
        .writeHead(401, { "content-type": "text/html; charset=utf-8" })
        .end(
          `<!doctype html><meta charset="utf-8"><title>edit</title><body style="background:#0f0f11;color:#ecebe8;font:14px/21px system-ui;padding:48px">` +
            `<p>Open the studio with the link printed by <code>edit dev</code> in your terminal.</p>`,
        );
    } else {
      res.writeHead(401, { "content-type": "text/plain" }).end("Unauthorized: missing or wrong edit token");
    }
    return false;
  }
}
