import { useContext, useLayoutEffect, useRef, type CSSProperties } from "react";
import { currentConfig } from "./config";
import { getMode, registerAudio, reportError } from "./env";
import { LoadedImg, sourceAware, useClip } from "./media";
import { FrameContext } from "./timeline";
import { waitFor } from "./wait";

export interface VideoProps {
  src: string;
  /** Volume of the footage's own sound, 0 to 1. Default 1. */
  volume?: number;
  /** Drop the footage's sound. */
  muted?: boolean;
  /** Frames (at the composition's fps) to skip at the start of the file. Default 0. */
  startFrom?: number;
  /** 2 plays twice as fast. Default 1. */
  playbackRate?: number;
  style?: CSSProperties;
  className?: string;
}

/**
 * Video footage from assets/, playing for the length of its enclosing <Sequence>.
 * In renders every frame is extracted exactly by ffmpeg and drawn as an image;
 * the preview seeks a <video> element to the playhead.
 */
export const Video = sourceAware(function Video(props: VideoProps) {
  const { src, volume = 1, muted = false, startFrom = 0, playbackRate = 1, style, className } = props;
  const source = (props as { __source?: string }).__source;
  const scope = useClip("video", src, source);
  const absolute = useContext(FrameContext);
  const { fps } = currentConfig();
  const index = Math.max(0, Math.round(startFrom + (absolute - scope.offset) * playbackRate));

  if (!muted && volume > 0) {
    registerAudio({
      src,
      startFrame: scope.offset,
      endFrame: Math.min(scope.end, currentConfig().durationInFrames),
      trimStart: startFrom,
      volume,
      rate: playbackRate,
    });
  }

  if (getMode() === "render") {
    const frameUrl = `/__edit/video-frame?src=${encodeURIComponent(src)}&fps=${fps}&i=${index}`;
    return <LoadedImg src={frameUrl} source={source} style={{ objectFit: "cover", ...style }} className={className} />;
  }
  return <SeekedVideo src={src} time={index / fps} source={source} style={style} className={className} />;
});

function SeekedVideo({ src, time, source, style, className }: { src: string; time: number; source?: string; style?: CSSProperties; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useLayoutEffect(() => {
    const video = ref.current;
    if (!video) return;
    // Aim a hair past the frame's start: at an exact boundary, rounding can show the frame before.
    const wanted = time + 0.0005;
    const target = Number.isFinite(video.duration) ? Math.min(wanted, Math.max(0, video.duration - 0.001)) : wanted;
    if (Math.abs(video.currentTime - target) < 0.0002 && video.readyState >= 2) return;
    waitFor(
      new Promise<void>((resolve) => {
        const done = () => {
          video.removeEventListener("seeked", done);
          video.removeEventListener("loadeddata", seek);
          video.removeEventListener("error", failed);
          resolve();
        };
        const failed = () => {
          reportError(`Video failed to load: ${src}`);
          done();
        };
        // Seeking before the first frame has loaded is unreliable; wait for it.
        function seek() {
          video!.removeEventListener("loadeddata", seek);
          video!.addEventListener("seeked", done);
          video!.currentTime = target;
        }
        video.addEventListener("error", failed);
        if (video.readyState >= 2) seek();
        else video.addEventListener("loadeddata", seek);
      }),
    );
  }, [src, time]);
  return <video ref={ref} src={src} muted playsInline preload="auto" data-edit-src={source} style={{ objectFit: "cover", ...style }} className={className} />;
}
