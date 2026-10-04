import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { setCurrentConfig } from "../src/config";
import { collectedTimeline } from "../src/env";
import { jsxDEV } from "../src/jsx-dev-runtime";
import { Audio, Img } from "../src/media";
import { FrameContext, Sequence, SequenceContext } from "../src/timeline";

function drawAll(Comp: () => React.ReactNode, durationInFrames: number) {
  setCurrentConfig({ width: 100, height: 100, fps: 30, durationInFrames });
  for (let f = 0; f < durationInFrames; f++) {
    renderToStaticMarkup(
      <FrameContext.Provider value={f}>
        <SequenceContext.Provider value={{ offset: 0, end: durationInFrames, id: null }}>
          <Comp />
        </SequenceContext.Provider>
      </FrameContext.Provider>,
    );
  }
  return collectedTimeline();
}

describe("timeline", () => {
  test("records sequences, nesting and media with absolute frames", () => {
    const clips = drawAll(
      () => (
        <>
          <Audio src="/assets/score.m4a" />
          <Sequence name="intro" durationInFrames={30}>
            <Sequence name="word" from={10}>
              <Img src="/assets/logo.png" />
            </Sequence>
          </Sequence>
          <Sequence name="outro" from={40} />
        </>
      ),
      60,
    );
    const by = (name: string) => clips.find((c) => c.name === name)!;
    expect(by("score.m4a")).toMatchObject({ kind: "audio", from: 0, to: 60, parent: null });
    expect(by("intro")).toMatchObject({ kind: "sequence", from: 0, to: 30, parent: null });
    expect(by("word")).toMatchObject({ kind: "sequence", from: 10, to: 30, parent: by("intro").id });
    expect(by("logo.png")).toMatchObject({ kind: "image", from: 10, to: 30, parent: by("word").id });
    expect(by("outro")).toMatchObject({ from: 40, to: 60 });
  });
});

describe("jsx runtime", () => {
  test("tags host elements and sequences from project files only", () => {
    const own = jsxDEV("h1", {}, undefined, false, { fileName: "compositions/title.tsx", lineNumber: 24 }) as { props: Record<string, unknown> };
    expect(own.props["data-edit-src"]).toBe("compositions/title.tsx:24");
    const lib = jsxDEV("div", {}, undefined, false, { fileName: "../../packages/core/src/timeline.tsx", lineNumber: 3 }) as { props: Record<string, unknown> };
    expect(lib.props["data-edit-src"]).toBeUndefined();
    const seq = jsxDEV(Sequence, {}, undefined, false, { fileName: "compositions/a.tsx", lineNumber: 7 }) as { props: Record<string, unknown> };
    expect(seq.props.__source).toBe("compositions/a.tsx:7");
  });
});
