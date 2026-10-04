import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AudioClip, CompositionMeta, EditBridge, TimelineClip } from "./api";

export interface Loaded {
  meta: CompositionMeta;
  clips: TimelineClip[];
  audio: AudioClip[];
  /** The live bridge inside the preview, for features that inspect the page. */
  bridge: EditBridge;
  frameWindow: Window;
}

interface Props {
  id: string;
  version: number;
  frame: number;
  playing: boolean;
  safeArea: boolean;
  /** Called on each new frame while playing. */
  onFrame(frame: number): void;
  onLoaded(loaded: Loaded): void;
  onErrors(errors: string[]): void;
  onStop(): void;
  children?: React.ReactNode;
}

interface Slot {
  key: number;
  id: string;
  version: number;
}

type BridgeWindow = Window & { __edit?: EditBridge; __editMountError?: string };

function waitForBridge(win: BridgeWindow, timeoutMs = 15_000): Promise<EditBridge> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const poll = () => {
      if (win.__editMountError) return reject(new Error(win.__editMountError));
      if (win.__edit) return resolve(win.__edit);
      if (performance.now() - started > timeoutMs) return reject(new Error("The composition did not start within 15 seconds."));
      setTimeout(poll, 25);
    };
    poll();
  });
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error:\s*/, "");

let nextKey = 1;

