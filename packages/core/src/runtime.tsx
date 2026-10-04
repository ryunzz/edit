import { Component, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { setCurrentConfig, validateMeta, type CompositionMeta } from "./config";
import { collectedAudio, reportError, setAssetBase, setMode, takeErrors, type AudioClip, type Mode } from "./env";
import { FrameContext, SequenceContext } from "./timeline";
import { settle } from "./wait";

export type { AudioClip } from "./env";

export interface CompositionModule {
  meta?: unknown;
  default?: unknown;
}

export interface EditBridge {
  id: string;
  meta: CompositionMeta;
  /** Draws `frame` and resolves once everything on it has loaded. Rejects with the frame's errors. */
  setFrame(frame: number): Promise<void>;
  audio(): AudioClip[];
}

declare global {
  interface Window {
    __edit?: EditBridge;
    __editMountError?: string;
  }
}

class Boundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    const message = error instanceof Error ? error.message : String(error);
    // Component names only; the bundle's internal stack is noise for whoever fixes it.
    const where = (info.componentStack ?? "")
      .split("\n")
      .map((l) => l.trim().replace(/\s*\(http[^)]*\)$/, "").replace(/@http.*$/, ""))
      .filter(Boolean)
      .slice(0, 4)
      .map((l) => `  ${l.startsWith("at ") || l.startsWith("in ") ? l : `in ${l}`}`)
      .join("\n");
    reportError(where ? `${message}\n${where}` : message);
  }
  render() {
    return this.state.error ? null : this.props.children;
  }
}

function nextPaint() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export function mount(mod: CompositionModule, options: { id: string; mode: Mode; assetBase?: string }) {
  try {
    setMode(options.mode);
    if (options.assetBase) setAssetBase(options.assetBase);
    const meta = validateMeta(mod.meta, options.id);
    setCurrentConfig(meta);
    const Comp = mod.default as ComponentType | undefined;
    if (typeof Comp !== "function") {
      throw new Error(`Composition "${options.id}" must have a default export that is a React component`);
    }

    const el = document.getElementById("root")!;
    Object.assign(el.style, {
      position: "relative",
      width: `${meta.width}px`,
      height: `${meta.height}px`,
      overflow: "hidden",
      background: meta.background ?? "transparent",
    });

    const root = createRoot(el);
    let boundaryKey = 0;

    const draw = (frame: number) => {
      flushSync(() => {
        root.render(
          <Boundary key={boundaryKey}>
            <FrameContext.Provider value={frame}>
              <SequenceContext.Provider value={{ offset: 0, end: meta.durationInFrames }}>
                <Comp />
              </SequenceContext.Provider>
            </FrameContext.Provider>
          </Boundary>,
        );
      });
    };

    window.addEventListener("error", (e) => reportError(e.message));
    window.addEventListener("unhandledrejection", (e) => reportError(String(e.reason)));

    window.__edit = {
      id: options.id,
      meta,
      async setFrame(frame: number) {
        if (!Number.isInteger(frame) || frame < 0 || frame >= meta.durationInFrames) {
          throw new Error(`Frame ${frame} is outside 0–${meta.durationInFrames - 1}`);
        }
        draw(frame);
        await settle();
        await document.fonts.ready;
        await nextPaint();
        const errors = takeErrors();
        if (errors.length) {
          boundaryKey++;
          throw new Error(`Frame ${frame}: ${errors.join("\n")}`);
        }
      },
      audio: collectedAudio,
    };
  } catch (error) {
    window.__editMountError = error instanceof Error ? error.message : String(error);
  }
}
