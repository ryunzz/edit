import { AbsoluteFill, Audio, Easing, Img, Sequence, asset, interpolate, random, spring, useFrame } from "@ryunzz/edit-core";

export const meta = { width: 1920, height: 1080, fps: 30, durationInFrames: 180, background: "#ff4d1f" };

const ink = "#0f0f11";
const cream = "#f3ede1";

function MakeIt() {
  const frame = useFrame();
  const y = interpolate(frame, [0, 20], [40, 0], { easing: Easing.out(Easing.cubic) });
  const opacity = interpolate(frame, [0, 12, 28, 36], [0, 1, 1, 0]);
  return (
    <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 160 }}>
      <div style={{ font: "400 200px Georgia, serif", color: ink, transform: `translateY(${y}px)`, opacity }}>MAKE IT</div>
    </AbsoluteFill>
  );
}

function Move() {
  const frame = useFrame();
  const pop = spring({ frame, damping: 9, stiffness: 180 });
  const scale = interpolate(pop, [0, 1], [0.6, 1], { extrapolateRight: "extend" });
  const ring = interpolate(frame, [0, 40], [0.2, 1.6], { easing: Easing.out(Easing.exp) });
  const ringOpacity = interpolate(frame, [20, 50], [1, 0]);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          position: "absolute",
          width: 700,
          height: 700,
          borderRadius: "50%",
          border: `10px solid ${cream}`,
          transform: `scale(${ring})`,
          opacity: ringOpacity,
        }}
      />
      {Array.from({ length: 12 }, (_, i) => {
        const angle = (i / 12) * Math.PI * 2 + random(`a${i}`) * 0.3;
        const dist = interpolate(frame, [0, 30], [0, 420 + random(`d${i}`) * 200], { easing: Easing.out(Easing.cubic) });
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              width: 18,
              height: 18,
              background: cream,
              transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px)`,
              opacity: ringOpacity,
            }}
          />
        );
      })}
      <div style={{ font: "italic 400 460px Georgia, serif", letterSpacing: "-0.03em", color: ink, transform: `scale(${scale}) rotate(-2deg)` }}>
        MOVE.
      </div>
    </AbsoluteFill>
  );
}

function Logo() {
  const frame = useFrame();
  const wipe = interpolate(frame, [0, 18], [0, 100], { easing: Easing.inOut(Easing.cubic) });
  const logo = spring({ frame: frame - 10, damping: 14 });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <AbsoluteFill style={{ background: cream, clipPath: `circle(${wipe * 1.2}% at 50% 50%)` }} />
      <Img src={asset("logo.svg")} style={{ width: 600, transform: `scale(${logo})` }} />
    </AbsoluteFill>
  );
}

export default function Title() {
  return (
    <>
      <Audio src={asset("score.m4a")} volume={0.8} />
      <Sequence name="make-it" durationInFrames={36}>
        <MakeIt />
      </Sequence>
      <Sequence name="move" from={30} durationInFrames={90}>
        <Move />
      </Sequence>
      <Sequence name="logo" from={110}>
        <Logo />
      </Sequence>
    </>
  );
}
