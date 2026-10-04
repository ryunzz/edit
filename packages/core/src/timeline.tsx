import { createContext, useContext, useId, type CSSProperties, type ReactNode } from "react";
import { currentConfig, type CompositionMeta } from "./config";
import { registerClip } from "./env";
import { SOURCE_AWARE } from "./jsx-dev-runtime";

/** The absolute frame of the composition being drawn. */
export const FrameContext = createContext(0);

interface SequenceScope {
  /** Absolute frame where the enclosing sequence starts. */
  offset: number;
  /** Absolute frame where the enclosing sequence ends (exclusive). */
  end: number;
  /** Timeline id of the enclosing sequence; null at the top level. */
  id: string | null;
}

export const SequenceContext = createContext<SequenceScope>({ offset: 0, end: Infinity, id: null });

/** The current frame, relative to the nearest enclosing <Sequence>. */
export function useFrame(): number {
  return useContext(FrameContext) - useContext(SequenceContext).offset;
}

export function useVideoConfig(): CompositionMeta {
  return currentConfig();
}

/** Internal: absolute start and end of the nearest sequence. */
export function useSequenceScope(): SequenceScope {
  return useContext(SequenceContext);
}

const fill: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
};

export function AbsoluteFill({ style, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} style={{ ...fill, ...style }}>
      {children}
    </div>
  );
}

export interface SequenceProps {
  /** Frame (relative to the parent) where this sequence starts. Default 0. */
  from?: number;
  /** Length in frames. Default: until the parent ends. */
  durationInFrames?: number;
  /** Shown in the studio timeline. */
  name?: string;
  /** "fill" wraps children in an AbsoluteFill (default); "none" renders them as-is. */
  layout?: "fill" | "none";
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Shows its children only between `from` and `from + durationInFrames`.
 * Inside, useFrame() counts from 0 at the sequence's start.
 */
export function Sequence(props: SequenceProps) {
  const { from = 0, durationInFrames = Infinity, name, layout = "fill", style, children } = props;
  const source = (props as { __source?: string }).__source;
  const frame = useContext(FrameContext);
  const parent = useContext(SequenceContext);
  const id = useId();
  if (!Number.isFinite(from) || !Number.isInteger(from)) {
    throw new Error(`<Sequence${name ? ` name="${name}"` : ""}> from must be a whole number, got ${from}`);
  }
  if (durationInFrames <= 0) {
    throw new Error(`<Sequence${name ? ` name="${name}"` : ""}> durationInFrames must be positive`);
  }
  const offset = parent.offset + from;
  const end = Math.min(parent.end, offset + durationInFrames, currentConfig().durationInFrames);
  registerClip({ id, kind: "sequence", name: name ?? "Sequence", from: offset, to: end, parent: parent.id, source });
  if (frame < offset || frame >= end) return null;

  const content =
    layout === "fill" ? (
      <div data-sequence={name} style={{ ...fill, ...style }}>
        {children}
      </div>
    ) : (
      children
    );
  return <SequenceContext.Provider value={{ offset, end, id }}>{content}</SequenceContext.Provider>;
}
(Sequence as unknown as Record<symbol, boolean>)[SOURCE_AWARE] = true;
