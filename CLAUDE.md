# edit — context for Claude Code

A local-first motion graphics engine that any coding agent drives. Videos are React components driven by the frame number. The user's agent writes compositions; a local studio shows them live; renders happen on the user's machine.

- Spec (decisions, user flow, architecture, MCP tools, milestones): https://claude.ai/code/artifact/5a8a3516-d6af-49b0-a8f0-d3ba4e2780c7
- Approved-direction designs (Connect, Studio, Renders screens, Reel design system): https://claude.ai/artifact/BV15pzUgXnc8XfELvR6Hr8

## Decisions

- Own engine, built from scratch. Source-available, PolyForm Small Business 1.0.0 (LICENSE.md); commercial licences for larger companies later. Never relicense as MIT/open source.
- npm scope `@ryunzz`: CLI `@ryunzz/edit` (command `edit`), packages `@ryunzz/edit-*`.
- Bun for the repo (workspaces, `bun test`); published CLI should also run on Node 20+.
- macOS first. Default 30 fps for new projects.
- No built-in chat or model settings in the MVP: the agent is the user's own (Claude Code, Codex, Cursor). Timeline is read-only in the MVP.
- Studio is served by the local helper on 127.0.0.1, not hosted. Helper must check Origin, use a startup token, and stay inside the project folder.
- ffmpeg runs natively. Because the product is paid, prefer an LGPL ffmpeg with the system H.264 encoder (VideoToolbox on macOS); do not bundle GPL x264 builds.
- Assets (images, audio, video footage, fonts) live in the project's `assets/`, referenced with `asset("name")`. Footage is in the MVP: exact frames extracted by ffmpeg at render time.
- Studio UI uses the Reel design system: dark neutral panels, Geist / Geist Mono / Instrument Serif, the blue playhead (#0077b6) as the only signal colour, clip colours by type.

## Layout

- `packages/core` — `@ryunzz/edit-core`: useFrame, Sequence, interpolate (clamps by default), spring (closed form), Easing, random(seed), Img, Audio, asset, waitFor; `src/runtime.tsx` mounts a composition and exposes `window.__edit.setFrame(n)`.
- `packages/renderer` — esbuild bundle → 127.0.0.1 server → puppeteer-core + headless Chromium tabs in parallel → ffmpeg (image2pipe → H.264, then audio mux).
- `packages/cli` — `edit compositions | still | render`.
- `examples/hello` — 6 s kinetic title with an image and audio.

## Milestones

1. Done — core and stills (`edit still`).
2. Done — MP4 render with audio, parallel tabs.
3. Next — `edit dev`: studio served by the helper, player with scrubbing, hot reload, read-only timeline built from `<Sequence>` tree.
4. Assets: drop-in uploads, probing (ffprobe), `<Video>` footage with frame extraction.
5. Agent loop: MCP server (list_compositions, get_composition, render_frame, render_contact_sheet, render_video, list_assets, analyze_audio, get_errors, get_selection), Claude skill, AGENTS.md, activity feed, "Point agent here".
6. `edit init` with templates and the first-run Connect screen.

Untested so far: VideoToolbox encoding and the automatic chrome-headless-shell download (built on Linux). Verify both on macOS first.

## Commands

```sh
bun install
bun test
bun run typecheck
cd examples/hello && bun ../../packages/cli/src/index.ts render title
```

## Conventions

- Error messages name the composition, frame, file and line where possible; they are read by agents.
- Determinism: no Date.now, timers, CSS transitions or Math.random in compositions.
