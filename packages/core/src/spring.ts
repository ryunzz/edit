import { currentConfig } from "./config";

export interface SpringOptions {
  /** Frame relative to the spring's start. Negative frames return `from`. */
  frame: number;
  /** Defaults to the current composition's fps. */
  fps?: number;
  damping?: number;
  stiffness?: number;
  mass?: number;
  from?: number;
  to?: number;
  /** Never go past `to`. */
  overshootClamping?: boolean;
}

/**
 * A damped spring from `from` to `to`, evaluated in closed form so any frame
 * can be computed directly and every render is identical.
 */
export function spring({
  frame,
  fps = currentConfig().fps,
  damping = 10,
  stiffness = 100,
  mass = 1,
  from = 0,
  to = 1,
  overshootClamping = false,
}: SpringOptions): number {
  if (frame <= 0) return from;
  const t = frame / fps;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));

  // Displacement from the target, starting at 1 with zero velocity.
  let x: number;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    x = Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  } else if (zeta === 1) {
    x = Math.exp(-w0 * t) * (1 + w0 * t);
  } else {
    const s = w0 * Math.sqrt(zeta * zeta - 1);
    const r1 = -zeta * w0 + s;
    const r2 = -zeta * w0 - s;
    x = (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
  }

  let progress = 1 - x;
  if (overshootClamping && progress > 1) progress = 1;
  return from + (to - from) * progress;
}

/** Frames until the spring stays within `threshold` of its target. */
export function springDuration(options: Omit<SpringOptions, "frame"> & { threshold?: number }): number {
  const { threshold = 0.001, ...rest } = options;
  const fps = rest.fps ?? currentConfig().fps;
  const from = rest.from ?? 0;
  const to = rest.to ?? 1;
  const span = Math.abs(to - from) || 1;
  let settledSince = -1;
  for (let f = 1; f < fps * 60; f++) {
    const v = spring({ ...rest, fps, frame: f });
    if (Math.abs(v - to) / span < threshold) {
      if (settledSince < 0) settledSince = f;
      if (f - settledSince > fps / 4) return settledSince;
    } else settledSince = -1;
  }
  return fps * 60;
}
