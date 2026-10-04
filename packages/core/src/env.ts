export type Mode = "render" | "preview";

export interface AudioClip {
  src: string;
  /** Absolute composition frame where the clip starts playing. */
  startFrame: number;
  /** Absolute composition frame where the clip stops (exclusive). */
  endFrame: number;
  /** Frames skipped at the start of the source file. */
  trimStart: number;
  volume: number;
}

export type ClipKind = "sequence" | "image" | "video" | "audio";

/** One entry of the read-only timeline: a <Sequence> or a media layer. */
export interface TimelineClip {
  /** Stable for the element's place in the tree. */
  id: string;
  kind: ClipKind;
  name: string;
  /** Absolute frame where the clip starts. */
  from: number;
  /** Absolute frame where it ends (exclusive). */
  to: number;
  /** id of the enclosing sequence, if any. */
  parent: string | null;
  /** Asset URL for media layers. */
  src?: string;
  /** "compositions/title.tsx:24" when known. */
  source?: string;
}

const state = {
  mode: "preview" as Mode,
  assetBase: "/assets/",
  errors: [] as string[],
  audio: new Map<string, AudioClip>(),
  timeline: new Map<string, TimelineClip>(),
};

export function setMode(mode: Mode) {
  state.mode = mode;
}

export function getMode(): Mode {
  return state.mode;
}

export function setAssetBase(base: string) {
  state.assetBase = base.endsWith("/") ? base : `${base}/`;
}

export function getAssetBase() {
  return state.assetBase;
}

export function reportError(message: string) {
  if (!state.errors.includes(message)) state.errors.push(message);
}

export function takeErrors(): string[] {
  const out = state.errors;
  state.errors = [];
  return out;
}

export function registerAudio(clip: AudioClip) {
  const key = `${clip.src}|${clip.startFrame}|${clip.trimStart}`;
  state.audio.set(key, clip);
}

export function collectedAudio(): AudioClip[] {
  return [...state.audio.values()];
}

export function registerClip(clip: TimelineClip) {
  state.timeline.set(clip.id, clip);
}

export function collectedTimeline(): TimelineClip[] {
  return [...state.timeline.values()].sort((a, b) => a.from - b.from || a.id.localeCompare(b.id));
}
