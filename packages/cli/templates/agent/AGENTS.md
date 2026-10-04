# Making videos in this project

This is an **edit** project: motion graphics written as React components and rendered to MP4 on this computer. Each video is a file in `compositions/`. The user watches your work live in the studio (`edit dev`) and talks to you in the terminal.

## Project layout

```
_assets/        images, audio, footage and fonts for the video; use asset("name")
compositions/   one .tsx file per video; the file name is its id
renders/        finished MP4s and PNG stills
.edit/          helper state (errors, selection, activity); don't edit by hand
```

## A composition

```tsx
import { AbsoluteFill, Audio, Easing, Img, Sequence, asset, interpolate, spring, useFrame } from "@ryunzz/edit-core";

export const meta = { width: 1920, height: 1080, fps: 30, durationInFrames: 180, background: "#0f0f11" };

export default function Title() {
  const frame = useFrame();
  const opacity = interpolate(frame, [0, 20], [0, 1]);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <Audio src={asset("score.m4a")} />
      <h1 style={{ opacity, color: "white", font: "400 160px Georgia, serif" }}>Hello</h1>
      <Sequence name="logo" from={90}>
        <Logo />
      </Sequence>
    </AbsoluteFill>
  );
}

function Logo() {
  const frame = useFrame(); // counts from 0 at the start of the enclosing <Sequence>
  const scale = spring({ frame, damping: 12 });
  return <Img src={asset("logo.png")} style={{ width: 400, transform: `scale(${scale})` }} />;
}
```

`meta` must have `width`, `height`, `fps` and `durationInFrames` (whole frames). Default to 1920×1080 at 30 fps unless the user asks otherwise. `background` is optional.

## API (`@ryunzz/edit-core`)

| Export | Use |
| --- | --- |
| `useFrame()` | Current frame, from 0 at the start of the nearest `<Sequence>` |
| `useVideoConfig()` | `{ width, height, fps, durationInFrames }` |
| `interpolate(x, [in…], [out…], { easing, extrapolateLeft, extrapolateRight })` | Map ranges, several stops allowed. **Clamps by default**; pass `"extend"` to overshoot |
| `spring({ frame, damping = 10, stiffness = 100, mass = 1, from = 0, to = 1, overshootClamping })` | Physical easing. Negative frames return `from`, so `spring({ frame: frame - 30 })` starts at frame 30 |
| `springDuration({ damping, stiffness, … })` | Frames until a spring settles |
| `Easing.linear / ease / quad / cubic / sin / circle / exp / back(s) / elastic(b) / bezier(x1,y1,x2,y2)` with `Easing.in / out / inOut(fn)` | Curves for `interpolate` |
| `<Sequence from durationInFrames name layout="fill" \| "none">` | Shows children for a span of frames; times inside count from its start. Always give it a `name`; the studio's timeline shows it |
| `<AbsoluteFill>` | Full-size absolutely positioned flex column |
| `asset("name")` | URL of a file in `_assets/` |
| `<Img src>` | Image that holds the frame until it has loaded |
| `<Audio src volume startFrom>` | Sound for the length of its sequence; `startFrom` skips frames of the file |
| `<Video src volume muted startFrom playbackRate style>` | Footage from `_assets/`; renders use exact frames |
| `random(seed)` | Deterministic number in [0, 1) |
| `waitFor(promise)` | Hold the frame until something has loaded (fonts, data) |

Fonts: put the file in `_assets/` and load it with `@font-face { src: url(${asset("Font.woff2")}) }` in a `<style>` tag, or with `waitFor(new FontFace(...).load().then((f) => document.fonts.add(f)))`.

## Rules (every render must be identical)

- Animate from `useFrame()` only. **No** `Date.now()`, `setTimeout`, `setInterval`, `requestAnimationFrame`, CSS transitions or CSS animations.
- **No** `Math.random()`; use `random("seed-" + i)`.
- Anything that loads goes through `waitFor()`; `<Img>` and `<Video>` already do.
- Media comes from `_assets/` through `asset()`. Ask the user to drop files into the studio if something is missing.
- Keep each composition in one file unless it grows large; shared components can live in `compositions/_shared.tsx` (files starting with `_` are not compositions).

## Workflow

1. **Look before you write.** `list_compositions` and `list_assets` to see what exists. For music, `analyze_audio` gives beats and onsets in frames; put cuts and hits on them.
2. **Write** `compositions/<id>.tsx`. The studio reloads on save.
3. **Check** with `get_errors`, then **look** with `render_contact_sheet` (12 frames in one image). Use `render_frame` for a close look at one moment. Check spacing, legibility, timing and that nothing is cut off.
4. **Fix** what you see and look again. Don't report a video as done without having looked at it.
5. When the user says "this", "here" or "that", call `get_selection`: it returns the frame and element they pointed at, with its file and line.
6. **Render** with `render_video` and poll `get_render_status`; the MP4 lands in `renders/`.

Without MCP tools, the same is available on the command line: `edit compositions`, `edit still <id> --frame n`, `edit render <id>`.

## Good motion

- Ease everything: `Easing.out(Easing.cubic)` for entrances, `Easing.in` for exits, springs for pops.
- Stagger related elements by 3–6 frames instead of moving them together.
- Hold important text on screen for at least 1.5 seconds at its resting position.
- Keep text inside the title-safe area (5% inset); the studio's Safe area button shows it.
- Land changes on beats from `analyze_audio`; a hit 1–2 frames before the beat feels on time.
