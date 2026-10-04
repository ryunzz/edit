const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const Icon = {
  composition: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" {...stroke} aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1" /><path d="M5 3v10M11 3v10" /></svg>
  ),
  audio: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" {...stroke} aria-hidden="true"><path d="M2.5 6h2.5l3.5-3v10L5 10H2.5z" /><path d="M11 5.5a3.5 3.5 0 010 5" /></svg>
  ),
  image: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" {...stroke} aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1" /><circle cx="6" cy="6.5" r="1.5" /><path d="M2.5 12l4-4 3 3 2-2 2.5 2.5" /></svg>
  ),
  file: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" {...stroke} aria-hidden="true"><path d="M4 1.5h5l3 3v10H4z" /><path d="M9 1.5v3h3" /></svg>
  ),
  upload: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" {...stroke} aria-hidden="true"><path d="M8 11V3M4.5 6.5L8 3l3.5 3.5M2.5 13.5h11" /></svg>
  ),
  lock: () => (
    <svg width="14" height="14" viewBox="0 0 16 16" {...stroke} aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1" /><path d="M5.5 7V5a2.5 2.5 0 015 0v2" /></svg>
  ),
  check: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" {...stroke} aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
  ),
  start: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="1.5" height="10" /><path d="M13 3v10L5.5 8z" /></svg>
  ),
  back: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M11.5 3.5v9L5 8z" /></svg>
  ),
  play: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.5 3v10l8.5-5z" /></svg>
  ),
  pause: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4" y="3" width="3" height="10" /><rect x="9" y="3" width="3" height="10" /></svg>
  ),
  forward: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.5 3.5v9L11 8z" /></svg>
  ),
  end: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 3v10l7.5-5z" /><rect x="11.5" y="3" width="1.5" height="10" /></svg>
  ),
};
