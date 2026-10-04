import { useEffect, useState } from "react";
import type { Loaded } from "./Player";

export interface Selection {
  composition: string;
  frame: number;
  timecode: string;
  element: { tag: string; text: string; source: string | null; sequence: string | null; box: { x: number; y: number; width: number; height: number } };
  at?: string;
}

type Box = Selection["element"]["box"];

interface Target {
  box: Box;
  tag: string;
  text: string;
  source: string | null;
  sequence: string | null;
}

function describe(el: Element): Target {
  const tagged = (el.closest("[data-edit-src]") ?? el) as HTMLElement;
  const r = tagged.getBoundingClientRect();
  const text = (tagged instanceof HTMLImageElement ? tagged.alt || tagged.src.split("/").pop() || "" : (tagged.innerText ?? tagged.textContent ?? "")).replace(/\s+/g, " ").trim();
  return {
    box: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
    tag: tagged.tagName.toLowerCase(),
    text: text.slice(0, 80),
    source: tagged.getAttribute("data-edit-src"),
    sequence: (tagged.closest("[data-sequence]") as HTMLElement | null)?.dataset.sequence ?? null,
  };
}

const label = (t: { tag: string; source: string | null }) => [t.tag, t.source?.split("/").pop()].filter(Boolean).join(" · ");

function Outline({ box, scale, text }: { box: Box; scale: number; text: string }) {
  return (
    <div className="pointer-outline" style={{ left: box.x * scale, top: box.y * scale, width: box.width * scale, height: box.height * scale }}>
      <span className="pointer-label">{text}</span>
    </div>
  );
}

/**
 * Draws over the preview. While picking, highlights the element under the cursor with its
 * tag and line of code; a click picks it. Otherwise outlines the current selection on its frame.
 */
export function Pointer({
  loaded,
  scale,
  picking,
  composition,
  frame,
  timecode,
  selection,
  onPick,
  onCancel,
}: {
  loaded: Loaded | null;
  scale: number;
  picking: boolean;
  composition: string;
  frame: number;
  timecode: string;
  selection: Selection | null;
  onPick(sel: Selection): void;
  onCancel(): void;
}) {
  const [hover, setHover] = useState<Target | null>(null);

  useEffect(() => {
    if (!picking || !loaded) {
      setHover(null);
      return;
    }
    const doc = loaded.frameWindow.document;
    const root = doc.getElementById("root");
    const valid = (t: EventTarget | null): t is Element => t instanceof (loaded.frameWindow as unknown as typeof globalThis).Element && t !== root && t !== doc.body && t !== doc.documentElement;
    const move = (e: MouseEvent) => setHover(valid(e.target) ? describe(e.target) : null);
    const click = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!valid(e.target)) return;
      const t = describe(e.target);
      onPick({ composition, frame, timecode, element: t });
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    const leave = () => setHover(null);
    doc.addEventListener("mousemove", move);
    doc.addEventListener("click", click, true);
    doc.addEventListener("mouseleave", leave);
    doc.addEventListener("keydown", key);
    window.addEventListener("keydown", key);
    return () => {
      doc.removeEventListener("mousemove", move);
      doc.removeEventListener("click", click, true);
      doc.removeEventListener("mouseleave", leave);
      doc.removeEventListener("keydown", key);
      window.removeEventListener("keydown", key);
    };
  }, [picking, loaded, composition, frame, timecode, onPick, onCancel]);

  if (picking && hover) return <Outline box={hover.box} scale={scale} text={label(hover)} />;
  if (!picking && selection && selection.composition === composition && selection.frame === frame) {
    return <Outline box={selection.element.box} scale={scale} text={`${label(selection.element)} · pointed`} />;
  }
  return null;
}
