# edit

Make motion graphics with your coding agent. Videos are React components driven by the frame number; edit renders them to MP4 on your own machine with headless Chromium and ffmpeg.

> Status: MVP, not yet published to npm. Everything below runs from a checkout of this repo on macOS.

## Make videos in another project

Needs [Bun](https://bun.sh) 1.3+, ffmpeg (`brew install ffmpeg`) and a coding agent such as Claude Code. Headless Chromium downloads itself once.

```sh
# once, in this repo
bun install
bun run link-cli            # puts an `edit` command in ~/.bun/bin that runs this checkout

# for each video project
edit init my-video          # creates _projects/my-video in this repo; pick a template
edit dev my-video           # opens the studio in your browser (works from any folder)
cd _projects/my-video && claude   # in a second terminal
```

`_projects/` sits next to the code in your clone, whatever you named it, and is git-ignored, so your videos never end up in commits to this repo. Each project is a plain folder you can `git init` on its own. Names must be unique: `edit init` fails if `_projects/` already has one with the same name (in any letter case), and points you to `edit dev <name>` to open it. To put a project somewhere else, give a path instead of a name: `edit init ~/motion/my-video` or `edit init ./my-video`.

Allow the `edit` tools when Claude Code asks (they're in the project's `.mcp.json`), drop your music, logo or footage into the studio, then ask for a video: *"Make a 6 second title that hits on the beats of score.m4a and ends on logo.png."* The agent writes `compositions/<id>.tsx`, the studio reloads as it saves, and the agent checks its own frames before rendering to `_renders/`.

Already have a folder of compositions? `edit init .` inside it adds only the missing agent files. Codex and Cursor work too; the studio's first-run page shows the steps for each.

## Try the example

```sh
cd examples/hello
edit still title --frame 60   # → _renders/title-f60.png
edit render title             # → _renders/title.mp4
edit dev                      # → opens the studio
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
| `asset(name)` | URL of a file in `_assets/` |
| `<Img>` | An image that holds the frame until it has loaded |
| `<Audio src volume startFrom>` | Mixed into the MP4 for the length of its sequence |
| `<Video src volume muted startFrom playbackRate>` | Footage from `_assets/`; renders use exact frames extracted by ffmpeg |
| `random(seed)` | Deterministic number in [0, 1) |
| `waitFor(promise)` | Hold the frame until the promise settles |

## CLI

```
edit init <name|path> [--template blank|kinetic|logo] [--no-install]
edit dev [name] [--port n] [--no-open]   Open the studio: live preview, timeline, assets, renders
edit mcp                          Serve the agent tools over stdio
edit compositions                 List compositions
edit still <id> [--frame n]       Render one frame to PNG
edit render <id> [--frames a-b]   Render to MP4
  --out <path>  --scale <n>  --concurrency <n>  --project <name|dir>
```

Environment overrides: `EDIT_CHROME_PATH`, `EDIT_FFMPEG_PATH`.

## Studio

`edit dev` starts the helper on `127.0.0.1:3210` (or the next free port) and opens the studio. Saving any file in the project reloads the preview at the same frame; build and runtime errors appear over the last good frame and are written to `.edit/errors.json` for agents. Space plays, ←/→ step a frame (with Shift, a second), Home/End jump.

Renders land in `_renders/` (drafts, stills, checks); `__out/` holds only the final deliverables. The agent keeps the fps and size you asked for, asks before anything that multiplies render time, and deletes check files once they've done their job.

Two folders sit at the top of every project. `_assets/` holds material for the video (logo, music, footage, fonts); the agent uses what fits. `_refs/` holds inspiration: images, clips and links to YouTube, TikTok or Instagram videos whose feel you want, with a note on what to take from each in `_refs/links.md`. The agent looks at references (clips as frame grids) but never puts them in the video.

Drop images, audio, video or fonts anywhere on the studio to add them to `_assets/` (or copy them in yourself); drop them on the Refs section, drag a link in from another tab, or paste one, to add a reference. The Assets panel shows each file's size, length or dimensions, probed once with ffprobe and cached in `.edit/cache/`.

Render from the studio's Render button or the Renders tab: jobs run one at a time on this machine with a live thumbnail and progress, can be cancelled, and land in `_renders/` as `<id>.mp4`, then `<id>_v2.mp4` and so on. Draft quality renders at half size.

The helper only answers this machine: it checks the Host and Origin of every request and needs the token from the link it prints (kept as a same-site cookie afterwards).

## Agent tools (MCP)

`edit mcp` serves these tools over stdio. Register it in the project's `.mcp.json`:

```json
{ "mcpServers": { "edit": { "command": "edit", "args": ["mcp"] } } }
```

| Tool | Returns |
| --- | --- |
| `list_compositions` | Every composition's id, size, fps and length |
| `get_composition` | The read-only timeline: sequences and media with frames and source lines |
| `render_frame` | One frame as an image the agent can see |
| `render_contact_sheet` | Up to 12 labelled frames in one image |
| `render_video` / `get_render_status` | A background MP4 render and its progress (joins the studio's queue when `edit dev` runs) |
| `list_assets` | Every asset with kind, size, duration and dimensions |
| `list_refs` / `view_ref` | References in `_refs/` (files and links with notes); an image, or a grid of frames from a clip |
| `analyze_audio` | Tempo, beats, onsets and loudness, in frames |
| `get_errors` | Build and runtime errors with composition, frame, file and line |
| `get_selection` | What the user pointed at in the studio |

The tools work with or without the studio running. They record what they do in `.edit/activity.jsonl`, which the studio shows as the agent's activity.

## Packages

| Package | Role |
| --- | --- |
| `packages/core` (`@ryunzz/edit-core`) | The API compositions are written against, plus the in-browser runtime |
| `packages/renderer` (`@ryunzz/edit-renderer`) | Bundles a composition, drives headless Chromium, encodes with ffmpeg |
| `packages/media` (`@ryunzz/edit-media`) | Probing, audio beat analysis and footage frame extraction with ffmpeg |
| `packages/server` (`@ryunzz/edit-server`) | The helper behind `edit dev`: serves the studio on 127.0.0.1, watches the project, hot-reloads previews |
| `packages/studio` (`@ryunzz/edit-studio`) | The studio UI in the Reel design system |
| `packages/mcp` (`@ryunzz/edit-mcp`) | The agent's MCP tools |
| `packages/cli` (`@ryunzz/edit`) | The `edit` command |
| `examples/hello` | A 6-second kinetic title with audio and an image |

`bun test` runs the tests; `bun run typecheck` checks types.

## Licence

Source-available under the [PolyForm Small Business License 1.0.0](LICENSE.md): free for individuals and businesses with fewer than 100 people and under $1M revenue. Larger companies need a commercial licence; contact the author.

2. Create a project:
edit init ~/motion/my-video   # choose a template: 1 blank, 2 kinetic type, 3 logo sting
cd ~/motion/my-video
edit dev
edit dev opens the studio in your browser.

3. Connect Claude Code, in a second terminal:
cd ~/motion/my-video
claude
When Claude Code asks whether to allow the edit tools, say yes. The studio's first-run page then switches to the full studio.

4. Add media (optional): drag your music, logo or footage onto the studio. It's saved into _assets/.

5. Ask for the video in Claude Code, for example:

▎ Make a 6 second title that hits on the beats of score.m4a and ends on logo.png.

Claude writes compositions/<name>.tsx, the studio updates as it saves, and Claude checks frames of the result itself. To get the MP4, click Render in the studio or ask Claude to render it. The file lands in ~/motion/my-video/renders/.