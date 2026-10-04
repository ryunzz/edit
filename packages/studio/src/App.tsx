import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, type ActivityEvent, type AgentStatus } from "./Activity";
import { Assets } from "./Assets";
import { useDrop, type DropTarget } from "./Drop";
import { Refs } from "./Refs";
import { Connect, type SetupStatus } from "./Connect";
import { api, useEvents, type CompositionEntry, type ProjectInfo, type TimelineClip } from "./api";
import { shortTimecode, timecode } from "./format";
import { Icon } from "./icons";
import { Player, type Loaded } from "./Player";
import { Pointer, type Selection } from "./Pointer";
import { Renders, type RenderJob } from "./Renders";
import { Timeline } from "./Timeline";

function useHash(): [string, (v: string) => void] {
  const [hash, setHash] = useState(() => decodeURIComponent(location.hash.slice(1)));
  useEffect(() => {
    const on = () => setHash(decodeURIComponent(location.hash.slice(1)));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [hash, (v: string) => (location.hash = encodeURIComponent(v))];
}

export function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [compositions, setCompositions] = useState<CompositionEntry[]>([]);
  const [hash, setHash] = useHash();
  const [version, setVersion] = useState(1);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [safeArea, setSafeArea] = useState(false);
  const [selectedClip, setSelectedClip] = useState<TimelineClip | null>(null);
  const [connected, setConnected] = useState(true);
  const [assetsVersion, setAssetsVersion] = useState(0);
  const [refsVersion, setRefsVersion] = useState(0);
  const drop = useDrop(
    useCallback((target: DropTarget) => (target === "refs" ? setRefsVersion : setAssetsVersion)((v) => v + 1), []),
  );
  const [view, setView] = useState<"studio" | "renders">(() => (sessionStorage.getItem("edit.view") === "renders" ? "renders" : "studio"));
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [rendersOpened, setRendersOpened] = useState(0);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [skipConnect, setSkipConnect] = useState(() => {
    try {
      return localStorage.getItem(`edit.connect.skip.${location.port}`) === "1";
    } catch {
      return false;
    }
  });
  const [picking, setPicking] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const pick = useCallback((sel: Selection) => {
    setPicking(false);
    void api.post<Selection>("/api/selection", sel).then(setSelection, () => undefined);
  }, []);
  const cancelPick = useCallback(() => setPicking(false), []);

  const show = (v: "studio" | "renders") => {
    setView(v);
    setPlaying(false);
    if (v === "renders") setRendersOpened((n) => n + 1);
    try {
      sessionStorage.setItem("edit.view", v);
    } catch {
      // private windows may refuse storage
    }
  };

  const refreshCompositions = useCallback(() => {
    api.get<CompositionEntry[]>("/api/compositions").then(setCompositions, () => undefined);
  }, []);

  useEffect(() => {
    api.get<ProjectInfo>("/api/project").then((p) => {
      setProject(p);
      setVersion(p.version);
    });
    refreshCompositions();
    api.get<{ jobs: RenderJob[] }>("/api/renders").then((r) => setJobs(r.jobs), () => undefined);
    api.get<{ events: ActivityEvent[]; agent: AgentStatus | null }>("/api/activity").then((r) => {
      setActivity(r.events);
      setAgent(r.agent);
    }, () => undefined);
    api.get<Selection | null>("/api/selection").then(setSelection, () => undefined);
    api.get<SetupStatus>("/api/setup").then(setSetup, () => undefined);
  }, [refreshCompositions]);

  useEvents({
    source: (d: { version: number }) => {
      setVersion(d.version);
      refreshCompositions();
    },
    assets: () => setAssetsVersion((v) => v + 1),
    refs: () => setRefsVersion((v) => v + 1),
    renders: (d: { jobs: RenderJob[] }) => setJobs(d.jobs),
    activity: (d: { events: ActivityEvent[] }) => setActivity((a) => [...a, ...d.events].slice(-200)),
    agent: (d: AgentStatus | null) => {
      setAgent(d);
      api.get<SetupStatus>("/api/setup").then(setSetup, () => undefined);
    },
    setup: (d: SetupStatus) => setSetup(d),
    selection: (d: Selection | null) => setSelection(d),
    open: () => setConnected(true),
    disconnect: () => setConnected(false),
  });

  const id = compositions.some((c) => c.id === hash) ? hash : (compositions[0]?.id ?? "");
  const entry = compositions.find((c) => c.id === id);
  const meta = loaded?.meta ?? entry?.meta ?? null;
  const last = meta ? meta.durationInFrames - 1 : 0;

  useEffect(() => {
    setFrame(0);
    setPlaying(false);
    setLoaded(null);
    setSelectedClip(null);
  }, [id]);

  // Tell the helper what the preview shows, so the agent can read it with get_errors.
  const reported = useRef("");
  useEffect(() => {
    if (!id) return;
    const key = JSON.stringify([id, errors]);
    if (key === reported.current) return;
    reported.current = key;
    void api.post("/api/errors", { id, errors }).catch(() => undefined);
  }, [id, errors]);

  const seek = useCallback(
    (f: number) => {
      setPlaying(false);
      setFrame(Math.max(0, Math.min(last, Math.round(f))));
    },
    [last],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seek(frame - (e.shiftKey ? (meta?.fps ?? 30) : 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seek(frame + (e.shiftKey ? (meta?.fps ?? 30) : 1));
      } else if (e.key === "Home") seek(0);
      else if (e.key === "End") seek(last);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [frame, last, meta, seek]);

  const fps = meta?.fps ?? 30;

  // First run: until an agent has connected once, show how to connect one.
  if (project && setup && setup.firstRun && !agent?.connected && !skipConnect) {
    return (
      <Connect
        name={project.name}
        root={project.root}
        port={project.port}
        setup={setup}
        onOpenStudio={() => {
          setSkipConnect(true);
          try {
            localStorage.setItem(`edit.connect.skip.${location.port}`, "1");
          } catch {
            // storage can be unavailable; the choice then lasts for this page only
          }
        }}
      />
    );
  }

  return (
    <>
      <header className="menubar">
        <span className="logo">edit</span>
        <nav className="tabs" aria-label="Workspaces">
          <button type="button" className="tab" aria-current={view === "studio" ? "page" : undefined} onClick={() => show("studio")}>
            Studio
          </button>
          <button type="button" className="tab" aria-current={view === "renders" ? "page" : undefined} onClick={() => show("renders")}>
            Renders
            {jobs.some((j) => j.status === "rendering") && <span className="mono muted"> ·</span>}
          </button>
        </nav>
        <span className="grow" />
        <span className="mono muted" style={{ fontSize: 12 }}>
          {project?.root}
        </span>
        <span className={`status-dot${agent?.connected ? "" : " off"}`}>{agent?.connected ? `${agent.name} connected` : "No agent connected"}</span>
      </header>

      {view === "renders" && <Renders compositions={compositions} jobs={jobs} current={id} refreshKey={rendersOpened} />}
      <div className="workspace" hidden={view !== "studio"} style={view !== "studio" ? { display: "none" } : undefined}>
        <section className="panel bin" aria-label="Project">
          <div className="panel-header">
            <span className="panel-title">Compositions</span>
          </div>
          <ul className="list">
            {compositions.map((c) => (
              <li key={c.id}>
                <a
                  className="row"
                  href={`#${encodeURIComponent(c.id)}`}
                  aria-current={c.id === id ? "true" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    setHash(c.id);
                  }}
                >
                  <Icon.composition />
                  <span className="name">{c.id}</span>
                  <span className="grow" />
                  {c.meta ? <span className="meta">{shortTimecode(c.meta.durationInFrames, c.meta.fps)}</span> : <span className="meta bad">error</span>}
                </a>
              </li>
            ))}
            {compositions.length === 0 && <li className="empty">No compositions yet. Add a .tsx file to compositions/, or ask your agent.</li>}
          </ul>
          <Assets version={assetsVersion} drop={drop} />
          <Refs version={refsVersion} drop={drop} onAddLink={drop.addLink} />
        </section>

        <section className="panel center" aria-label="Preview">
          <div className="panel-header">
            <span className="panel-title">Preview{id ? `: ${id}` : ""}</span>
            <span className="grow" />
            {meta && (
              <span className="mono faint" style={{ fontSize: 11 }}>
                {meta.width} × {meta.height} · {meta.fps} fps
              </span>
            )}
            <button type="button" className="btn small" aria-pressed={safeArea} onClick={() => setSafeArea((s) => !s)}>
              Safe area
            </button>
          </div>
          {id ? (
            <Player
              id={id}
              version={version}
              frame={frame}
              playing={playing}
              safeArea={safeArea}
              onFrame={setFrame}
              onLoaded={setLoaded}
              onErrors={setErrors}
              onStop={() => setPlaying(false)}
              interactive={picking}
              overlay={(scale) => (
                <Pointer
                  loaded={loaded}
                  scale={scale}
                  picking={picking}
                  composition={id}
                  frame={frame}
                  timecode={timecode(frame, fps)}
                  selection={selection}
                  onPick={pick}
                  onCancel={cancelPick}
                />
              )}
            />
          ) : (
            <div className="stage">
              <p className="placeholder">Nothing to preview yet. Each file in compositions/ shows up here as soon as it is saved.</p>
            </div>
          )}
          <div className="transport">
            <span className="timecode" style={{ color: "var(--ink)" }}>
              {timecode(frame, fps)}
            </span>
            <span className="mono faint" style={{ fontSize: 11 }}>
              f{frame}
            </span>
            <span className="grow" />
            <div className="buttons">
              <button type="button" className="icon-btn" aria-label="Go to start" onClick={() => seek(0)}>
                <Icon.start />
              </button>
              <button type="button" className="icon-btn" aria-label="Back one frame" onClick={() => seek(frame - 1)}>
                <Icon.back />
              </button>
              <button type="button" className="icon-btn play" aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying((p) => !p)} disabled={!loaded}>
                {playing ? <Icon.pause /> : <Icon.play />}
              </button>
              <button type="button" className="icon-btn" aria-label="Forward one frame" onClick={() => seek(frame + 1)}>
                <Icon.forward />
              </button>
              <button type="button" className="icon-btn" aria-label="Go to end" onClick={() => seek(last)}>
                <Icon.end />
              </button>
            </div>
            <span className="grow" />
            <button
              type="button"
              className="btn"
              aria-pressed={picking}
              disabled={!loaded}
              title="Click an element in the preview to show your agent what you mean"
              onClick={() => {
                setPlaying(false);
                setPicking((p) => !p);
              }}
            >
              {picking ? "Click an element…" : "Point agent here"}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!entry?.meta}
              onClick={() => {
                void api.post("/api/renders", { composition: id }).then(() => show("renders"), () => show("renders"));
              }}
            >
              Render
            </button>
          </div>
        </section>

        <Activity
          events={activity}
          agent={agent}
          footer={
            selection && (
              <div className="panel-footer">
                <span className="muted">Pointed at</span>
                <button
                  type="button"
                  className="chip"
                  style={{ border: 0, cursor: "pointer" }}
                  title={selection.element.source ?? undefined}
                  onClick={() => {
                    setHash(selection.composition);
                    seek(selection.frame);
                  }}
                >
                  {selection.element.text || selection.element.tag} · f{selection.frame}
                </button>
                <span className="grow" />
                <button type="button" className="btn small" onClick={() => void api.del("/api/selection").then(() => setSelection(null))}>
                  Clear
                </button>
              </div>
            )
          }
        />
      </div>

      <section className="panel timeline" aria-label="Timeline, read only" style={view !== "studio" ? { display: "none" } : undefined}>
        <div className="panel-header">
          <span className="panel-title">Timeline{id ? `: ${id}` : ""}</span>
          <span className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <Icon.lock />
            Read only{entry ? ` · built from ${id}` : ""}
          </span>
          <span className="grow" />
          <span className="muted mono" style={{ fontSize: 12 }}>
            {selectedClip?.source ?? "Click a clip to see its line of code"}
          </span>
        </div>
        {meta && loaded ? (
          <Timeline meta={meta} clips={loaded.clips} frame={frame} selected={selectedClip?.id ?? null} onSeek={seek} onSelect={setSelectedClip} />
        ) : (
          <div className="empty">The timeline appears once the composition loads.</div>
        )}
      </section>

      <footer className="footer">
        <span className={`status-dot${connected ? "" : " off"}`} style={{ color: connected ? "var(--ink)" : undefined }}>
          {connected ? "Helper running" : "Helper stopped. Run edit dev again."}
        </span>
        {project && <span className="mono" style={{ fontSize: 11 }}>localhost:{project.port}</span>}
        <span className="grow" />
        <span>MCP: {agent?.connected ? agent.name : "not connected"}</span>
        <span className={errors.length ? "err" : ""}>{errors.length ? `${errors.length} error${errors.length > 1 ? "s" : ""}` : "No errors"}</span>
      </footer>
    </>
  );
}
