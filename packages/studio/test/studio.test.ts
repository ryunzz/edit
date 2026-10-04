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
