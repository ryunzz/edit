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

const state = {
  mode: "preview" as Mode,
  assetBase: "/assets/",
  errors: [] as string[],
  audio: new Map<string, AudioClip>(),
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
