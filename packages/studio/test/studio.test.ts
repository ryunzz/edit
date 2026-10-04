import { describe, expect, test } from "bun:test";
import type { TimelineClip } from "../src/api";
import { shortTimecode, timecode } from "../src/format";
import { packLanes } from "../src/Timeline";

const clip = (id: string, kind: TimelineClip["kind"], from: number, to: number, parent: string | null = null): TimelineClip => ({
  id,
  kind,
  name: id,
  from,
  to,
  parent,
});

describe("timecode", () => {
  test("formats HH:MM:SS:FF", () => {
    expect(timecode(0, 30)).toBe("00:00:00:00");
    expect(timecode(54, 30)).toBe("00:00:01:24");
    expect(timecode(30 * 3661 + 5, 30)).toBe("01:01:01:05");
    expect(shortTimecode(180, 30)).toBe("00:06:00");
  });
});

describe("packLanes", () => {
  test("shares a lane when clips don't overlap, kinds in a fixed order", () => {
    const lanes = packLanes([clip("a", "sequence", 0, 30), clip("b", "sequence", 30, 60), clip("c", "sequence", 20, 40), clip("m", "audio", 0, 60), clip("i", "image", 10, 20)]);
    expect(lanes.map((l) => [l.kind, l.clips.map((c) => c.id)])).toEqual([
      ["sequence", ["a", "b"]],
      ["sequence", ["c"]],
      ["image", ["i"]],
      ["audio", ["m"]],
    ]);
  });

  test("puts nested sequences on their own lanes", () => {
    const lanes = packLanes([clip("outer", "sequence", 0, 60), clip("inner", "sequence", 70, 80, "outer")]);
    expect(lanes.length).toBe(2);
  });
});

describe("packLanes at scale", () => {
  test("thousands of overlapping clips get thousands of lanes, quickly", () => {
    const many = Array.from({ length: 5000 }, (_, i) => clip(`c${i}`, "sequence", i, i + 10_000));
    const started = performance.now();
    const lanes = packLanes(many);
    expect(lanes.length).toBe(5000);
    expect(performance.now() - started).toBeLessThan(1500);
  });

  test("back-to-back clips share one lane", () => {
    const row = Array.from({ length: 20_000 }, (_, i) => clip(`r${i}`, "sequence", i * 2, i * 2 + 2));
    expect(packLanes(row).length).toBe(1);
  });

  test("deep nesting doesn't overflow the stack", () => {
    const deep = Array.from({ length: 20_000 }, (_, i) => clip(`d${i}`, "sequence", 0, 100, i ? `d${i - 1}` : null));
    expect(packLanes(deep).length).toBe(20_000);
  });
});
