import { stat } from "node:fs/promises";
import { ffmpegPath, runTool } from "./tools";

export interface AudioAnalysis {
  durationSeconds: number;
  durationInFrames: number;
  /** Tempo rounded to 0.1, or null when there is no clear periodicity (e.g. silence). */
  bpm: number | null;
  /** Beat positions as video frames. */
  beats: number[];
  /** Onset (note/hit) positions as video frames. */
  onsets: number[];
  /** One value per video frame: RMS in dBFS, floored at -60, rounded to 0.1. */
  loudness: number[];
}

export const SAMPLE_RATE = 22050;
const FRAME = 1024;
const HOP = 512;
const FLOOR_DB = -60;

/** Decodes any audio (or the audio of a video) to mono 22050 Hz float samples. */
export async function decodeAudio(file: string): Promise<Float32Array> {
  try {
    await stat(file);
  } catch {
    throw new Error(`Analysing audio of ${file}: file not found.`);
  }
  const { stdout } = await runTool(
    ffmpegPath(),
    ["-hide_banner", "-loglevel", "error", "-i", file, "-vn", "-f", "f32le", "-ac", "1", "-ar", String(SAMPLE_RATE), "-"],
    { file, action: "Decoding audio of" },
  );
  const usable = stdout.length - (stdout.length % 4);
  const copy = new ArrayBuffer(usable);
  new Uint8Array(copy).set(stdout.subarray(0, usable));
  return new Float32Array(copy);
}

// ---- FFT ---------------------------------------------------------------------------------

/** In-place iterative radix-2 complex FFT. */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]!;
      re[i] = re[j]!;
      re[j] = t;
      t = im[i]!;
      im[i] = im[j]!;
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/**
 * Spectral flux of log-compressed magnitude spectra. Frames are centred: novelty[m] describes
 * time m * HOP / SAMPLE_RATE.
 */
export function spectralFlux(samples: Float32Array): Float64Array {
  const count = Math.max(1, Math.ceil(samples.length / HOP));
  const out = new Float64Array(count);
  const window = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME);
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  const bins = FRAME / 2;
  let prev = new Float64Array(bins + 1);
  let cur = new Float64Array(bins + 1);
  for (let m = 0; m < count; m++) {
    const start = m * HOP - FRAME / 2;
    for (let i = 0; i < FRAME; i++) {
      const s = start + i;
      re[i] = s >= 0 && s < samples.length ? samples[s]! * window[i]! : 0;
      im[i] = 0;
    }
    fft(re, im);
    let flux = 0;
    for (let k = 1; k <= bins; k++) {
      const mag = Math.sqrt(re[k]! * re[k]! + im[k]! * im[k]!);
      const v = Math.log1p(100 * mag);
      cur[k] = v;
      if (m > 0) {
        const d = v - prev[k]!;
        if (d > 0) flux += d;
      }
    }
    out[m] = flux;
    const t = prev;
    prev = cur;
    cur = t;
  }
  return out;
}

// ---- helpers -----------------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function smooth(x: Float64Array, radius: number): Float64Array {
  if (radius <= 0) return Float64Array.from(x);
  const kernel: number[] = [];
  for (let i = -radius; i <= radius; i++) kernel.push(0.5 + 0.5 * Math.cos((Math.PI * i) / (radius + 1)));
  const sum = kernel.reduce((a, b) => a + b, 0);
  const out = new Float64Array(x.length);
  for (let n = 0; n < x.length; n++) {
    let acc = 0;
    for (let i = -radius; i <= radius; i++) {
      const j = n + i;
      if (j >= 0 && j < x.length) acc += x[j]! * kernel[i + radius]!;
    }
    out[n] = acc / sum;
  }
  return out;
}

// ---- onsets ------------------------------------------------------------------------------

/** Adaptive-threshold peak picking on the novelty curve. Returns hop indices. */
export function pickOnsets(novelty: Float64Array, hopSeconds: number): number[] {
  let max = 0;
  for (const v of novelty) if (v > max) max = v;
  if (max <= 1e-6) return [];
  const n = Array.from(novelty, (v) => v / max);
  const peakRadius = 3;
  const meanRadius = 10;
  const medianRadius = 8;
  const delta = 0.07;
  const minGap = Math.max(1, Math.ceil(0.05 / hopSeconds));
  const onsets: number[] = [];
  for (let m = 0; m < n.length; m++) {
    const v = n[m]!;
    if (v < delta) continue;
    let isMax = true;
    for (let i = Math.max(0, m - peakRadius); i <= Math.min(n.length - 1, m + peakRadius); i++) {
      if (n[i]! > v || (n[i] === v && i < m)) {
        isMax = false;
        break;
      }
    }
    if (!isMax) continue;
    let acc = 0;
    let cnt = 0;
    for (let i = Math.max(0, m - meanRadius); i <= Math.min(n.length - 1, m + meanRadius); i++) {
      acc += n[i]!;
      cnt++;
    }
    if (v < acc / cnt + delta) continue;
    const med = median(n.slice(Math.max(0, m - medianRadius), m + medianRadius + 1));
    if (v < med + delta) continue;
    const last = onsets[onsets.length - 1];
    if (last !== undefined && m - last < minGap) {
      if (v > n[last]!) onsets[onsets.length - 1] = m;
      continue;
    }
    onsets.push(m);
  }
  return onsets;
}

