import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/Onest";
import MAP from "./map-data.json";
import DOTS from "./dots.json";

const { fontFamily } = loadFont("normal", { weights: ["400", "500", "600", "700", "800"], subsets: ["latin"] });

export const DURATION = 624; // 20,8 s a 30 fps
const W = 1080;
const H = 1920;
const CX = W / 2;
const CY = H / 2;

// ---------- Paleta ----------
const C = {
  bg0: "#03050B",
  bg1: "#08101F",
  blue: "#2563EB",
  blueL: "#60A5FA",
  sky: "#93C5FD",
  cyan: "#67E8F9",
  ink: "#0B1220",
  muted: "#565B64",
};

// ---------- Proyección (igual que scripts/build-map.mjs) ----------
const ORIGIN = { lat: 40.4169, lon: -3.7035 };
const KM = 300;
const LON_KM = 111.32 * Math.cos((ORIGIN.lat * Math.PI) / 180);
const project = (lat: number, lon: number): [number, number] => [
  (lon - ORIGIN.lon) * LON_KM * KM,
  -(lat - ORIGIN.lat) * 111.32 * KM,
];

// ---------- Utilidades ----------
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const inOut = Easing.bezier(0.65, 0, 0.35, 1);
const outExpo = Easing.bezier(0.16, 1, 0.3, 1);
const inCubic = Easing.bezier(0.55, 0, 1, 0.45);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const prog = (f: number, a: number, b: number, e: (t: number) => number = (t) => t) => e(clamp01((f - a) / (b - a)));

let s = 11;
const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);

// ---------- Planes ----------
type Plan = { title: string; place: string; time: string; img: string; going: number; lat: number; lon: number; cat: string };
const PLANS: Plan[] = [
  { title: "Intercambio de idiomas", place: "Malasaña", time: "19:30", img: "IDIOMAS_4.jpg", going: 23, lat: 40.4268, lon: -3.7038, cat: "Idiomas" },
  { title: "Cena para conocer gente", place: "Chueca", time: "21:00", img: "CENAR_4.jpg", going: 12, lat: 40.4228, lon: -3.6973, cat: "Comer" },
  { title: "Noche de juegos de mesa", place: "Chamberí", time: "20:00", img: "JUEGOS_DE_MESA_2.jpg", going: 9, lat: 40.4326, lon: -3.7023, cat: "Juegos" },
  { title: "Noche de monólogos", place: "Huertas", time: "21:00", img: "TEATRO_3.jpg", going: 15, lat: 40.4146, lon: -3.6995, cat: "Showtime" },
  { title: "Tardeo y vermú", place: "La Latina", time: "19:00", img: "PICOTEO_OTRO_5_11zon.jpg", going: 18, lat: 40.4113, lon: -3.7104, cat: "Picoteo" },
  { title: "Concierto en sala", place: "Lavapiés", time: "21:30", img: "CONCIERTO_3.jpg", going: 31, lat: 40.4089, lon: -3.7008, cat: "Música" },
  { title: "Running nocturno", place: "Madrid Río", time: "20:30", img: "RUNNING_2.jpg", going: 17, lat: 40.401, lon: -3.718, cat: "Deporte" },
];
const PW = PLANS.map((p) => project(p.lat, p.lon));
const PLAN_START = 100;
const PLAN_GAP = 30;
const S = PLANS.map((_, i) => PLAN_START + i * PLAN_GAP);
const CARD_LIFE = 42;

// ---------- Cámara ----------
type Cam = { f: number; x: number; y: number; z: number };
const focus = (w: [number, number], f: number, z: number): Cam => ({ f, x: w[0], y: w[1] - 210 / z, z });
const KF: Cam[] = [
  { f: 0, x: 20, y: -40, z: 0.6 },
  { f: 46, x: 10, y: -90, z: 0.74 },
];
PW.forEach((w, i) => {
  KF.push(focus(w, S[i] - 8, 1.5));
  KF.push(focus(w, S[i] + 10, 1.56));
});
KF.push({ f: 352, x: 40, y: -60, z: 0.44 });
KF.push({ f: 470, x: 40, y: -60, z: 0.47 });
KF.push({ f: DURATION, x: 40, y: -60, z: 0.47 });

