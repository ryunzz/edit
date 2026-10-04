import { AbsoluteFill, Easing, Img, Sequence, asset, interpolate, random, spring, useFrame } from "@ryunzz/edit-core";

export const meta = { width: 1920, height: 1080, fps: 30, durationInFrames: 90, background: "#0f0f11" };

const glow = "#0077b6";

function Burst() {
  const frame = useFrame();
  const ring = interpolate(frame, [0, 24], [0.3, 1.8], { easing: Easing.out(Easing.exp) });
  const fade = interpolate(frame, [8, 30], [1, 0]);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", width: 520, height: 520, borderRadius: "50%", border: `6px solid ${glow}`, transform: `scale(${ring})`, opacity: fade }} />
      {Array.from({ length: 16 }, (_, i) => {
        const angle = (i / 16) * Math.PI * 2 + random(`a${i}`) * 0.4;
        const dist = interpolate(frame, [0, 26], [60, 380 + random(`d${i}`) * 220], { easing: Easing.out(Easing.cubic) });
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              width: 10,
              height: 10,
              borderRadius: 5,
              background: "#ecebe8",
              transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px)`,
              opacity: fade,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
}

function Logo() {
  const frame = useFrame();
  const pop = spring({ frame, damping: 12, stiffness: 160 });
  const blur = interpolate(frame, [0, 10], [12, 0]);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <Img src={asset("logo.svg")} style={{ width: 720, transform: `scale(${interpolate(pop, [0, 1], [0.7, 1], { extrapolateRight: "extend" })})`, filter: `blur(${blur}px)`, opacity: Math.min(1, pop * 1.5) }} />
    </AbsoluteFill>
  );
}

function Tagline() {
  const frame = useFrame();
  const opacity = interpolate(frame, [0, 12], [0, 1]);
  const spacing = interpolate(frame, [0, 30], [0.6, 0.3], { easing: Easing.out(Easing.cubic) });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: 260 }}>
      <span style={{ font: "500 28px ui-monospace, Menlo, monospace", letterSpacing: `${spacing}em`, color: "#a3a19c", opacity }}>MADE WITH EDIT</span>
    </AbsoluteFill>
  );
}

export default function LogoSting() {
  const frame = useFrame();
  const out = interpolate(frame, [76, 90], [1, 0]);
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <Sequence name="burst" from={6} durationInFrames={36}>
        <Burst />
      </Sequence>
      <Sequence name="logo" from={8}>
        <Logo />
      </Sequence>
      <Sequence name="tagline" from={34}>
        <Tagline />
      </Sequence>
    </AbsoluteFill>
  );
}
