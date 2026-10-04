import { Browser as BrowserKind, detectBrowserPlatform, getInstalledBrowsers, install, resolveBuildId } from "@puppeteer/browsers";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";

const CACHE_DIR = path.join(os.homedir(), ".cache", "edit", "browsers");

function findPreinstalled(): string | null {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, "/opt/pw-browsers"].filter(Boolean) as string[];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse()) {
      for (const bin of ["chrome-linux/headless_shell", "chrome-headless-shell-linux64/chrome-headless-shell"]) {
        const candidate = path.join(root, dir, bin);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

const byVersion = (a: string, b: string) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};

/** The newest chrome-headless-shell already downloaded, if any. No network. */
async function installedChrome(platform: NonNullable<ReturnType<typeof detectBrowserPlatform>>): Promise<string | null> {
  if (!existsSync(CACHE_DIR)) return null;
  const installed = (await getInstalledBrowsers({ cacheDir: CACHE_DIR }))
    .filter((b) => b.browser === BrowserKind.CHROMEHEADLESSSHELL && b.platform === platform && existsSync(b.executablePath))
    .sort((a, b) => byVersion(b.buildId, a.buildId));
  return installed[0]?.executablePath ?? null;
}

/** True when a headless Chromium is ready without downloading. */
export async function hasChrome(): Promise<boolean> {
  if (process.env.EDIT_CHROME_PATH || findPreinstalled()) return true;
  const platform = detectBrowserPlatform();
  return platform ? (await installedChrome(platform)) !== null : false;
}

/**
 * Finds a headless Chromium: EDIT_CHROME_PATH, then a preinstalled one,
 * then one already downloaded, and only otherwise downloads chrome-headless-shell
 * into ~/.cache/edit/browsers. Renders after the first need no network.
 */
export async function resolveChrome(log: (msg: string) => void = () => {}): Promise<string> {
  if (process.env.EDIT_CHROME_PATH) return process.env.EDIT_CHROME_PATH;
  const pre = findPreinstalled();
  if (pre) return pre;

  const platform = detectBrowserPlatform();
  if (!platform) throw new Error("Unsupported platform for headless Chromium. Set EDIT_CHROME_PATH to a Chrome binary.");
  const cached = await installedChrome(platform);
  if (cached) return cached;
  const buildId = await resolveBuildId(BrowserKind.CHROMEHEADLESSSHELL, platform, "stable");
  log(`Downloading headless Chromium ${buildId} (one time only)…`);
  const installed = await install({ browser: BrowserKind.CHROMEHEADLESSSHELL, buildId, cacheDir: CACHE_DIR, platform });
  return installed.executablePath;
}

export async function launchBrowser(log?: (msg: string) => void): Promise<Browser> {
  const executablePath = await resolveChrome(log);
  const args = [
    "--hide-scrollbars",
    "--force-color-profile=srgb",
    "--font-render-hinting=none",
    "--disable-dev-shm-usage",
    "--autoplay-policy=no-user-gesture-required",
  ];
  if (process.platform === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");
  return puppeteer.launch({ executablePath, headless: "shell", args });
}
