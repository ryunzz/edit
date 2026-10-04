import { useLayoutEffect, useRef, type ImgHTMLAttributes } from "react";
import { currentConfig } from "./config";
import { getAssetBase, getMode, registerAudio, reportError } from "./env";
import { useSequenceScope } from "./timeline";
import { waitFor } from "./wait";

/** URL of a file in the project's assets/ folder, e.g. asset("logo.png"). */
export function asset(name: string): string {
  const clean = name.replace(/^\/+/, "").replace(/^assets\//, "");
  if (clean.split("/").some((part) => part === "..")) {
    throw new Error(`asset("${name}"): paths cannot leave the assets folder`);
  }
  return getAssetBase() + clean.split("/").map(encodeURIComponent).join("/");
}

/** An <img> that holds the frame until the image has loaded and decoded. */
export function Img({ src, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const ref = useRef<HTMLImageElement>(null);

  useLayoutEffect(() => {
    const img = ref.current;
    if (!img) return;
    if (img.complete && img.naturalWidth > 0) {
      waitFor(img.decode().catch(() => undefined));
      return;
    }
    waitFor(
      new Promise<void>((resolve) => {
        img.addEventListener(
          "load",
          () => {
            img
              .decode()
              .catch(() => undefined)
              .then(() => resolve());
          },
          { once: true },
        );
        img.addEventListener(
          "error",
          () => {
            reportError(`Image failed to load: ${src}`);
            resolve();
          },
          { once: true },
        );
      }),
    );
  }, [src]);

  return <img ref={ref} src={src} {...rest} />;
}

export interface AudioProps {
  src: string;
  /** 0 to 1. Default 1. */
  volume?: number;
  /** Frames to skip at the start of the file. Default 0. */
  startFrom?: number;
}

/**
 * Plays an audio file for as long as its enclosing <Sequence> (or the whole composition).
 * Draws nothing; in renders it is mixed into the MP4.
 */
export function Audio({ src, volume = 1, startFrom = 0 }: AudioProps) {
  const scope = useSequenceScope();
  if (getMode() === "render") {
    registerAudio({
      src,
      startFrame: scope.offset,
      endFrame: Math.min(scope.end, currentConfig().durationInFrames),
      trimStart: startFrom,
      volume,
    });
  }
  return null;
}
