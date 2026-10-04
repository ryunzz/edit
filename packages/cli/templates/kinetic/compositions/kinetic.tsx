import { AbsoluteFill, Easing, Sequence, interpolate, random, spring, useFrame, useVideoConfig } from "@ryunzz/edit-core";

export const meta = { width: 1920, height: 1080, fps: 30, durationInFrames: 180, background: "#f3ede1" };

const ink = "#141413";
const accent = "#0077b6";
// One word per beat at 120 BPM (15 frames). Change the words, keep the rhythm.
const WORDS = ["MAKE", "IT", "MOVE", "WITH", "CODE."];
const BEAT = 15;

function Word({ text, index }: { text: string; index: number }) {
  const frame = useFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, damping: 11, stiffness: 170 });
  const y = interpolate(pop, [0, 1], [140, 0], { extrapolateRight: "extend" });
  const tilt = (random(`tilt-${index}`) - 0.5) * 6;
  const last = index === WORDS.length - 1;
  return (
    <span
      style={{
        display: "inline-block",
        marginRight: 36,
        color: last ? accent : ink,
        fontStyle: last ? "italic" : "normal",
        transform: `translateY(${y}px) rotate(${tilt * (1 - Math.min(pop, 1))}deg)`,
        opacity: interpolate(frame, [0, 4], [0, 1]),
      }}
    >
      {text}
    </span>
  );
}

function Underline() {
  const frame = useFrame();
  const width = interpolate(frame, [0, 18], [0, 100], { easing: Easing.inOut(Easing.cubic) });
  return <div style={{ position: "absolute", left: 160, bottom: 300, height: 14, width: `${width * 0.6}%`, background: accent }} />;
}

export default function Kinetic() {
  const frame = useFrame();
  const out = interpolate(frame, [160, 180], [1, 0], { easing: Easing.in(Easing.cubic) });
  return (
    <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 160, opacity: out }}>
      <div style={{ display: "flex", flexWrap: "wrap", maxWidth: 1600, font: "700 150px/1.05 'Helvetica Neue', Arial, sans-serif", letterSpacing: "-0.03em" }}>
        {WORDS.map((w, i) => (
          <Sequence key={w} name={w.toLowerCase().replace(/\W/g, "")} from={10 + i * BEAT} layout="none">
            <Word text={w} index={i} />
          </Sequence>
        ))}
      </div>
      <Sequence name="underline" from={10 + WORDS.length * BEAT} layout="none">
        <Underline />
      </Sequence>
    </AbsoluteFill>
  );
}
