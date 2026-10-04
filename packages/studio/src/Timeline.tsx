import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CompositionMeta, TimelineClip } from "./api";
import { clock } from "./format";

interface Props {
  meta: CompositionMeta;
  clips: TimelineClip[];
  frame: number;
  selected: string | null;
  onSeek(frame: number): void;
  onSelect(clip: TimelineClip | null): void;
}

const ORDER: TimelineClip["kind"][] = ["sequence", "video", "image", "audio"];
const LABEL: Record<TimelineClip["kind"], string> = { sequence: "seq", video: "video", image: "image", audio: "audio" };
export const TRACK_H = 32;
export const RULER_H = 24;
/** Lanes drawn above and below the visible ones, so fast scrolling doesn't show gaps. */
const OVERSCAN = 6;

export interface Lane {
  kind: TimelineClip["kind"];
  clips: TimelineClip[];
}

/**
 * Packs clips into as few lanes as possible per kind, nested sequences below their parents.
 * There is no limit on lanes: one composition can make thousands, and the timeline only draws
 * the ones on screen. Greedy by start frame, so it stays fast with many clips.
 */
export function packLanes(clips: TimelineClip[]): Lane[] {
  const depth = new Map<string, number>();
  const byId = new Map(clips.map((c) => [c.id, c]));
  const depthOf = (c: TimelineClip): number => {
    const known = depth.get(c.id);
    if (known !== undefined) return known;
    // Walk up iteratively: deep nesting must not overflow the stack.
    const chain: TimelineClip[] = [];
    let cur: TimelineClip | undefined = c;
    let base = -1;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      const d = depth.get(cur.id);
      if (d !== undefined) {
        base = d;
        break;
      }
      seen.add(cur.id);
      chain.push(cur);
      cur = cur.parent ? byId.get(cur.parent) : undefined;
    }
    for (let i = chain.length - 1; i >= 0; i--) depth.set(chain[i]!.id, ++base);
    return depth.get(c.id)!;
  };

  const lanes: Lane[] = [];
  for (const kind of ORDER) {
    const ofKind = clips
      .filter((c) => c.kind === kind && c.to > c.from)
      .map((c) => ({ c, d: kind === "sequence" ? depthOf(c) : 0 }))
      .sort((a, b) => a.d - b.d || a.c.from - b.c.from || b.c.to - a.c.to);
    const mine: (Lane & { depth: number; end: number })[] = [];
    for (const { c, d } of ofKind) {
      // Clips arrive in start order, so a lane fits if its last clip has ended.
      const lane = mine.find((l) => l.depth === d && l.end <= c.from);
      if (lane) {
        lane.clips.push(c);
        lane.end = c.to;
      } else mine.push({ kind, clips: [c], depth: d, end: c.to });
    }
    lanes.push(...mine.map(({ kind: k, clips: cs }) => ({ kind: k, clips: cs })));
  }
  return lanes;
}

function tickStep(seconds: number): number {
  for (const step of [1, 2, 5, 10, 15, 30, 60, 120, 300]) if (seconds / step <= 12) return step;
  return 600;
}

export function Timeline({ meta, clips, frame, selected, onSeek, onSelect }: Props) {
  const lanes = useMemo(() => packLanes(clips), [clips]);
  const body = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [view, setView] = useState({ top: 0, height: 400 });

  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const measure = () => setView({ top: el.scrollTop, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, []);

  const total = meta.durationInFrames;
  const pct = (f: number) => `${(f / total) * 100}%`;
  const seconds = total / meta.fps;
  const step = tickStep(seconds);
  const ticks = Array.from({ length: Math.floor(seconds / step) + 1 }, (_, i) => i * step).filter((s) => s * meta.fps < total);

  const first = Math.max(0, Math.floor(view.top / TRACK_H) - OVERSCAN);
  const last = Math.min(lanes.length, Math.ceil((view.top + view.height) / TRACK_H) + OVERSCAN);
  const visible = lanes.slice(first, last);
  const tracksHeight = Math.max(lanes.length, 1) * TRACK_H;

  const frameAt = (clientX: number) => {
    const rect = area.current!.getBoundingClientRect();
    const x = Math.min(Math.max(0, clientX - rect.left), rect.width);
    return Math.min(total - 1, Math.floor((x / rect.width) * total));
  };

  return (
    <div className="tl-body" ref={body}>
      <div className="tl-grid" style={{ height: RULER_H + tracksHeight }}>
        <div className="tl-heads">
          <div className="tl-ruler-head" />
          <div className="tl-tracks" style={{ height: tracksHeight }}>
            {visible.map((lane, i) => (
              <div className="tl-head" key={first + i} style={{ top: (first + i) * TRACK_H }}>
                <span className="kind">{LABEL[lane.kind]}</span>
                {lane.clips[0]!.name}
              </div>
            ))}
            {lanes.length === 0 && <div className="tl-head muted">No sequences yet</div>}
          </div>
        </div>
        <div
          className="tl-lanes"
          ref={area}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest(".clip")) return;
            dragging.current = true;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            onSeek(frameAt(e.clientX));
          }}
          onPointerMove={(e) => dragging.current && onSeek(frameAt(e.clientX))}
          onPointerUp={() => (dragging.current = false)}
        >
          <div className="tl-ruler" aria-hidden="true">
            {ticks.map((s) => (
              <span key={s}>
                <span className="tl-tick" style={{ left: pct(s * meta.fps) }} />
                <span className="tl-tick-label" style={{ left: pct(s * meta.fps) }}>
                  {clock(s)}
                </span>
              </span>
            ))}
            <span className="playhead-cap" style={{ left: pct(frame) }} />
          </div>
          <div className="tl-tracks" style={{ height: tracksHeight }}>
            {visible.map((lane, i) => (
              <div className="tl-lane" key={first + i} style={{ top: (first + i) * TRACK_H }}>
                {lane.clips.map((clip) => {
                  const live = frame >= clip.from && frame < clip.to;
                  const file = clip.source?.split("/").pop();
                  return (
                    <button
                      type="button"
                      key={clip.id}
                      className={`clip ${clip.kind}${live ? " live" : ""}${selected === clip.id ? " selected" : ""}`}
                      style={{ left: pct(clip.from), width: `calc(${pct(clip.to - clip.from)} - 2px)` }}
                      title={`${clip.name} · frames ${clip.from}–${clip.to - 1}${clip.source ? ` · ${clip.source}` : ""}`}
                      onClick={() => {
                        onSelect(selected === clip.id ? null : clip);
                        onSeek(clip.from);
                      }}
                    >
                      {clip.name}
                      {selected === clip.id && file && <span className="src">{file}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="playhead" style={{ left: pct(frame) }} aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
