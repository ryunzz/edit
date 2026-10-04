import { useEffect, useRef } from "react";

export interface CompositionMeta {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  background?: string;
}

export interface CompositionEntry {
  id: string;
  meta: CompositionMeta | null;
  error: string | null;
}

export interface ProjectInfo {
  name: string;
  root: string;
  version: number;
  port: number;
}

export interface TimelineClip {
  id: string;
  kind: "sequence" | "image" | "video" | "audio";
  name: string;
  from: number;
  to: number;
  parent: string | null;
  src?: string;
  source?: string;
}

export interface AudioClip {
  src: string;
  startFrame: number;
  endFrame: number;
  trimStart: number;
  volume: number;
  rate?: number;
}

/** The bridge a composition exposes inside its preview iframe (see edit-core runtime). */
export interface EditBridge {
  id: string;
  meta: CompositionMeta;
  setFrame(frame: number): Promise<void>;
  drawFrame(frame: number): void;
  timeline(): { clips: TimelineClip[]; errors: string[] };
  audio(): AudioClip[];
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || `${method} ${url} failed with ${res.status}`);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  del: <T>(url: string) => request<T>("DELETE", url),
};

/** Subscribes to the helper's server-sent events. Handlers may change between renders. */
export function useEvents(handlers: Record<string, (data: any) => void>) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const source = new EventSource("/api/events");
    const names = new Set<string>();
    const listen = (name: string) => {
      if (names.has(name)) return;
      names.add(name);
      source.addEventListener(name, (e) => ref.current[name]?.(JSON.parse((e as MessageEvent).data)));
    };
    for (const name of Object.keys(ref.current)) if (name !== "open" && name !== "disconnect") listen(name);
    source.addEventListener("open", () => ref.current.open?.({}));
    source.addEventListener("error", () => ref.current.disconnect?.({}));
    return () => source.close();
  }, []);
}
