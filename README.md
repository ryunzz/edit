# edit

Make motion graphics with your coding agent. Videos are React components driven by the frame number; edit renders them to MP4 on your own machine with headless Chromium and ffmpeg.

> Status: early. Rendering stills and MP4s with audio and footage works, and `edit dev` opens the studio with a live preview and read-only timeline. MCP tools for agents and `edit init` are next (see the spec's milestones).

## Try it

Needs [Bun](https://bun.sh) 1.3+ and ffmpeg (`brew install ffmpeg`). Headless Chromium downloads itself on the first render.

```sh
bun install
cd examples/hello
bun ../../packages/cli/src/index.ts still title --frame 60   # → renders/title-f60.png
bun ../../packages/cli/src/index.ts render title            # → renders/title.mp4
bun ../../packages/cli/src/index.ts dev                     # → opens the studio
```

## A composition

Each file in `compositions/` exports its settings and a component:

```tsx
import { Sequence, asset, Img, Audio, interpolate, spring, useFrame } from "@ryunzz/edit-core";

export const meta = { width: 1920, height: 1080, fps: 30, durationInFrames: 150, background: "#000" };

export default function Title() {
  const frame = useFrame();
  const opacity = interpolate(frame, [0, 20], [0, 1]);
  return (
    <>
      <Audio src={asset("music.m4a")} />
      <h1 style={{ opacity, color: "white" }}>Hello</h1>
      <Sequence from={60} name="logo">
        <Img src={asset("logo.png")} style={{ transform: `scale(${spring({ frame: frame - 60 })})` }} />
      </Sequence>
    </>
  );
}
```

Rules that keep every render identical:

- Animate from `useFrame()` only: no `Date.now()`, timers or CSS transitions.
- Use `random(seed)` instead of `Math.random()`.
- Wrap anything that loads in `waitFor(promise)`; `<Img>` already does.

### API (`@ryunzz/edit-core`)

| Export | What it does |
| --- | --- |
| `useFrame()` | Current frame, counted from the start of the nearest `<Sequence>` |
| `useVideoConfig()` | `{ width, height, fps, durationInFrames }` |
| `interpolate(x, input, output, { easing, extrapolateLeft, extrapolateRight })` | Maps a value between ranges; clamps by default |
| `spring({ frame, damping, stiffness, mass, from, to })` | Physically based easing, evaluated in closed form |
| `Easing` | `linear`, `ease`, `quad`, `cubic`, `sin`, `circle`, `exp`, `back()`, `elastic()`, `bezier()`, `in/out/inOut()` |
| `<Sequence from durationInFrames name>` | Shows children for a span of frames |
| `<AbsoluteFill>` | A full-size absolutely positioned layer |
| `asset(name)` | URL of a file in `assets/` |
| `<Img>` | An image that holds the frame until it has loaded |
| `<Audio src volume startFrom>` | Mixed into the MP4 for the length of its sequence |
| `<Video src volume muted startFrom playbackRate>` | Footage from `assets/`; renders use exact frames extracted by ffmpeg |
| `random(seed)` | Deterministic number in [0, 1) |
| `waitFor(promise)` | Hold the frame until the promise settles |

## CLI

```
edit dev [--port n] [--no-open]   Open the studio: live preview, scrubbing, read-only timeline
edit compositions                 List compositions
edit still <id> [--frame n]       Render one frame to PNG
edit render <id> [--frames a-b]   Render to MP4
  --out <path>  --scale <n>  --concurrency <n>  --project <dir>
```

Environment overrides: `EDIT_CHROME_PATH`, `EDIT_FFMPEG_PATH`.

## Studio

`edit dev` starts the helper on `127.0.0.1:3210` (or the next free port) and opens the studio. Saving any file in the project reloads the preview at the same frame; build and runtime errors appear over the last good frame and are written to `.edit/errors.json` for agents. Space plays, ←/→ step a frame (with Shift, a second), Home/End jump.

The helper only answers this machine: it checks the Host and Origin of every request and needs the token from the link it prints (kept as a same-site cookie afterwards).

## Packages

| Package | Role |
| --- | --- |
| `packages/core` (`@ryunzz/edit-core`) | The API compositions are written against, plus the in-browser runtime |
| `packages/renderer` (`@ryunzz/edit-renderer`) | Bundles a composition, drives headless Chromium, encodes with ffmpeg |
| `packages/media` (`@ryunzz/edit-media`) | Probing, audio beat analysis and footage frame extraction with ffmpeg |
| `packages/server` (`@ryunzz/edit-server`) | The helper behind `edit dev`: serves the studio on 127.0.0.1, watches the project, hot-reloads previews |
| `packages/studio` (`@ryunzz/edit-studio`) | The studio UI in the Reel design system |
| `packages/cli` (`@ryunzz/edit`) | The `edit` command |
| `examples/hello` | A 6-second kinetic title with audio and an image |

`bun test` runs the tests; `bun run typecheck` checks types.

## Licence

Source-available under the [PolyForm Small Business License 1.0.0](LICENSE.md): free for individuals and businesses with fewer than 100 people and under $1M revenue. Larger companies need a commercial licence; contact the author.
