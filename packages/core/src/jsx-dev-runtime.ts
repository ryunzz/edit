// Compositions are compiled with this as their JSX runtime. It forwards to React's
// production runtime and records where each element was written, so the studio can
// say "h1 · title.tsx:24" and the timeline can link a clip to its line of code.
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

export { Fragment };

interface Source {
  fileName?: string;
  lineNumber?: number;
}

/** Marks a component that accepts the `__source` prop ("file:line"). */
export const SOURCE_AWARE = Symbol.for("edit.sourceAware");

function where(source: Source | undefined): string | null {
  const file = source?.fileName;
  if (!file || !source.lineNumber) return null;
  // Only the project's own files: not edit-core, not node_modules.
  if (file.startsWith("..") || file.startsWith("/") || file.includes("node_modules")) return null;
  return `${file}:${source.lineNumber}`;
}

export function jsxDEV(type: unknown, props: Record<string, unknown>, key: unknown, isStatic: boolean, source?: Source) {
  const at = where(source);
  if (at) {
    if (typeof type === "string") props = { ...props, "data-edit-src": at };
    else if (type && (type as Record<symbol, unknown>)[SOURCE_AWARE]) props = { ...props, __source: at };
  }
  const k = key === undefined ? undefined : (key as string);
  return (isStatic ? jsxs : jsx)(type as never, props, k);
}
