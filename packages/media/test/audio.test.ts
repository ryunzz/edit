import { describe, expect, test } from "bun:test";
import { analyzeAudio } from "../src/index";
import { fixtures } from "./fixtures";

function medianGap(xs: number[]) {
  const gaps = xs.slice(1).map((x, i) => x - xs[i]!).sort((a, b) => a - b);
  return gaps[gaps.length >> 1]!;
}

describe("analyzeAudio", () => {
  const { p } = fixtures();

  test("120 BPM click track", async () => {
    const a = await analyzeAudio(p("click.wav"), { fps: 30 });
    expect(a.durationSeconds).toBeCloseTo(8, 1);
    expect(a.durationInFrames).toBe(240);
    expect(a.loudness).toHaveLength(240);
    expect(a.bpm).not.toBeNull();
    expect(Math.abs(a.bpm! - 120)).toBeLessThanOrEqual(2);
    expect(a.onsets.length).toBeGreaterThanOrEqual(15);
    expect(a.onsets.length).toBeLessThanOrEqual(17);
    // onsets land on the clicks (every 15 frames from 0)
    for (const o of a.onsets) expect(Math.abs(o - Math.round(o / 15) * 15)).toBeLessThanOrEqual(1);
    expect(a.beats.length).toBeGreaterThanOrEqual(14);
    const gap = medianGap(a.beats);
    expect(gap).toBeGreaterThanOrEqual(14);
    expect(gap).toBeLessThanOrEqual(16);
    expect(Math.max(...a.loudness)).toBeGreaterThan(-30);
    expect(Math.min(...a.loudness)).toBeGreaterThanOrEqual(-60);
  });

  test("silence", async () => {
    const a = await analyzeAudio(p("silence.wav"), { fps: 30 });
    expect(a.bpm).toBeNull();
    expect(a.beats).toEqual([]);
    expect(a.onsets).toEqual([]);
    expect(a.durationInFrames).toBe(120);
    expect(a.loudness.every((v) => v === -60)).toBe(true);
  });

  test("errors name the file", async () => {
    await expect(analyzeAudio(p("missing.wav"), { fps: 30 })).rejects.toThrow(/missing\.wav/);
  });
});
