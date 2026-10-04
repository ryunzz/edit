# Making videos in this project

This is an **edit** project: motion graphics written as React components and rendered to MP4 on this computer. Each video is a file in `compositions/`. The user watches your work live in the studio (`edit dev`) and talks to you in the terminal.

## Project layout

```
_assets/        images, audio, footage and fonts for the video; use asset("name")
_refs/          references for inspiration: images, clips, and links in _refs/links.md
compositions/   one .tsx file per video; the file name is its id
renders/        finished MP4s and PNG stills
.edit/          helper state (errors, selection, activity); don't edit by hand
```

## _assets/ and _refs/ are different

- **`_assets/` is material.** Files the video may use: the logo, the music, footage, fonts. Use what fits the brief; you don't have to use every file, and say which ones you left out.
- **`_refs/` is inspiration.** Images, clips and links (YouTube, TikTok, Instagram…) showing the look and feel the user wants, with their notes in `_refs/links.md`. Study them for pacing, typography, colour, framing, transitions and energy. **Never** put a reference in the video, and don't copy one shot for shot.
- Before writing, call `list_refs` and look at each one with `view_ref` (a clip comes back as a grid of frames). Tell the user in a sentence or two what you're taking from them. Links can't be downloaded by edit: open them with your own web tools if you have them, otherwise go by the user's note or ask.

## When _assets/ or _refs/ is empty

Empty folders are normal; don't stop because of them.

- **Nothing in either folder:** go ahead from the prompt. Build the visuals in code (type, shapes, colour, motion) and pick the style yourself. If there's no music, the video is silent; say so, and time it by eye.
- **The prompt names a file that isn't there** ("use score.m4a", "end on logo.png"): don't guess. Tell the user it's missing and ask them to drop it into the studio or `_assets/`, then continue once it's there.
- **The prompt implies material you don't have** ("my logo", "our product shot", "my song"): don't wait. Use a clearly marked placeholder (the brand name set as text, a neutral shape, a silent cut timed to a steady 120 BPM) and tell the user exactly what to drop into `_assets/` to replace it.

## Render cost: ask before multiplying it

- **Keep the fps, size and length the user asked for** (default 1920×1080 at 30 fps). Don't change them on your own.
- **Get the user's OK before anything that multiplies render time**, and say how much: motion blur by drawing extra sub-frames (e.g. a 360 fps source blended down to 30 = 12× the frames), rendering at a higher resolution to scale down, extra passes. Example: "Motion blur would make the final render about 12× longer (roughly 15 minutes instead of 1–2). Want it?"
- **Before any render that will take more than a couple of minutes, say how long you expect it to take.** A 1920×1080 frame takes roughly 0.1–0.3 s; time a short range (`frames: [0, 29]`) if you're unsure. Use `quality: "draft"` (half size) for checks.

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
- Media comes from `_assets/` through `asset()`. Only ask for a file when the prompt names one that isn't there; otherwise work without it (see above).
- Keep each composition in one file unless it grows large; shared components can live in `compositions/_shared.tsx` (files starting with `_` are not compositions).

## Workflow

1. **Look before you write.** `list_compositions` and `list_assets` to see what exists, and `list_refs` + `view_ref` for the style to aim for. For music, `analyze_audio` gives beats and onsets in frames; put cuts and hits on them.
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
