import { useMemo, useRef } from "react";
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

interface Lane {
  kind: TimelineClip["kind"];
  clips: TimelineClip[];
}

/** Packs clips into as few lanes as possible per kind, nested sequences below their parents. */
export function packLanes(clips: TimelineClip[]): Lane[] {
  const depth = new Map<string, number>();
  const byId = new Map(clips.map((c) => [c.id, c]));
  const depthOf = (c: TimelineClip): number => {
    if (depth.has(c.id)) return depth.get(c.id)!;
    const parent = c.parent ? byId.get(c.parent) : undefined;
    const d = parent ? depthOf(parent) + 1 : 0;
    depth.set(c.id, d);
    return d;
  };
  const lanes: Lane[] = [];
  for (const kind of ORDER) {
    const ofKind = clips
      .filter((c) => c.kind === kind && c.to > c.from)
      .sort((a, b) => depthOf(a) - depthOf(b) || a.from - b.from || b.to - a.to);
    const mine: (Lane & { depth: number })[] = [];
    for (const clip of ofKind) {
      const d = kind === "sequence" ? depthOf(clip) : 0;
      const lane = mine.find((l) => l.depth === d && l.clips.every((o) => clip.from >= o.to || clip.to <= o.from));
      if (lane) lane.clips.push(clip);
      else mine.push({ kind, clips: [clip], depth: d });
    }
    lanes.push(...mine);
  }
  return lanes;
}

function tickStep(seconds: number): number {
  for (const step of [1, 2, 5, 10, 15, 30, 60, 120, 300]) if (seconds / step <= 12) return step;
  return 600;
}

export function Timeline({ meta, clips, frame, selected, onSeek, onSelect }: Props) {
  const lanes = useMemo(() => packLanes(clips), [clips]);
  const area = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const total = meta.durationInFrames;
  const pct = (f: number) => `${(f / total) * 100}%`;
  const seconds = total / meta.fps;
  const step = tickStep(seconds);
  const ticks = Array.from({ length: Math.floor(seconds / step) + 1 }, (_, i) => i * step).filter((s) => s * meta.fps < total);

  const frameAt = (clientX: number) => {
    const rect = area.current!.getBoundingClientRect();
    const x = Math.min(Math.max(0, clientX - rect.left), rect.width);
    return Math.min(total - 1, Math.floor((x / rect.width) * total));
  };

  return (
    <div className="tl-body">
      <div className="tl-grid">
        <div className="tl-heads">
          <div className="tl-ruler-head" />
          {lanes.map((lane, i) => (
            <div className="tl-head" key={i}>
              <span className="kind">{LABEL[lane.kind]}</span>
              {lane.clips[0]!.name}
            </div>
          ))}
          {lanes.length === 0 && <div className="tl-head muted">No sequences yet</div>}
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
          </div>
          {lanes.map((lane, i) => (
            <div className="tl-lane" key={i}>
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
          <div className="playhead" style={{ left: pct(frame) }} aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
