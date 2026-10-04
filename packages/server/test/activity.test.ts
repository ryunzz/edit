import { describe, expect, test } from "bun:test";
import { lineDiff } from "../src/activity";

describe("lineDiff", () => {
  test("keeps only the changed middle", () => {
    expect(lineDiff("a\nb\nc\nd", "a\nB\nC\nd")).toEqual({ removed: ["b", "c"], added: ["B", "C"] });
    expect(lineDiff("a\nb", "a\nb\nc")).toEqual({ removed: [], added: ["c"] });
    expect(lineDiff("same", "same")).toEqual({ removed: [], added: [] });
  });
});