// ---- tempo -------------------------------------------------------------------------------

function autocorrelation(x: Float64Array, maxLag: number): Float64Array {
  const acf = new Float64Array(maxLag + 1);
  for (let k = 0; k <= maxLag; k++) {
    let s = 0;
    for (let n = 0; n + k < x.length; n++) s += x[n]! * x[n + k]!;
    acf[k] = s;
  }
  const zero = acf[0]! || 1;
  for (let k = 0; k <= maxLag; k++) acf[k] = acf[k]! / zero;
  return acf;
}

function acfAt(acf: Float64Array, lag: number): number {
  const i = Math.floor(lag);
  if (i < 0 || i + 1 >= acf.length) return 0;
  const f = lag - i;
  return acf[i]! * (1 - f) + acf[i + 1]! * f;
}

/** Mild preference for 80–160 BPM; tempos outside fall off gently. */
function tempoWeight(bpm: number): number {
  if (bpm >= 80 && bpm <= 160) return 1;
  const octaves = bpm < 80 ? Math.log2(bpm / 80) : Math.log2(bpm / 160);
  return Math.exp(-0.5 * (octaves / 0.35) ** 2);
}

/** Returns the tempo (BPM) and beat period in hops, or null if there is no clear periodicity. */
export function estimateTempo(novelty: Float64Array, hopSeconds: number): { bpm: number; period: number } | null {
  const lagOf = (bpm: number) => 60 / (bpm * hopSeconds);
  const maxLag = lagOf(60);
  if (novelty.length < maxLag * 2 + 2) return null;

  const env = smooth(novelty, 1);
  let mean = 0;
  for (const v of env) mean += v;
  mean /= env.length;
  const centred = Float64Array.from(env, (v) => v - mean);
  const acfLen = Math.min(centred.length - 1, Math.ceil(maxLag * 4) + 2);
  const acf = autocorrelation(centred, acfLen);
  if (!Number.isFinite(acf[1]!)) return null;

  // 1. pick the tempo octave by weighted ACF on a coarse grid
  let best = 0;
  let bestScore = -Infinity;
  let bestRaw = 0;
  for (let bpm = 60; bpm <= 200; bpm += 0.5) {
    const raw = acfAt(acf, lagOf(bpm));
    const score = raw * tempoWeight(bpm);
    if (score > bestScore) {
      bestScore = score;
      best = bpm;
      bestRaw = raw;
    }
  }
  if (bestRaw < 0.1) return null;

  // 2. refine using harmonics of the lag (errors shrink by the harmonic number)
  let refined = best;
  let refinedScore = -Infinity;
  for (let bpm = best * 0.97; bpm <= best * 1.03; bpm += 0.02) {
    const lag = lagOf(bpm);
    let s = 0;
    let used = 0;
    for (let j = 1; j <= 4; j++) {
      if (j * lag + 1 >= acf.length) break;
      s += acfAt(acf, j * lag);
      used++;
    }
    if (used === 0) continue;
    s /= used;
    if (s > refinedScore) {
      refinedScore = s;
      refined = bpm;
    }
  }
  return { bpm: refined, period: lagOf(refined) };
}

// ---- beats -------------------------------------------------------------------------------