function camAt(f: number) {
  let i = 0;
  while (i < KF.length - 2 && f > KF[i + 1].f) i++;
  const a = KF[i], b = KF[i + 1];
  const t = inOut(clamp01((f - a.f) / (b.f - a.f)));
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), t)),
  };
}
const toScreen = (w: [number, number] | number[], cam: { x: number; y: number; z: number }) => [
  CX + (w[0] - cam.x) * cam.z,
  CY + (w[1] - cam.y) * cam.z,
];

// ---------- Fases ----------
const SWITCH_ON = 40; // reloj llega a 19:00
const WAVE_A = 44;
const WAVE_B = 118;
const DOTS_A = 292;
const DOTS_B = 352;
const COMETS_A = 338;
const CONVERGE_A = 440;
const CONVERGE_B = 486;
const DIM_A = 446; // la ciudad se va oscureciendo poco a poco
const DIM_B = 502;
const BLACKOUT = 492; // las luces ya se han fundido
const LOGO_IN = 488; // el logo aparece de forma progresiva
const LOGO_FULL = 516;
const LOGO_Y = 620;
const WORD_A = 506;
const ASK_A = 516;
const BTN_A = 528;
const TAP = 560;

// ---------- Mapa ----------
const MapLayers: React.FC<{ glow?: boolean }> = ({ glow }) => {
  const ns = { vectorEffect: "non-scaling-stroke" as const, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (glow) {
    return (
      <>
        <path d={MAP.major} stroke={C.blueL} strokeWidth={5} opacity={0.55} {...ns} />
        <path d={MAP.m30} stroke={C.cyan} strokeWidth={8} opacity={0.8} {...ns} />
        <path d={MAP.river} stroke={C.cyan} strokeWidth={8} opacity={0.6} {...ns} />
      </>
    );
  }
  return (
    <>
      <path d={MAP.parks} fill="rgba(56,189,248,0.06)" stroke="none" />
      <path d={MAP.minor} stroke="#3B82F6" strokeWidth={0.9} opacity={0.28} {...ns} />
      <path d={MAP.mid} stroke={C.blueL} strokeWidth={1.4} opacity={0.5} {...ns} />
      <path d={MAP.major} stroke={C.sky} strokeWidth={2} opacity={0.75} {...ns} />
      <path d={MAP.river} stroke={C.cyan} strokeWidth={3} opacity={0.7} {...ns} />
      <path d={MAP.m30} stroke={C.cyan} strokeWidth={2.8} opacity={0.95} {...ns} />
    </>
  );
};

const MapSvg: React.FC<{ cam: { x: number; y: number; z: number }; glow?: boolean; style?: React.CSSProperties }> = ({ cam, glow, style }) => (
  <svg width={W} height={H} style={{ position: "absolute", inset: 0, ...style }}>
    <g transform={`translate(${CX} ${CY}) scale(${cam.z}) translate(${-cam.x} ${-cam.y})`}>
      <MapLayers glow={glow} />
    </g>
  </svg>
);

const CityMap: React.FC<{ f: number; cam: { x: number; y: number; z: number } }> = ({ f, cam }) => {
  const [sx, sy] = toScreen([0, 0], cam);
  const R = interpolate(f, [WAVE_A, WAVE_B], [0, 2400], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.3, 0.1, 0.4, 1) });
  const waveOn = f < WAVE_B + 4;
  const mask = waveOn ? `radial-gradient(circle at ${sx}px ${sy}px, #000 ${Math.max(0, R - 220)}px, rgba(0,0,0,0.0) ${R + 120}px)` : undefined;
  if (f >= DIM_B) return null;
  const fadeOut = 1 - prog(f, DIM_A, DIM_B, inOut);
  const flicker = f > WAVE_B ? 0.94 + 0.06 * Math.sin(f * 0.5) * Math.sin(f * 0.13) : 1;
  const ringOpacity = waveOn ? interpolate(R, [0, 200, 1800, 2400], [0, 1, 0.5, 0]) : 0;
  return (
    <AbsoluteFill style={{ opacity: fadeOut }}>
      {f < WAVE_B + 4 && <MapSvg cam={cam} style={{ opacity: 0.13 }} />}
      <AbsoluteFill style={{ WebkitMaskImage: mask, maskImage: mask, opacity: flicker }}>
        <MapSvg cam={cam} glow style={{ filter: "blur(7px)", opacity: 0.85 }} />
        <MapSvg cam={cam} />
      </AbsoluteFill>
      {waveOn && R > 0 && (
        <AbsoluteFill
          style={{
            opacity: ringOpacity,
            background: `radial-gradient(circle at ${sx}px ${sy}px, transparent ${Math.max(0, R - 90)}px, rgba(103,232,249,0.28) ${R - 14}px, rgba(200,245,255,0.7) ${R}px, rgba(103,232,249,0.18) ${R + 16}px, transparent ${R + 60}px)`,
            mixBlendMode: "screen",
          }}
        />
      )}
      {/* destello central al encenderse */}
      <AbsoluteFill
        style={{
          opacity: interpolate(f, [WAVE_A - 2, WAVE_A + 4, WAVE_A + 26], [0, 0.9, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          background: `radial-gradient(circle at ${sx}px ${sy}px, rgba(220,245,255,0.9), rgba(103,232,249,0.35) 180px, transparent 520px)`,
          mixBlendMode: "screen",
        }}
      />
    </AbsoluteFill>
  );
};

// ---------- Luz de un punto ----------
const Glow: React.FC<{ x: number; y: number; size: number; intensity?: number; color?: string }> = ({ x, y, size, intensity = 1, color = C.cyan }) => (
  <>
    <div
      style={{
        position: "absolute", left: x - size * 4, top: y - size * 4, width: size * 8, height: size * 8, borderRadius: "50%",
        background: `radial-gradient(circle, ${color}AA 0%, ${color}33 25%, transparent 65%)`, opacity: intensity, mixBlendMode: "screen",
      }}
    />
    <div
      style={{
        position: "absolute", left: x - size / 2, top: y - size / 2, width: size, height: size, borderRadius: "50%",
        background: "#fff", boxShadow: `0 0 ${size}px ${size / 2}px ${color}`, opacity: intensity,
      }}
    />
  </>
);

// ---------- Tarjeta de plan ----------
const FACES = 14;
const faceFor = (card: number, k: number) => staticFile(`avatars/a${(card * 2 + k * 3) % FACES}.jpg`);
const PlanCard: React.FC<{ plan: Plan; x: number; y: number; f: number; start: number; idx: number; fps: number }> = ({ plan, x, y, f, start, idx, fps }) => {
  const local = f - start;
  if (local < 0 || local > CARD_LIFE + 2) return null;
  const pop = spring({ frame: local, fps, config: { damping: 14, stiffness: 170, mass: 0.8 } });
  const exit = prog(f, start + CARD_LIFE - 10, start + CARD_LIFE, inCubic);
  const scale = lerp(0.15, 1, pop) * lerp(1, 0.2, exit);
  const op = clamp01(local / 4) * (1 - exit);
  const rot = (idx % 2 === 0 ? -1 : 1) * lerp(6, 2.2, pop);
  const going = Math.round(interpolate(local, [4, 26], [Math.max(1, plan.going - 9), plan.going], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: outExpo }));
  const imgZoom = 1.12 - 0.08 * prog(local, 0, CARD_LIFE);
  const CW = 700;
  const stem = 70;
  return (
    <div
      style={{
        position: "absolute", left: x - CW / 2, top: y - stem, width: CW, transformOrigin: "50% 100%",
        transform: `translateY(-100%) scale(${scale}) rotate(${rot}deg)`, opacity: op,
      }}
    >
      <div
        style={{
          background: "#fff", borderRadius: 44, overflow: "hidden",
          boxShadow: "0 40px 90px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.6), 0 0 80px rgba(96,165,250,0.35)",
        }}
      >
        <div style={{ height: 400, overflow: "hidden", position: "relative" }}>
          <Img src={staticFile(`covers/${plan.img}`)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${imgZoom})` }} />
          <div
            style={{
              position: "absolute", left: 24, top: 24, padding: "10px 22px", borderRadius: 999, background: "rgba(11,18,32,0.72)",
              color: "#fff", fontSize: 26, fontWeight: 600, backdropFilter: "blur(8px)",
            }}
          >
            {plan.cat}
          </div>
        </div>
        <div style={{ padding: "28px 34px 32px" }}>
          <div style={{ fontSize: 50, fontWeight: 800, color: C.ink, letterSpacing: -1, lineHeight: 1.08 }}>{plan.title}</div>
          <div style={{ fontSize: 32, color: C.muted, marginTop: 10, fontWeight: 500 }}>
            {plan.place} · Hoy {plan.time}
          </div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 24 }}>
            {[0, 1, 2, 3].map((i) => (
              <Img
                key={i}
                src={faceFor(idx, i)}
                style={{
                  width: 64, height: 64, borderRadius: "50%", marginLeft: i ? -16 : 0, border: "4px solid #fff", objectFit: "cover",
                  transform: `scale(${spring({ frame: local - 3 - i * 2, fps, config: { damping: 12 } })})`,
                }}
              />
            ))}
            <div style={{ marginLeft: 18, fontSize: 33, fontWeight: 700, color: C.blue, fontVariantNumeric: "tabular-nums" }}>
              {going} apuntados
            </div>
          </div>
        </div>
      </div>
      {/* tallo hacia el punto */}
      <div
        style={{
          position: "absolute", left: CW / 2 - 2, bottom: -stem, width: 4, height: stem,
          background: `linear-gradient(to bottom, #fff, ${C.cyan}00)`, borderRadius: 2,
        }}
      />
    </div>
  );
};

