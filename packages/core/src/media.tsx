import { useId, useLayoutEffect, useRef, type ImgHTMLAttributes } from "react";
import { currentConfig } from "./config";
import { getAssetBase, registerAudio, registerClip, reportError, type ClipKind } from "./env";
import { SOURCE_AWARE } from "./jsx-dev-runtime";
import { useSequenceScope } from "./timeline";
import { waitFor } from "./wait";

export function sourceAware<T>(component: T): T {
  (component as Record<symbol, boolean>)[SOURCE_AWARE] = true;
  return component;
}

function fileName(src: string): string {
  const path = src.split(/[?#]/)[0] ?? src;
  return decodeURIComponent(path.slice(path.lastIndexOf("/") + 1)) || src;
}

/** Records a media layer on the timeline for the span of its enclosing sequence. */
export function useClip(kind: ClipKind, src: string, source: string | undefined) {
  const id = useId();
  const scope = useSequenceScope();
  registerClip({
    id,
    kind,
    name: fileName(src),
    from: scope.offset,
    to: Math.min(scope.end, currentConfig().durationInFrames),
    parent: scope.id,
    src,
    source,
  });
  return scope;
}

/** URL of a file in the project's _assets/ folder, e.g. asset("logo.png"). */
export function asset(name: string): string {
  const clean = name.replace(/^\/+/, "").replace(/^_?assets\//, "");
  if (clean.split("/").some((part) => part === "..")) {
    throw new Error(`asset("${name}"): paths cannot leave the assets folder`);
  }
  return getAssetBase() + clean.split("/").map(encodeURIComponent).join("/");
}

/** An <img> that holds the frame until the image has loaded and decoded. */
export const Img = sourceAware(function Img({ src, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const { __source, ...imgProps } = rest as typeof rest & { __source?: string };
  useClip("image", src, __source);
  return <LoadedImg src={src} source={__source} {...imgProps} />;
});

export function LoadedImg({ src, source, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string; source?: string }) {
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

  return <img ref={ref} src={src} data-edit-src={source} {...rest} />;
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
export const Audio = sourceAware(function Audio(props: AudioProps) {
  const { src, volume = 1, startFrom = 0 } = props;
  const scope = useClip("audio", src, (props as { __source?: string }).__source);
  registerAudio({
    src,
    startFrame: scope.offset,
    endFrame: Math.min(scope.end, currentConfig().durationInFrames),
    trimStart: startFrom,
    volume,
  });
  return null;
});
