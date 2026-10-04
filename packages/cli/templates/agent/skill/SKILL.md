---
name: edit
description: Make and change motion graphics videos in an edit project (React compositions rendered to MP4), using the material in _assets/ and the style references in _refs/. Use for any request about a video, animation, title, intro, promo, kinetic type, logo sting or render in this folder, and when the user points at something in the edit studio.
---

# edit: motion graphics with React

You are working in an **edit** project. Read `AGENTS.md` in the project root for the full API and rules; this is the short version.

## Loop

1. `list_compositions`, `list_assets`; `list_refs` and `view_ref` for the look to aim for; `analyze_audio` when there is music.
2. Write `compositions/<id>.tsx`: `export const meta = { width, height, fps, durationInFrames }` and a default component that reads `useFrame()`.
3. `get_errors`, then `render_contact_sheet` and look at the image. Fix and look again until it's right.
4. "This" / "here" from the user → `get_selection`.
5. `render_video`, then `get_render_status` until done.

## Must-follow rules

- Everything is a function of `useFrame()`. No `Date.now()`, timers, `requestAnimationFrame`, CSS transitions or animations, or `Math.random()` (use `random(seed)`).
- `interpolate` clamps by default. `spring({ frame: frame - start })` starts at `start`.
- Media only from `_assets/` through `asset("name")`, with `<Img>`, `<Audio>`, `<Video>`. Use what fits; not every asset has to appear.
- `_refs/` is inspiration (images, clips, links): learn pacing, type, colour and transitions from it, never put it in the video.
- Give every `<Sequence>` a `name`.
- Never call a video finished before you have looked at frames of it.
