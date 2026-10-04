import { AbsoluteFill, Easing, interpolate, useFrame } from "@ryunzz/edit-core";

export const meta = { width: 1920, height: 1080, fps: 30, durationInFrames: 90, background: "#0f0f11" };

export default function Main() {
  const frame = useFrame();
  const opacity = interpolate(frame, [0, 20], [0, 1]);
  const y = interpolate(frame, [0, 24], [24, 0], { easing: Easing.out(Easing.cubic) });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <h1 style={{ margin: 0, color: "#ecebe8", font: "400 120px Georgia, serif", opacity, transform: `translateY(${y}px)` }}>Hello</h1>
    </AbsoluteFill>
  );
}
