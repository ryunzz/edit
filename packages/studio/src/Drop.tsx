import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

export type DropTarget = "assets" | "refs";

const ROUTE: Record<DropTarget, string> = { assets: "/api/assets/", refs: "/api/refs/files/" };

async function upload(target: DropTarget, file: File): Promise<string> {
  const res = await fetch(`${ROUTE[target]}${encodeURIComponent(file.name)}`, { method: "PUT", body: file });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Upload of ${file.name} failed`);
  return body.name as string;
}

/** A web link carried by a drag from another tab (YouTube, TikTok, Instagram…), if any. */
function draggedUrl(dt: DataTransfer): string | null {
  const text = (dt.getData("text/uri-list") || dt.getData("text/plain") || "").split("\n").find((l) => l && !l.startsWith("#"))?.trim();
  return text && /^https?:\/\//i.test(text) ? text : null;
}

/**
 * Drag and drop for the whole studio. Files dropped on the Refs section (data-drop="refs") go to
 * _refs/, anywhere else to _assets/. A dragged link always becomes a reference.
 */
export function useDrop(onChange: (target: DropTarget) => void) {
  const [over, setOver] = useState<DropTarget | null>(null);
  const [uploading, setUploading] = useState<{ name: string; target: DropTarget }[]>([]);
  const [error, setError] = useState<{ target: DropTarget; message: string } | null>(null);

  const addFiles = useCallback(
    async (target: DropTarget, files: File[]) => {
      setError(null);
      setUploading((u) => [...u, ...files.map((f) => ({ name: f.name, target }))]);
      for (const f of files) {
        try {
          await upload(target, f);
        } catch (e) {
          setError({ target, message: e instanceof Error ? e.message : String(e) });
        } finally {
          setUploading((u) => u.filter((x) => !(x.name === f.name && x.target === target)));
        }
      }
      onChange(target);
    },
    [onChange],
  );

  const addLink = useCallback(
    async (url: string, note = "") => {
      setError(null);
      try {
        await api.post("/api/refs/links", { url, note });
        onChange("refs");
        return true;
      } catch (e) {
        setError({ target: "refs", message: e instanceof Error ? e.message : String(e) });
        return false;
      }
    },
    [onChange],
  );

  useEffect(() => {
    let depth = 0;
    const accepts = (e: DragEvent) => {
      const types = Array.from(e.dataTransfer?.types ?? []);
      return types.includes("Files") || types.includes("text/uri-list");
    };
    const targetOf = (e: DragEvent): DropTarget => {
      if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return "refs";
      return (e.target as Element | null)?.closest?.('[data-drop="refs"]') ? "refs" : "assets";
    };
    const enter = (e: DragEvent) => {
      if (!accepts(e)) return;
      depth++;
      setOver(targetOf(e));
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(null);
    };
    const move = (e: DragEvent) => {
      if (!accepts(e)) return;
      e.preventDefault();
      setOver(targetOf(e));
    };
    const drop = (e: DragEvent) => {
      if (!accepts(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(null);
      const files = Array.from(e.dataTransfer!.files);
      if (files.length) void addFiles(targetOf(e), files);
      else {
        const url = draggedUrl(e.dataTransfer!);
        if (url) void addLink(url);
      }
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", move);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", move);
      window.removeEventListener("drop", drop);
    };
  }, [addFiles, addLink]);

  return { over, uploading, error, addFiles, addLink };
}
