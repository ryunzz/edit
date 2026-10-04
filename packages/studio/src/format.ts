const pad = (n: number) => String(n).padStart(2, "0");

/** HH:MM:SS:FF */
export function timecode(frame: number, fps: number): string {
  const f = Math.max(0, Math.round(frame));
  const whole = Math.round(fps);
  const totalSeconds = Math.floor(f / fps);
  const ff = f - Math.round(totalSeconds * fps);
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}:${pad(Math.min(ff, whole - 1))}`;
}

/** MM:SS:FF, for lengths in lists. */
export function shortTimecode(frames: number, fps: number): string {
  return timecode(frames, fps).slice(3);
}

/** MM:SS, for ruler ticks and media durations. */
export function clock(seconds: number): string {
  const s = Math.round(seconds);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