// ---------- Texto cinético ----------
type Line = { text: string; accent?: boolean; size?: number };
const Kinetic: React.FC<{ lines: Line[]; f: number; start: number; end: number; top: number }> = ({ lines, f, start, end, top }) => {
  if (f < start - 1 || f > end + 1) return null;
  const out = prog(f, end - 10, end, inCubic);
  let wi = 0;
  return (
    <div
      style={{
        position: "absolute", left: 60, right: 60, top, textAlign: "center",
        opacity: 1 - out, transform: `translateY(${-30 * out}px)`, filter: `blur(${out * 10}px)`,
      }}
    >
      {lines.map((ln, li) => (
        <div key={li} style={{ fontSize: ln.size ?? 96, fontWeight: 800, letterSpacing: -3, lineHeight: 1.04 }}>
          {ln.text.split(" ").map((w, k) => {
            const t = prog(f, start + wi * 3.2, start + wi * 3.2 + 14, outExpo);
            wi++;
            return (
              <span
                key={k}
                style={{
                  display: "inline-block", marginRight: "0.24em", opacity: t, transform: `translateY(${(1 - t) * 50}px)`, filter: `blur(${(1 - t) * 14}px)`,
                  color: ln.accent ? "transparent" : "#fff",
                  backgroundImage: ln.accent ? `linear-gradient(90deg, ${C.sky}, ${C.cyan})` : undefined,
                  WebkitBackgroundClip: ln.accent ? "text" : undefined,
                  backgroundClip: ln.accent ? "text" : undefined,
                  textShadow: ln.accent ? undefined : "0 4px 40px rgba(0,0,0,0.6)",
                }}
              >
                {w}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

// ---------- Reloj de apertura ----------
const TICKS: [number, string][] = [
  [0, "18:57"],
  [13, "18:58"],
  [26, "18:59"],
  [SWITCH_ON, "19:00"],
];
const Clock: React.FC<{ f: number }> = ({ f }) => {
  if (f > 112) return null;
  let cur = 0;
  while (cur < TICKS.length - 1 && f >= TICKS[cur + 1][0]) cur++;
  const prev = cur > 0 ? TICKS[cur - 1][1] : TICKS[0][1];
  const now = TICKS[cur][1];
  const tickT = prog(f, TICKS[cur][0], TICKS[cur][0] + 7, outExpo);
  const lit = prog(f, SWITCH_ON, SWITCH_ON + 6);
  const pulse = 1 + 0.07 * Math.sin(Math.PI * prog(f, SWITCH_ON, SWITCH_ON + 10));
  const leave = prog(f, 72, 108, inOut);
  const intro = prog(f, 0, 12, outExpo);
  const color = lit > 0 ? C.cyan : "#fff";
  return (
    <div
      style={{
        position: "absolute", left: 0, right: 0, top: 690, textAlign: "center",
        opacity: intro * (1 - leave), transform: `translateY(${lerp(0, -260, leave)}px) scale(${pulse * lerp(1, 0.7, leave)})`,
        filter: `blur(${leave * 12}px)`,
      }}
    >
      <div style={{ fontSize: 40, fontWeight: 600, letterSpacing: 14, color: "rgba(255,255,255,0.75)", marginBottom: 6 }}>MADRID · VIERNES</div>
      <div
        style={{
          display: "flex", justifyContent: "center", fontSize: 270, fontWeight: 700, letterSpacing: -8, lineHeight: 1,
          fontVariantNumeric: "tabular-nums", color, textShadow: "none",
        }}
      >
        {now.split("").map((ch, i) => {
          const changed = ch !== prev[i] && cur > 0;
          if (!changed) return <span key={i}>{ch}</span>;
          return (
            <span key={i} style={{ position: "relative", display: "inline-block", overflow: "hidden", height: 290 }}>
              <span style={{ display: "inline-block", transform: `translateY(${(1 - tickT) * 100}%)`, opacity: tickT }}>{ch}</span>
              <span style={{ position: "absolute", left: 0, top: 0, transform: `translateY(${-tickT * 100}%)`, opacity: 1 - tickT }}>{prev[i]}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
};

// ---------- Puntos secundarios + cometas ----------
const SORTED = [...(DOTS as number[][])]
  .map((d) => ({ d, r: Math.hypot(d[0], d[1]) }))
  .sort((a, b) => a.r - b.r)
  .map((o) => o.d);
const DOT_PHASE = SORTED.map(() => rand() * Math.PI * 2);
const COMETS = Array.from({ length: 46 }, (_, k) => {
  let a = 0, b = 0, dist = 0, tries = 0;
  do {
    a = Math.floor(rand() * SORTED.length);
    b = Math.floor(rand() * SORTED.length);
    dist = Math.hypot(SORTED[a][0] - SORTED[b][0], SORTED[a][1] - SORTED[b][1]);
    tries++;
  } while ((dist < 350 || dist > 1100) && tries < 50);
  return { a, b, start: COMETS_A + k * 2.2, bend: (rand() - 0.5) * 0.7, dur: 30 + rand() * 12 };
});
const CONV = { x: CX, y: LOGO_Y };

const CityLights: React.FC<{ f: number; cam: { x: number; y: number; z: number } }> = ({ f, cam }) => {
  if (f < S[0] || f >= BLACKOUT) return null;
  const items: React.ReactNode[] = [];
  const conv = (i: number) => prog(f, CONVERGE_A + (i % 24) * 0.8, CONVERGE_A + (i % 24) * 0.8 + 28, inOut);

  // puntos de los planes destacados
  PW.forEach((w, i) => {
    if (f < S[i]) return;
    const [x0, y0] = toScreen(w, cam);
    const c = conv(i * 7);
    const x = lerp(x0, CONV.x, c), y = lerp(y0, CONV.y, c);
    const local = f - S[i];
    const ring = prog(local, 0, 22, outExpo);
    if (c >= 1) return;
    items.push(
      <React.Fragment key={`p${i}`}>
        {local < 24 && (
          <div
            style={{
              position: "absolute", left: x - 160 * ring, top: y - 160 * ring, width: 320 * ring, height: 320 * ring, borderRadius: "50%",
              border: `3px solid ${C.cyan}`, opacity: 1 - ring, boxShadow: `0 0 30px ${C.cyan}`,
            }}
          />
        )}
        <Glow x={x} y={y} size={lerp(20, 12, prog(local, 0, 20))} intensity={(1 - c) * clamp01(local / 3)} />
      </React.Fragment>,
    );
  });

  // cientos de luces
  if (f >= DOTS_A) {
    SORTED.forEach((d, i) => {
      const t0 = DOTS_A + (i / SORTED.length) * (DOTS_B - DOTS_A);
      if (f < t0) return;
      const c = conv(i);
      if (c >= 1) return;
      const [x0, y0] = toScreen(d, cam);
      const x = lerp(x0, CONV.x, c), y = lerp(y0, CONV.y, c);
      const app = prog(f, t0, t0 + 8, outExpo);
      const tw = 0.65 + 0.35 * Math.sin(f * 0.18 + DOT_PHASE[i]);
      const size = (i % 9 === 0 ? 11 : 7) * (1 + (1 - app) * 1.6);
      items.push(<Glow key={`d${i}`} x={x} y={y} size={size} intensity={app * tw * (1 - c * c)} color={i % 5 === 0 ? C.sky : C.cyan} />);
    });
  }
  return <AbsoluteFill>{items}</AbsoluteFill>;
};

const Comets: React.FC<{ f: number; cam: { x: number; y: number; z: number } }> = ({ f, cam }) => {
  if (f < COMETS_A || f > CONVERGE_B) return null;
  const fade = 1 - prog(f, CONVERGE_A, CONVERGE_A + 24);
  return (
    <svg width={W} height={H} style={{ position: "absolute", inset: 0, opacity: fade }}>
      <defs>
        <filter id="cglow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {COMETS.map((c, k) => {
        if (f < c.start) return null;
        const [ax, ay] = toScreen(SORTED[c.a], cam);
        const [bx, by] = toScreen(SORTED[c.b], cam);
        const mx = (ax + bx) / 2 - (by - ay) * c.bend;
        const my = (ay + by) / 2 + (bx - ax) * c.bend;
        const d = `M${ax} ${ay}Q${mx} ${my} ${bx} ${by}`;
        const t = prog(f, c.start, c.start + c.dur, inOut);
        const head = t;
        const trailLen = 0.32;
        return (
          <g key={k}>
            <path d={d} pathLength={1} fill="none" stroke={C.blueL} strokeWidth={2} opacity={0.35}
              strokeDasharray={`${head} 2`} />
            <path d={d} pathLength={1} fill="none" stroke="#E0F7FF" strokeWidth={4.5} strokeLinecap="round" filter="url(#cglow)"
              strokeDasharray={`${Math.min(trailLen, head)} 2`} strokeDashoffset={-(head - Math.min(trailLen, head))}
              opacity={t >= 1 ? 0 : 1} />
          </g>
        );
      })}
    </svg>
  );
};

// ---------- Logo y cierre ----------
// Las luces se funden hacia el centro mientras la ciudad se oscurece despacio hasta un azul noche
// (no negro). El logo aparece de forma progresiva: fundido, enfoque y un leve acercamiento.
const LOGO_BOX = 440;
const NightTone: React.FC<{ f: number }> = ({ f }) => (
  <AbsoluteFill
    style={{
      background: "linear-gradient(180deg, #0C1730 0%, #08112A 45%, #050A18 100%)",
      opacity: prog(f, DIM_A, DIM_B + 10, inOut),
    }}
  />
);
const LogoForm: React.FC<{ f: number }> = ({ f }) => {
  const items: React.ReactNode[] = [];
  if (f >= CONVERGE_A + 10 && f < DIM_B) {
    const core = Math.sin(Math.PI * prog(f, CONVERGE_A + 10, DIM_B, inOut)) * 0.45;
    items.push(
      <div key="core" style={{
        position: "absolute", left: CONV.x - 260, top: CONV.y - 260, width: 520, height: 520, borderRadius: "50%",
        background: `radial-gradient(circle, rgba(220,245,255,${core}) 0%, rgba(103,232,249,${0.35 * core}) 18%, transparent 62%)`,
        mixBlendMode: "screen",
      }} />,
    );
  }
  if (f >= LOGO_IN) {
    const t = prog(f, LOGO_IN, LOGO_FULL, inOut);
    const sc = lerp(0.9, 1, prog(f, LOGO_IN, LOGO_FULL + 10, outExpo));
    const shine = prog(f, LOGO_FULL - 6, LOGO_FULL + 22, inOut);
    const box: React.CSSProperties = {
      position: "absolute", left: CX - LOGO_BOX / 2, top: LOGO_Y - LOGO_BOX / 2, width: LOGO_BOX, height: LOGO_BOX, transform: `scale(${sc})`,
    };
    const logoUrl = staticFile("logo-clean.png");
    items.push(
      <React.Fragment key="logo">
        <Img src={logoUrl} style={{ ...box, opacity: t, filter: `blur(${(1 - t) * 14}px)` }} />
        {shine > 0 && shine < 1 && (
          <div style={{
            ...box,
            WebkitMaskImage: `url(${logoUrl})`, maskImage: `url(${logoUrl})`,
            WebkitMaskSize: "100% 100%", maskSize: "100% 100%",
            background: `linear-gradient(115deg, transparent ${lerp(-40, 100, shine)}%, rgba(255,255,255,0.45) ${lerp(-30, 110, shine)}%, transparent ${lerp(-20, 120, shine)}%)`,
            mixBlendMode: "screen",
          }} />
        )}
      </React.Fragment>,
    );
  }
  return <AbsoluteFill>{items}</AbsoluteFill>;
};

const Particles: React.FC<{ f: number; x: number; y: number }> = ({ f, x, y }) => {
  if (f < TAP + 2) return null;
  const t = f - TAP - 2;
  return (
    <>
      {Array.from({ length: 28 }, (_, i) => {
        const ang = (i / 28) * Math.PI * 2 + (i % 2) * 0.1;
        const sp = 260 + (i * 53) % 220;
        const p = Easing.out(Easing.cubic)(clamp01(t / 34));
        const px = x + Math.cos(ang) * sp * p * 1.3;
        const py = y + Math.sin(ang) * sp * p * 0.8;
        const size = (i % 3 === 0 ? 14 : 9) * (1 - p * 0.6);
        return (
          <div key={i} style={{
            position: "absolute", left: px - size / 2, top: py - size / 2, width: size, height: size, borderRadius: "50%",
            background: i % 3 ? C.cyan : "#fff", boxShadow: `0 0 16px ${C.cyan}`, opacity: 1 - clamp01((t - 12) / 26),
          }} />
        );
      })}
    </>
  );
};

const Outro: React.FC<{ f: number; fps: number }> = ({ f, fps }) => {
  if (f < WORD_A) return null;
  const word = prog(f, WORD_A, WORD_A + 18, outExpo);
  const btn = spring({ frame: f - BTN_A, fps, config: { damping: 12, stiffness: 140 } });
  const fingerIn = prog(f, TAP - 18, TAP - 2, outExpo);
  const press = interpolate(f, [TAP - 2, TAP + 2, TAP + 8], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const done = prog(f, TAP + 2, TAP + 12, outExpo);
  const fingerOut = prog(f, TAP + 8, TAP + 22, inOut);
  const BY = 1230;
  const ripple = prog(f, TAP, TAP + 22, outExpo);
  const check = prog(f, TAP + 6, TAP + 18, outExpo);
  return (
    <AbsoluteFill>
      <div style={{
        position: "absolute", left: 0, right: 0, top: 820, textAlign: "center", fontSize: 110, fontWeight: 800, letterSpacing: -4, color: "#fff",
        opacity: word, transform: `translateY(${(1 - word) * 40}px)`, filter: `blur(${(1 - word) * 12}px)`,
      }}>
        Nexo
      </div>
      <Kinetic lines={[{ text: "¿Te apuntas?", size: 92 }]} f={f} start={ASK_A} end={DURATION + 20} top={1000} />
      <div style={{ position: "absolute", left: CX - 300, top: BY - 72, width: 600, height: 144, transform: `scale(${btn * (1 - 0.07 * press)})`, opacity: clamp01((f - BTN_A) / 4) }}>
        {/* onda del toque */}
        <div style={{
          position: "absolute", left: 300 - 400 * ripple, top: 72 - 400 * ripple, width: 800 * ripple, height: 800 * ripple, borderRadius: "50%",
          border: `4px solid ${C.cyan}`, opacity: f >= TAP ? 1 - ripple : 0,
        }} />
        <div style={{
          position: "absolute", inset: 0, borderRadius: 72,
          background: `linear-gradient(180deg, #3B82F6, ${C.blue})`,
          boxShadow: `0 24px 70px rgba(37,99,235,0.65), inset 0 2px 0 rgba(255,255,255,0.35)`,
          display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
        }}>
          <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: done }} />
          <div style={{ position: "relative", fontSize: 54, fontWeight: 700, color: "#fff", opacity: 1 - done, transform: `translateY(${-done * 30}px)` }}>Me apunto</div>
          <div style={{ position: "absolute", display: "flex", alignItems: "center", gap: 18, fontSize: 54, fontWeight: 700, color: C.blue, opacity: done, transform: `translateY(${(1 - done) * 30}px)` }}>
            <svg width={52} height={52} viewBox="0 0 52 52">
              <circle cx={26} cy={26} r={26} fill={C.blue} />
              <path d="M14 27 L23 35 L38 18" fill="none" stroke="#fff" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={`${check} 2`} />
            </svg>
            Apuntado
          </div>
        </div>
      </div>
      {/* dedo (indicador de toque) */}
      <div style={{
        position: "absolute", left: lerp(CX + 360, CX + 70, fingerIn) - 55, top: lerp(BY + 420, BY + 6, fingerIn) - 55,
        width: 110, height: 110, borderRadius: "50%", background: "rgba(255,255,255,0.55)", border: "3px solid rgba(255,255,255,0.9)",
        boxShadow: "0 10px 40px rgba(0,0,0,0.35)", transform: `scale(${1 - 0.18 * press})`, opacity: fingerIn * (1 - fingerOut),
      }} />
      <Particles f={f} x={CX} y={BY} />
    </AbsoluteFill>
  );
};

// ---------- Composición ----------
export const MadridSeEnciende: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cam = camAt(f);
  const scrim = prog(f, 300, 324) * (1 - prog(f, CONVERGE_A, CONVERGE_A + 20));

  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 45%, ${C.bg1}, ${C.bg0} 70%)`, fontFamily, overflow: "hidden" }}>
      <NightTone f={f} />
      <CityMap f={f} cam={cam} />
      <Comets f={f} cam={cam} />
      <CityLights f={f} cam={cam} />

      {/* oscurecido superior para legibilidad del texto */}
      <AbsoluteFill style={{ background: "linear-gradient(to bottom, rgba(3,5,11,0.85) 0%, rgba(3,5,11,0.4) 30%, transparent 45%)", opacity: scrim }} />

      {PLANS.map((p, i) => {
        const [x, y] = toScreen(PW[i], cam);
        return <PlanCard key={i} plan={p} x={x} y={y} f={f} start={S[i]} idx={i} fps={fps} />;
      })}

      <Clock f={f} />
      <Kinetic lines={[{ text: "Cada noche," }, { text: "cientos de planes", accent: true }]} f={f} start={316} end={392} top={300} />
      <Kinetic lines={[{ text: "y gente con ganas" }, { text: "de conocerte", accent: true }]} f={f} start={392} end={452} top={300} />

      <LogoForm f={f} />
      <Outro f={f} fps={fps} />

      {/* viñeta */}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,0.55) 100%)", pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};