/** Dynamic-programming beat tracker (Ellis 2007). Returns hop indices. */
export function trackBeats(novelty: Float64Array, period: number, tightness = 100): number[] {
  const T = novelty.length;
  if (T === 0 || !(period > 1)) return [];
  const env = smooth(novelty, Math.max(1, Math.round(period / 16)));
  let sq = 0;
  let mean = 0;
  for (const v of env) mean += v;
  mean /= T;
  for (const v of env) sq += (v - mean) ** 2;
  const std = Math.sqrt(sq / T) || 1;
  const local = Float64Array.from(env, (v) => v / std);

  const score = new Float64Array(T);
  const back = new Int32Array(T).fill(-1);
  const lo = Math.round(period / 2);
  const hi = Math.round(period * 2);
  for (let t = 0; t < T; t++) {
    let bestPrev = -Infinity;
    let bestIdx = -1;
    for (let tau = t - hi; tau <= t - lo; tau++) {
      if (tau < 0) continue;
      const c = score[tau]! - tightness * Math.log((t - tau) / period) ** 2;
      if (c > bestPrev) {
        bestPrev = c;
        bestIdx = tau;
      }
    }
    if (bestIdx >= 0 && bestPrev > 0) {
      score[t] = local[t]! + bestPrev;
      back[t] = bestIdx;
    } else {
      score[t] = local[t]!;
    }
  }

  // last beat: the last local maximum of the cumulative score above half the median of maxima
  const maxima: number[] = [];
  for (let t = 0; t < T; t++) {
    const l = t > 0 ? score[t - 1]! : -Infinity;
    const r = t < T - 1 ? score[t + 1]! : -Infinity;
    if (score[t]! >= l && score[t]! >= r) maxima.push(t);
  }
  const med = median(maxima.map((t) => score[t]!));
  let end = -1;
  for (const t of maxima) if (score[t]! * 2 > med) end = t;
  if (end < 0) return [];

  const beats: number[] = [];
  for (let t = end; t >= 0; t = back[t]!) beats.push(t);
  beats.reverse();

  // trim weak beats at the edges (e.g. in silence before the first or after the last hit)
  const strength = smooth(novelty, Math.max(2, Math.round(period / 8)));
  const rms = Math.sqrt(beats.reduce((a, b) => a + strength[b]! ** 2, 0) / Math.max(1, beats.length));
  const threshold = 0.5 * rms;
  let first = 0;
  let last = beats.length - 1;
  while (first <= last && strength[beats[first]!]! < threshold) first++;
  while (last >= first && strength[beats[last]!]! < threshold) last--;
  return beats.slice(first, last + 1);
}

// ---- loudness ----------------------------------------------------------------------------

export function loudnessPerFrame(samples: Float32Array, fps: number, frames: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < frames; i++) {
    const a = Math.floor((i * SAMPLE_RATE) / fps);
    const b = Math.min(samples.length, Math.floor(((i + 1) * SAMPLE_RATE) / fps));
    if (b <= a) {
      out.push(FLOOR_DB);
      continue;
    }
    let sum = 0;
    for (let s = a; s < b; s++) sum += samples[s]! * samples[s]!;
    const rms = Math.sqrt(sum / (b - a));
    const db = rms > 0 ? 20 * Math.log10(rms) : FLOOR_DB;
    out.push(Math.round(Math.max(FLOOR_DB, db) * 10) / 10);
  }
  return out;
}

// ---- public API --------------------------------------------------------------------------

/** Analyses samples already decoded at SAMPLE_RATE (mono). */
export function analyzeSamples(samples: Float32Array, options: { fps: number }): AudioAnalysis {
  const { fps } = options;
  const hopSeconds = HOP / SAMPLE_RATE;
  const durationSeconds = samples.length / SAMPLE_RATE;
  const durationInFrames = Math.round(durationSeconds * fps);
  const loudness = loudnessPerFrame(samples, fps, durationInFrames);
  const toFrame = (hop: number) => Math.round(hop * hopSeconds * fps);

  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]!);
    if (v > peak) peak = v;
  }
  if (peak < 1e-4) return { durationSeconds, durationInFrames, bpm: null, beats: [], onsets: [], loudness };

  const novelty = spectralFlux(samples);
  const onsetHops = pickOnsets(novelty, hopSeconds);
  const tempo = estimateTempo(novelty, hopSeconds);

  let beatHops: number[] = [];
  if (tempo) {
    beatHops = trackBeats(novelty, tempo.period).map((b) => {
      let best = b;
      let bestDist = 1.5;
      for (const o of onsetHops) {
        const d = Math.abs(o - b);
        if (d <= bestDist) {
          bestDist = d;
          best = o;
        }
      }
      return best;
    });
  }

  const uniqueFrames = (hops: number[]) =>
    [...new Set(hops.map(toFrame))].filter((f) => f >= 0 && f <= durationInFrames).sort((a, b) => a - b);

  return {
    durationSeconds,
    durationInFrames,
    bpm: tempo ? Math.round(tempo.bpm * 10) / 10 : null,
    beats: uniqueFrames(beatHops),
    onsets: uniqueFrames(onsetHops),
    loudness,
  };
}

/**
 * Decodes `file` with ffmpeg and finds onsets, tempo, beats and per-frame loudness at the
 * given video frame rate.
 */
export async function analyzeAudio(file: string, options: { fps: number }): Promise<AudioAnalysis> {
  if (!(options.fps > 0)) throw new Error(`Analysing audio of ${file}: fps must be a positive number (got ${options.fps}).`);
  const samples = await decodeAudio(file);
  if (samples.length === 0) throw new Error(`Analysing audio of ${file}: no audio decoded (the file has no audio stream or is empty).`);
  return analyzeSamples(samples, options);
}
