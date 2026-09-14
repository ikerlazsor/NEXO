import sharp from 'sharp';

const SRC = 'assets/images/icon.png';
const DEST_FG = 'assets/images/android-icon-foreground.png';
const DEST_BG = 'assets/images/android-icon-background.png';
const PREVIEW = 'assets/images/android-icon-preview-circle.png';
const CANVAS = 1024;
const LOGO_FRAC = 0.42;

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h } = info;
const px = Buffer.from(data);
const idx = (x, y) => (y * w + x) * 4;
const nearBg = (i, br, bg, bb, th = 40) => {
  const dr = Math.abs(px[i] - br);
  const dg = Math.abs(px[i + 1] - bg);
  const db = Math.abs(px[i + 2] - bb);
  return dr < th && dg < th && db < th && px[i + 3] > 8;
};

const samples = [idx(2, 2), idx(w - 3, 2), idx(2, h - 3), idx(w - 3, h - 3)];
let br = 0;
let bg = 0;
let bb = 0;
for (const i of samples) {
  br += px[i];
  bg += px[i + 1];
  bb += px[i + 2];
}
br = Math.round(br / 4);
bg = Math.round(bg / 4);
bb = Math.round(bb / 4);

const visited = new Uint8Array(w * h);
const stack = [];
const push = (x, y) => {
  if (x >= 0 && y >= 0 && x < w && y < h) stack.push(x, y);
};
for (let x = 0; x < w; x++) {
  push(x, 0);
  push(x, h - 1);
}
for (let y = 0; y < h; y++) {
  push(0, y);
  push(w - 1, y);
}
while (stack.length) {
  const y = stack.pop();
  const x = stack.pop();
  const p = y * w + x;
  if (visited[p]) continue;
  visited[p] = 1;
  const i = p * 4;
  if (!nearBg(i, br, bg, bb, 42)) continue;
  px[i + 3] = 0;
  push(x + 1, y);
  push(x - 1, y);
  push(x, y + 1);
  push(x, y - 1);
}

for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = idx(x, y);
    if (px[i + 3] && nearBg(i, br, bg, bb, 24)) {
      let t = 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [2, 0],
        [-2, 0],
        [0, 2],
        [0, -2],
      ]) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        if (px[idx(xx, yy) + 3] < 10) t++;
      }
      if (t >= 3) px[i + 3] = 0;
    }
  }
}

let minX = w;
let minY = h;
let maxX = 0;
let maxY = 0;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    if (px[idx(x, y) + 3] > 12) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
}

const bw = maxX - minX + 1;
const bh = maxY - minY + 1;
const cropped = Buffer.alloc(bw * bh * 4);
for (let y = 0; y < bh; y++) {
  for (let x = 0; x < bw; x++) {
    const si = idx(minX + x, minY + y);
    const di = (y * bw + x) * 4;
    cropped[di] = px[si];
    cropped[di + 1] = px[si + 1];
    cropped[di + 2] = px[si + 2];
    cropped[di + 3] = px[si + 3];
  }
}

const target = Math.round(CANVAS * LOGO_FRAC);
const scale = Math.min(target / bw, target / bh);
const dw = Math.round(bw * scale);
const dh = Math.round(bh * scale);
const left = Math.round((CANVAS - dw) / 2);
const top = Math.round((CANVAS - dh) / 2);
console.log({ bw, bh, dw, dh, left, top, padPct: +((left / CANVAS) * 100).toFixed(1) });

const logoPng = await sharp(cropped, { raw: { width: bw, height: bh, channels: 4 } })
  .resize(dw, dh, { fit: 'fill', kernel: 'lanczos3' })
  .png()
  .toBuffer();

await sharp({
  create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([{ input: logoPng, left, top }])
  .png()
  .toFile(DEST_FG);

await sharp({
  create: { width: CANVAS, height: CANVAS, channels: 3, background: { r: 0xe2, g: 0xeb, b: 0xf2 } },
})
  .png()
  .toFile(DEST_BG);

const fgBuf = await sharp(DEST_FG).png().toBuffer();
const composed = await sharp({
  create: {
    width: CANVAS,
    height: CANVAS,
    channels: 4,
    background: { r: 0xe2, g: 0xeb, b: 0xf2, alpha: 1 },
  },
})
  .composite([{ input: fgBuf, left: 0, top: 0 }])
  .png()
  .toBuffer();

const r = CANVAS / 2;
const svg = Buffer.from(
  `<svg width="${CANVAS}" height="${CANVAS}"><circle cx="${r}" cy="${r}" r="${r}" fill="white"/></svg>`,
);
await sharp(composed)
  .composite([{ input: svg, blend: 'dest-in' }])
  .png()
  .toFile(PREVIEW);

console.log('ok', DEST_FG, DEST_BG, PREVIEW);
