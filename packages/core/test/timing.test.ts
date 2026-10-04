import { describe, expect, test } from "bun:test";
import { Easing, interpolate, random, spring, springDuration } from "../src/index";

describe("interpolate", () => {
  test("maps linearly and clamps by default", () => {
    expect(interpolate(5, [0, 10], [0, 100])).toBe(50);
    expect(interpolate(-5, [0, 10], [0, 100])).toBe(0);
    expect(interpolate(15, [0, 10], [0, 100])).toBe(100);
  });

  test("extends when asked", () => {
    expect(interpolate(15, [0, 10], [0, 100], { extrapolateRight: "extend" })).toBe(150);
    expect(interpolate(-5, [0, 10], [0, 100], { extrapolateLeft: "extend" })).toBe(-50);
  });

  test("handles several stops", () => {
    expect(interpolate(15, [0, 10, 20], [0, 1, 0])).toBe(0.5);
    expect(interpolate(10, [0, 10, 20], [0, 1, 0])).toBe(1);
  });

  test("applies easing inside the range", () => {
    expect(interpolate(5, [0, 10], [0, 1], { easing: Easing.quad })).toBeCloseTo(0.25);
  });

  test("rejects bad ranges with a clear message", () => {
    expect(() => interpolate(1, [0, 0], [0, 1])).toThrow("strictly increasing");
    expect(() => interpolate(1, [0, 1, 2], [0, 1])).toThrow("same length");
  });
});

describe("Easing", () => {
  test("bezier keeps its endpoints and matches CSS ease midpoint", () => {
    expect(Easing.ease(0)).toBe(0);
    expect(Easing.ease(1)).toBe(1);
    expect(Easing.ease(0.5)).toBeCloseTo(0.8024, 3);
  });

  test("out and inOut mirror the curve", () => {
    expect(Easing.out(Easing.quad)(0.5)).toBeCloseTo(0.75);
    expect(Easing.inOut(Easing.quad)(0.5)).toBeCloseTo(0.5);
  });
});

describe("spring", () => {
  test("starts at from and settles at to", () => {
    expect(spring({ frame: 0, fps: 30 })).toBe(0);
    expect(spring({ frame: 300, fps: 30 })).toBeCloseTo(1, 4);
    expect(spring({ frame: 300, fps: 30, from: 10, to: 20 })).toBeCloseTo(20, 3);
  });

  test("an underdamped spring overshoots unless clamped", () => {
    const peak = Math.max(...Array.from({ length: 60 }, (_, f) => spring({ frame: f, fps: 30, damping: 5 })));
    expect(peak).toBeGreaterThan(1);
    const clamped = Math.max(...Array.from({ length: 60 }, (_, f) => spring({ frame: f, fps: 30, damping: 5, overshootClamping: true })));
    expect(clamped).toBeLessThanOrEqual(1);
  });

  test("critically and over-damped springs never overshoot", () => {
    for (const damping of [20, 40]) {
      const values = Array.from({ length: 120 }, (_, f) => spring({ frame: f, fps: 30, damping }));
      expect(Math.max(...values)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  test("springDuration finds when it settles", () => {
    const d = springDuration({ fps: 30, damping: 20 });
    expect(d).toBeGreaterThan(5);
    expect(Math.abs(spring({ frame: d, fps: 30, damping: 20 }) - 1)).toBeLessThan(0.001);
  });
});

describe("random", () => {
  test("is deterministic and in [0, 1)", () => {
    expect(random("a")).toBe(random("a"));
    expect(random("a")).not.toBe(random("b"));
    for (let i = 0; i < 1000; i++) {
      const v = random(i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
