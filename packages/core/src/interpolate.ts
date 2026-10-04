import type { EasingFn } from "./easing";

export type Extrapolate = "clamp" | "extend";

export interface InterpolateOptions {
  easing?: EasingFn;
  /** Behaviour before the first input value. Default "clamp". */
  extrapolateLeft?: Extrapolate;
  /** Behaviour after the last input value. Default "clamp". */
  extrapolateRight?: Extrapolate;
}

/**
 * Maps `input` from `inputRange` to `outputRange`, piecewise-linearly between stops.
 * Clamps at both ends by default, so animations hold their end values.
 */
export function interpolate(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  options: InterpolateOptions = {},
): number {
  if (inputRange.length !== outputRange.length) {
    throw new Error(
      `interpolate: inputRange (${inputRange.length}) and outputRange (${outputRange.length}) must be the same length`,
    );
  }
  if (inputRange.length < 2) throw new Error("interpolate: ranges need at least two values");
  for (let i = 1; i < inputRange.length; i++) {
    if (!(inputRange[i]! > inputRange[i - 1]!)) {
      throw new Error(`interpolate: inputRange must be strictly increasing, got [${inputRange.join(", ")}]`);
    }
  }
  if (Number.isNaN(input)) throw new Error("interpolate: input is NaN");

  const { easing = (t: number) => t, extrapolateLeft = "clamp", extrapolateRight = "clamp" } = options;
  const last = inputRange.length - 1;

  let seg = 0;
  while (seg < last - 1 && input > inputRange[seg + 1]!) seg++;

  const inMin = inputRange[seg]!;
  const inMax = inputRange[seg + 1]!;
  const outMin = outputRange[seg]!;
  const outMax = outputRange[seg + 1]!;

  if (input < inputRange[0]! && extrapolateLeft === "clamp") return outputRange[0]!;
  if (input > inputRange[last]! && extrapolateRight === "clamp") return outputRange[last]!;

  let t = (input - inMin) / (inMax - inMin);
  if (t >= 0 && t <= 1) t = easing(t);
  return outMin + t * (outMax - outMin);
}
