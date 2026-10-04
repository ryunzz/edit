import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import { startHelper, type Helper } from "../src/index";

let root: string;
let helper: Helper;

// fetch() won't let us set Host, so use node:http directly.
function get(p: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: helper.port, path: p, headers: { host: `127.0.0.1:${helper.port}`, ...headers } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "edit-helper-"));
  mkdirSync(path.join(root, "compositions"));
  mkdirSync(path.join(root, "assets"));
  writeFileSync(path.join(root, "assets", "a.txt"), "hello");
  writeFileSync(path.join(root, "secret.txt"), "secret");
  writeFileSync(
    path.join(root, "compositions", "one.tsx"),
    `export const meta = { width: 320, height: 180, fps: 24, durationInFrames: 48 };\nexport default function One() { return <div>one</div>; }\n`,
  );
  helper = await startHelper({ projectRoot: root, port: 3400 });
});

afterAll(async () => {
  await helper.close();
  rmSync(root, { recursive: true, force: true });
});

describe("helper security", () => {
  test("refuses requests without the token", async () => {
    expect((await get("/api/compositions")).status).toBe(401);
    expect((await get("/api/compositions", { "x-edit-token": "nope" })).status).toBe(401);
  });

  test("refuses other hosts and origins even with the token", async () => {
    const t = { "x-edit-token": helper.token };
    expect((await get("/api/compositions", { ...t, host: `evil.example:${helper.port}` })).status).toBe(403);
    expect((await get("/api/compositions", { ...t, origin: "https://evil.example" })).status).toBe(403);
    expect((await get("/api/compositions", { ...t, origin: `http://localhost:${helper.port}` })).status).toBe(200);
  });

  test("trades the link token for a same-site cookie", async () => {
    const res = await get(`/?token=${helper.token}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/");
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect((await get("/api/compositions", { cookie: cookie.split(";")[0]! })).status).toBe(200);
  });

  test("serves assets but nothing outside assets/", async () => {
    const t = { "x-edit-token": helper.token };
    expect((await get("/assets/a.txt", t)).body).toBe("hello");
    expect((await get("/assets/%2e%2e/secret.txt", t)).status).toBe(404);
    expect((await get("/assets/..%2fsecret.txt", t)).status).toBe(404);
  });
});

describe("helper", () => {
  test("lists compositions with their settings", async () => {
    const res = await get("/api/compositions", { "x-edit-token": helper.token });
    expect(JSON.parse(res.body)).toEqual([{ id: "one", meta: { width: 320, height: 180, fps: 24, durationInFrames: 48 }, error: null }]);
  });

  test("writes .edit/helper.json for the agent tools", () => {
    const info = JSON.parse(readFileSync(path.join(root, ".edit", "helper.json"), "utf8"));
    expect(info).toMatchObject({ port: helper.port, token: helper.token });
  });

  test("reports build errors to the preview instead of failing", async () => {
    writeFileSync(path.join(root, "compositions", "broken.tsx"), "export default (");
    const res = await get("/preview/broken/bundle.js", { "x-edit-token": helper.token });
    expect(res.status).toBe(200);
    expect(res.body).toContain("__editMountError");
    expect(res.body).toContain("compositions/broken.tsx:1");
  });
});