export function Player({ id, version, frame, playing, safeArea, onFrame, onLoaded, onErrors, onStop, children }: Props) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [activeKey, setActiveKey] = useState<number | null>(null);
  const [meta, setMeta] = useState<CompositionMeta | null>(null);
  const [scale, setScale] = useState(0.5);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [frameError, setFrameError] = useState<string | null>(null);
  const [timelineErrors, setTimelineErrors] = useState<string[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const frames = useRef(new Map<number, HTMLIFrameElement>());
  const bridge = useRef<EditBridge | null>(null);
  const audioClips = useRef<AudioClip[]>([]);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const callbacks = useRef({ onFrame, onLoaded, onErrors, onStop });
  callbacks.current = { onFrame, onLoaded, onErrors, onStop };

  // A new composition or a new version of it: load it next to the current one.
  useEffect(() => {
    setSlots((s) => [...s.filter((x) => x.key === activeKey), { key: nextKey++, id, version }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, version]);

  useEffect(() => {
    callbacks.current.onErrors([loadError, frameError, ...timelineErrors].filter((e): e is string => Boolean(e)));
  }, [loadError, frameError, timelineErrors]);

  async function onFrameLoad(slot: Slot) {
    const iframe = frames.current.get(slot.key);
    const win = iframe?.contentWindow as BridgeWindow | null;
    if (!win) return;
    try {
      const b = await waitForBridge(win);
      const timeline = b.timeline();
      const f = Math.min(frameRef.current, b.meta.durationInFrames - 1);
      let err: string | null = null;
      try {
        await b.setFrame(f);
      } catch (e) {
        err = message(e);
      }
      bridge.current = b;
      audioClips.current = b.audio();
      setMeta(b.meta);
      setActiveKey(slot.key);
      setSlots((s) => s.filter((x) => x.key === slot.key || x.key > slot.key));
      setLoadError(null);
      setFrameError(err);
      setTimelineErrors(timeline.errors);
      callbacks.current.onLoaded({ meta: b.meta, clips: timeline.clips, audio: audioClips.current, bridge: b, frameWindow: win });
    } catch (e) {
      setLoadError(message(e));
      const active = slotsRef.current.find((x) => x.key === activeKeyRef.current);
      if (active && active.id === slot.id) {
        // Keep showing the last good version under the error.
        setSlots((s) => s.filter((x) => x.key !== slot.key));
      } else {
        // A different composition that doesn't start: show only its error.
        bridge.current = null;
        setMeta(null);
        setActiveKey(slot.key);
        setSlots((s) => s.filter((x) => x.key >= slot.key));
      }
    }
  }

  // Fit the picture into the stage.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || !meta) return;
    const fit = () => {
      const w = stage.clientWidth - 32;
      const h = stage.clientHeight - 32;
      setScale(Math.max(0.05, Math.min(w / meta.width, h / meta.height)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [meta]);

  // Paused: draw exactly, waiting for images, fonts and footage. Only the latest request runs.
  const drawing = useRef<{ busy: boolean; next: number | null }>({ busy: false, next: null });
  useEffect(() => {
    if (playing || !bridge.current) return;
    const state = drawing.current;
    state.next = frame;
    if (state.busy) return;
    state.busy = true;
    void (async () => {
      while (state.next !== null) {
        const f = state.next;
        state.next = null;
        const b = bridge.current;
        if (!b || f >= b.meta.durationInFrames) continue;
        try {
          await b.setFrame(f);
          setFrameError(null);
        } catch (e) {
          setFrameError(message(e));
        }
      }
      state.busy = false;
    })();
  }, [frame, playing, activeKey]);

  // Playing: draw at the composition's fps without waiting, and keep the audio in step.
  useEffect(() => {
    const b = bridge.current;
    if (!playing || !b) return;
    const { fps, durationInFrames } = b.meta;
    const players = new Map<AudioClip, HTMLAudioElement>();
    let start = performance.now();
    let startFrame = frameRef.current >= durationInFrames - 1 ? 0 : frameRef.current;
    let last = -1;
    let raf = 0;

    const syncAudio = (f: number) => {
      for (const clip of audioClips.current) {
        const active = f >= clip.startFrame && f < clip.endFrame;
        let el = players.get(clip);
        if (!active) {
          el?.pause();
          continue;
        }
        const rate = clip.rate ?? 1;
        const at = (clip.trimStart + (f - clip.startFrame) * rate) / fps;
        if (!el) {
          el = new Audio(clip.src);
          el.preload = "auto";
          players.set(clip, el);
        }
        el.volume = Math.max(0, Math.min(1, clip.volume));
        el.playbackRate = rate;
        if (el.paused || Math.abs(el.currentTime - at) > 0.15) {
          el.currentTime = at;
          void el.play().catch(() => undefined);
        }
      }
    };

    const tick = () => {
      let f = startFrame + Math.floor(((performance.now() - start) * fps) / 1000);
      if (f >= durationInFrames) {
        start = performance.now();
        startFrame = 0;
        f = 0;
        for (const el of players.values()) el.pause();
      }
      if (f !== last) {
        last = f;
        try {
          b.drawFrame(f);
        } catch (e) {
          setFrameError(message(e));
          callbacks.current.onStop();
          return;
        }
        callbacks.current.onFrame(f);
        syncAudio(f);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      for (const el of players.values()) {
        el.pause();
        el.removeAttribute("src");
      }
    };
  }, [playing, activeKey]);

  const errors = [loadError, frameError, ...timelineErrors].filter(Boolean) as string[];
  const w = meta ? meta.width * scale : 0;
  const h = meta ? meta.height * scale : 0;

  return (
    <div className="stage" ref={stageRef}>
      <div className="picture" style={{ width: w, height: h, background: meta?.background }}>
        {slots.map((slot) => (
          <iframe
            key={slot.key}
            title={`Preview of ${slot.id}`}
            className={slot.key === activeKey ? "" : "pending"}
            ref={(el) => {
              if (el) frames.current.set(slot.key, el);
              else frames.current.delete(slot.key);
            }}
            src={`/preview/${encodeURIComponent(slot.id)}?v=${slot.version}`}
            onLoad={() => void onFrameLoad(slot)}
            style={{
              width: meta?.width ?? 1920,
              height: meta?.height ?? 1080,
              transform: `scale(${scale})`,
              pointerEvents: "none",
            }}
          />
        ))}
        {safeArea && meta && <span className="safe-area" aria-hidden="true" />}
        {children}
      </div>
      {errors.length > 0 && (
        <pre className="overlay-error" role="alert">
          <strong>{loadError ? "This composition doesn't run" : "Error in this composition"}</strong>
          {errors.join("\n\n")}
        </pre>
      )}
    </div>
  );
}
