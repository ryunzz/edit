export interface CompositionMeta {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  /** Optional background painted behind the composition. Defaults to transparent. */
  background?: string;
}

export const DEFAULT_META: CompositionMeta = { width: 1920, height: 1080, fps: 30, durationInFrames: 150 };

let active: CompositionMeta = DEFAULT_META;

/** Set by the runtime when a composition mounts. */
export function setCurrentConfig(meta: CompositionMeta) {
  active = meta;
}

export function currentConfig(): CompositionMeta {
  return active;
}

export function validateMeta(meta: unknown, id: string): CompositionMeta {
  if (!meta || typeof meta !== "object") {
    throw new Error(`Composition "${id}" must export \`meta\` with width, height, fps and durationInFrames`);
  }
  const m = { ...DEFAULT_META, ...(meta as Partial<CompositionMeta>) };
  for (const key of ["width", "height", "fps", "durationInFrames"] as const) {
    const v = m[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      throw new Error(`Composition "${id}": meta.${key} must be a positive number, got ${String(v)}`);
    }
  }
  if (!Number.isInteger(m.durationInFrames)) {
    throw new Error(`Composition "${id}": meta.durationInFrames must be a whole number of frames`);
  }
  return m;
}
