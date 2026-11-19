// Convierte los datos OSM descargados (data/q*.json) en paths SVG compactos.
// Sistema de coordenadas: origen en la Puerta del Sol, 1 km = 300 unidades, y hacia abajo.
import fs from "node:fs";

const ORIGIN = { lat: 40.4169, lon: -3.7035 };
const KM = 300;
const LAT_KM = 111.32;
const LON_KM = 111.32 * Math.cos((ORIGIN.lat * Math.PI) / 180);

export const project = (lat, lon) => [
  (lon - ORIGIN.lon) * LON_KM * KM,
  -(lat - ORIGIN.lat) * LAT_KM * KM,
];

const load = (f) => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url)));

function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const r = (n) => Math.round(n * 2) / 2;
const toPath = (pts, close = false) =>
  "M" + pts.map(([x, y]) => `${r(x)} ${r(y)}`).join("L") + (close ? "Z" : "");

function wayPts(geom, tol) {
  return simplify(geom.map((g) => project(g.lat, g.lon)), tol);
}

const q1 = load("q1.json"), q2 = load("q2.json"), q3 = load("q3.json"), q4 = load("q4.json");
const MAJOR_RE = /^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link)$/;
const extraMajor = q4.elements.filter((e) => MAJOR_RE.test(e.tags?.highway || ""));
const extraMinor = q4.elements.filter((e) => e.tags?.highway && !MAJOR_RE.test(e.tags.highway));
const extraRiver = q4.elements.filter((e) => e.tags?.waterway === "river");

const m30 = [], major = [], mid = [];
for (const el of [...q1.elements, ...extraMajor]) {
  if (el.type !== "way" || !el.geometry) continue;
  const t = el.tags || {};
  const pts = wayPts(el.geometry, 1.2);
  if (pts.length < 2) continue;
  const p = toPath(pts);
  if ((t.ref || "").includes("M-30")) m30.push(p);
  else if (/^(motorway|trunk|primary)/.test(t.highway)) major.push(p);
  else mid.push(p);
}

const minor = [];
for (const el of [...q2.elements, ...extraMinor]) {
  if (el.type !== "way" || !el.geometry) continue;
  const pts = wayPts(el.geometry, 1.5);
  if (pts.length < 2) continue;
  const [x0, y0] = pts[0], [x1, y1] = pts[pts.length - 1];
  if (pts.length === 2 && Math.hypot(x1 - x0, y1 - y0) < 6) continue;
  minor.push(toPath(pts));
}

const river = [], parks = [];
for (const el of [...q3.elements, ...extraRiver]) {
  const t = el.tags || {};
  if (el.type === "way" && t.waterway === "river" && el.geometry) {
    river.push(toPath(wayPts(el.geometry, 1)));
  } else if (t.leisure === "park") {
    const rings = el.type === "way" ? [el.geometry] : (el.members || []).filter((m) => m.role === "outer" && m.geometry).map((m) => m.geometry);
    for (const g of rings) {
      if (!g || g.length < 4) continue;
      const pts = wayPts(g, 2);
      // descarta parques diminutos
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
        a += x0 * y1 - x1 * y0;
      }
      if (Math.abs(a) / 2 < 4000) continue;
      parks.push(toPath(pts, true));
    }
  }
}

const join = (arr) => arr.join("");
const out = {
  m30: join(m30),
  major: join(major),
  mid: join(mid),
  minor: join(minor),
  river: join(river),
  parks: join(parks),
};
fs.writeFileSync(new URL("../src/map-data.json", import.meta.url), JSON.stringify(out));
for (const [k, v] of Object.entries(out)) console.log(k, (v.length / 1024).toFixed(0) + "KB");

// Puntos de luz secundarios: vértices aleatorios de calles (semilla fija) para la fase "cientos de planes".
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const verts = [];
for (const el of [...q1.elements, ...q2.elements]) {
  if (!el.geometry) continue;
  for (const g of el.geometry) verts.push(project(g.lat, g.lon));
}
const dots = [];
while (dots.length < 220) {
  const v = verts[Math.floor(rnd() * verts.length)];
  const d = Math.hypot(v[0], v[1] * 0.85);
  if (d > 1250 || d < 60) continue;
  if (dots.some((o) => Math.hypot(o[0] - v[0], o[1] - v[1]) < 45)) continue;
  dots.push([Math.round(v[0]), Math.round(v[1])]);
}
fs.writeFileSync(new URL("../src/dots.json", import.meta.url), JSON.stringify(dots));
console.log("dots", dots.length);
