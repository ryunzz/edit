export type EasingFn = (t: number) => number;

// Cubic bezier with control points (x1, y1) and (x2, y2), endpoints fixed at (0,0) and (1,1).
// Solves x(s) = t with Newton steps, falling back to bisection.
function bezier(x1: number, y1: number, x2: number, y2: number): EasingFn {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number) => ((ay * s + by) * s + cy) * s;
  const slopeX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;

  const solve = (x: number) => {
    let s = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(s) - x;
      if (Math.abs(err) < 1e-7) return s;
      const d = slopeX(s);
      if (Math.abs(d) < 1e-7) break;
      s -= err / d;
    }
    let lo = 0;
    let hi = 1;
    s = x;
    for (let i = 0; i < 40; i++) {
      const v = sampleX(s);
      if (Math.abs(v - x) < 1e-7) return s;
      if (v < x) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return s;
  };

  return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : sampleY(solve(t)));
}

export const Easing = {
  linear: ((t) => t) as EasingFn,
  ease: bezier(0.25, 0.1, 0.25, 1),
  quad: ((t) => t * t) as EasingFn,
  cubic: ((t) => t * t * t) as EasingFn,
  sin: ((t) => 1 - Math.cos((t * Math.PI) / 2)) as EasingFn,
  circle: ((t) => 1 - Math.sqrt(1 - t * t)) as EasingFn,
  exp: ((t) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1)))) as EasingFn,
  back: (s = 1.70158): EasingFn => (t) => t * t * ((s + 1) * t - s),
  elastic: (bounciness = 1): EasingFn => {
    const p = bounciness * Math.PI;
    return (t) => 1 - Math.pow(Math.cos((t * Math.PI) / 2), 3) * Math.cos(t * p);
  },
  bezier,
  in: (fn: EasingFn): EasingFn => fn,
  out: (fn: EasingFn): EasingFn => (t) => 1 - fn(1 - t),
  inOut: (fn: EasingFn): EasingFn => (t) => (t < 0.5 ? fn(t * 2) / 2 : 1 - fn((1 - t) * 2) / 2),
};
