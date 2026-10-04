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

- `packages/core` — `@ryunzz/edit-core`: useFrame, Sequence, interpolate (clamps by default), spring (closed form), Easing, random(seed), Img, Audio, Video, asset, waitFor; `src/runtime.tsx` mounts a composition and exposes `window.__edit` (setFrame, drawFrame, timeline, audio); `src/jsx-dev-runtime.ts` tags elements with `data-edit-src="file:line"`.
- `packages/renderer` — esbuild bundle → 127.0.0.1 server → puppeteer-core + headless Chromium tabs in parallel → ffmpeg (image2pipe → H.264, then audio mux). Also stills, contact sheets, `inspectComposition` (timeline), `readCompositionMeta` (no browser).
- `packages/media` — ffprobe probing (cached in `.edit/cache/`), audio beats/onsets/loudness, footage frame extraction for `<Video>`.
- `packages/server` — the helper behind `edit dev`: Host/Origin/token checks, preview bundles with hot reload, assets, render queue, activity feed, selection, setup checklist.
- `packages/studio` — the studio UI (React, Reel design system): Connect, Studio, Renders.
- `packages/mcp` — the agent's MCP tools over stdio (`edit mcp`).
- `packages/cli` — `edit init | dev | mcp | compositions | still | render`; `templates/` holds the starter projects and the agent files (AGENTS.md, CLAUDE.md, skill).
- `examples/hello` — 6 s kinetic title with an image and audio.
- `projects/` — git-ignored. From a checkout, `edit init <name>` creates `projects/<name>` and `edit dev <name>` / `--project <name>` open it; the checkout root comes from the CLI's own path (`checkoutRoot()` in `packages/cli/src/init.ts`), never a hard-coded folder name. Paths (`.`, `./x`, `~/x`, `/x`, `a/b`) are used as given.

Helper and agent tools share state through `.edit/` in the project: `helper.json` (port + token, mode 0600), `agent.json`, `activity.jsonl`, `selection.json`, `errors.json`.

## Milestones

All six MVP milestones are done: core and stills; MP4 with audio; `edit dev` studio; assets and footage; agent loop (MCP, skill, AGENTS.md, activity, Point agent here); `edit init` and the Connect screen. Verified on macOS: VideoToolbox encoding and the automatic chrome-headless-shell download.

Not done yet: publishing to npm (the CLI runs TypeScript with Bun; Node 20+ support needs a build step), downloading an LGPL ffmpeg automatically (the Connect screen asks for `brew install ffmpeg`), Linux and Windows testing.

## Commands

```sh
bun install
bun test
bun run typecheck
cd examples/hello && bun ../../packages/cli/src/index.ts render title
bun run link-cli   # `edit` on PATH, running this checkout
```

## Conventions

- Error messages name the composition, frame, file and line where possible; they are read by agents.
- Determinism: no Date.now, timers, CSS transitions or Math.random in compositions.
