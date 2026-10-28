// Generates royalty-free demo assets for RiffOff:
//   - public/audio/*.wav  : original synthesized guitar riffs (Karplus-Strong + overdrive)
//   - public/icons/*.png  : PWA / home-screen icons
// No dependencies; run with `npm run generate:samples`.

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SR = 44100;

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);

// Deterministic PRNG so the generated files are identical on every run.
let seed = 1234567;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

/** Plucked string via Karplus-Strong. Returns Float32Array of `seconds`. */
function pluck(freq, seconds, { decay = 0.996, bright = 0.5 } = {}) {
  const n = Math.floor(seconds * SR);
  const out = new Float32Array(n);
  const period = Math.max(2, Math.round(SR / freq));
  const buf = new Float32Array(period);
  for (let i = 0; i < period; i++) buf[i] = rand() * 2 - 1;
  // Soften the initial noise burst a little (pick position / brightness).
  for (let i = 1; i < period; i++) buf[i] = bright * buf[i] + (1 - bright) * buf[i - 1];
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const next = (idx + 1) % period;
    const v = buf[idx];
    out[i] = v;
    buf[idx] = 0.5 * (v + buf[next]) * decay;
    idx = next;
  }
  return out;
}

/**
 * Render a riff. Each event: { n: midi | midi[] | null, b: beats, mute?: bool, power?: bool }
 * `power: true` turns a single root into a power chord (root, fifth, octave).
 */
function renderRiff({ bpm, events, drive = 6, repeats = 2, tail = 1.2 }) {
  const beat = 60 / bpm;
  const seq = [];
  for (let r = 0; r < repeats; r++) seq.push(...events);
  const total = seq.reduce((s, e) => s + e.b * beat, 0) + tail;
  const mix = new Float32Array(Math.ceil(total * SR));

  let t = 0;
  seq.forEach((e, i) => {
    const dur = e.b * beat;
    if (e.n !== null) {
      const roots = Array.isArray(e.n) ? e.n : [e.n];
      const notes = e.power ? roots.flatMap((m) => [m, m + 7, m + 12]) : roots;
      const isLast = i === seq.length - 1;
      const len = isLast ? dur + tail : dur + 0.02;
      const decay = e.mute ? 0.97 : 0.997;
      const start = Math.floor(t * SR);
      notes.forEach((m, k) => {
        // Slight strum offset between strings.
        const offset = Math.floor(k * 0.006 * SR);
        const s = pluck(midiToHz(m), len, { decay, bright: e.mute ? 0.3 : 0.6 });
        const fade = Math.floor(0.015 * SR);
        for (let j = 0; j < s.length; j++) {
          const p = start + offset + j;
          if (p >= mix.length) break;
          const env = j > s.length - fade ? (s.length - j) / fade : 1;
          mix[p] += (s[j] * env) / notes.length;
        }
      });
    }
    t += dur;
  });

  // Overdrive + simple one-pole "cabinet" low-pass.
  const norm = Math.tanh(drive);
  let lp = 0;
  let peak = 0;
  for (let i = 0; i < mix.length; i++) {
    const d = Math.tanh(mix[i] * drive * 1.5) / norm;
    lp += 0.35 * (d - lp);
    mix[i] = lp;
    peak = Math.max(peak, Math.abs(lp));
  }
  const gain = 0.85 / (peak || 1);
  for (let i = 0; i < mix.length; i++) mix[i] *= gain;
  return mix;
}

function encodeWav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// MIDI reference: E2 = 40, A2 = 45, D3 = 50, E3 = 52, A3 = 57, E4 = 64, A4 = 69
const riffs = {
  'neon-highway': {
    bpm: 132,
    events: [
      { n: 40, b: 0.5, mute: true }, { n: 40, b: 0.5, mute: true }, { n: 43, b: 0.5, power: true },
      { n: 40, b: 0.5, mute: true }, { n: 45, b: 0.5, power: true }, { n: 40, b: 0.5, mute: true },
      { n: 47, b: 0.5, power: true }, { n: 45, b: 0.5, power: true },
      { n: 40, b: 0.5, mute: true }, { n: 40, b: 0.5, mute: true }, { n: 43, b: 0.5, power: true },
      { n: 40, b: 0.5, mute: true }, { n: 38, b: 1, power: true }, { n: 40, b: 1, power: true },
    ],
  },
  'midnight-static': {
    bpm: 96,
    drive: 4,
    events: [
      { n: 69, b: 0.5 }, { n: 72, b: 0.5 }, { n: 74, b: 0.5 }, { n: 76, b: 1 },
      { n: 74, b: 0.5 }, { n: 72, b: 0.5 }, { n: 69, b: 1 },
      { n: 67, b: 0.5 }, { n: 69, b: 0.5 }, { n: 72, b: 0.5 }, { n: 69, b: 0.5 },
      { n: 67, b: 0.5 }, { n: 64, b: 1.5 },
      { n: 69, b: 0.25 }, { n: 72, b: 0.25 }, { n: 76, b: 0.25 }, { n: 81, b: 0.25 },
      { n: 79, b: 0.5 }, { n: 76, b: 0.5 }, { n: 74, b: 0.5 }, { n: 76, b: 1.5 },
    ],
  },
  'thunder-pick': {
    bpm: 150,
    drive: 8,
    events: [
      { n: 38, b: 0.5, power: true }, { n: 38, b: 0.25, mute: true }, { n: 38, b: 0.25, mute: true },
      { n: 41, b: 0.5, power: true }, { n: 38, b: 0.5, mute: true },
      { n: 43, b: 0.75, power: true }, { n: 41, b: 0.75, power: true }, { n: 38, b: 0.5, power: true },
      { n: 38, b: 0.5, power: true }, { n: 38, b: 0.25, mute: true }, { n: 38, b: 0.25, mute: true },
      { n: 36, b: 0.5, power: true }, { n: 38, b: 0.5, mute: true },
      { n: 45, b: 1, power: true }, { n: 43, b: 1, power: true },
    ],
  },
  'velvet-overdrive': {
    bpm: 78,
    drive: 3,
    events: [
      { n: [45, 52, 57, 61], b: 1 }, { n: null, b: 0.5 }, { n: 64, b: 0.25 }, { n: 67, b: 0.25 },
      { n: 69, b: 0.5 }, { n: 67, b: 0.25 }, { n: 64, b: 0.25 }, { n: 62, b: 1 },
      { n: [50, 57, 62, 66], b: 1 }, { n: null, b: 0.5 }, { n: 62, b: 0.25 }, { n: 64, b: 0.25 },
      { n: 66, b: 0.5 }, { n: 64, b: 0.5 }, { n: 57, b: 1.5 },
    ],
  },
  'pocket-rocket': {
    bpm: 170,
    drive: 7,
    events: [
      { n: 52, b: 0.5 }, { n: 55, b: 0.5 }, { n: 57, b: 0.5 }, { n: 52, b: 0.5 },
      { n: 58, b: 0.5 }, { n: 57, b: 0.5 }, { n: 55, b: 0.5 }, { n: 52, b: 0.5 },
      { n: 52, b: 0.5 }, { n: 55, b: 0.5 }, { n: 57, b: 0.5 }, { n: 60, b: 0.5 },
      { n: 59, b: 0.5 }, { n: 57, b: 0.5 }, { n: 55, b: 1 },
      { n: 40, b: 1, power: true }, { n: 43, b: 1, power: true }, { n: 45, b: 2, power: true },
    ],
    repeats: 2,
  },
};

mkdirSync(join(root, 'public/audio'), { recursive: true });
for (const [name, riff] of Object.entries(riffs)) {
  const wav = encodeWav(renderRiff(riff));
  writeFileSync(join(root, 'public/audio', `${name}.wav`), wav);
  console.log(`audio/${name}.wav  ${(wav.length / 1024).toFixed(0)} KB`);
}

// ---------------------------------------------------------------------------
// Icons (guitar pick with a lightning bolt)
// ---------------------------------------------------------------------------

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function encodePng(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const inPoly = (px, py, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const segDist = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
// Rounded triangle = points within `round` of an inner triangle.
const tri = [[0.3, 0.3], [0.7, 0.3], [0.5, 0.7]];
const inPick = (x, y) =>
  inPoly(x, y, tri) || tri.some((p, i) => segDist(x, y, p, tri[(i + 1) % 3]) < 0.13);
const bolt = [[0.53, 0.25], [0.4, 0.5], [0.49, 0.5], [0.44, 0.7], [0.6, 0.43], [0.51, 0.43], [0.57, 0.25]];

const bg = [13, 13, 18];
const orange = [255, 106, 0];
const yellow = [255, 196, 0];

function iconPixel(size) {
  const ss = 4;
  return (x, y) => {
    let acc = [0, 0, 0];
    for (let sy = 0; sy < ss; sy++) {
      for (let sx = 0; sx < ss; sx++) {
        const u = (x + (sx + 0.5) / ss) / size;
        const v = (y + (sy + 0.5) / ss) / size;
        let c = bg;
        if (inPick(u, v)) {
          const t = Math.min(1, Math.max(0, (v - 0.2) / 0.6));
          c = orange.map((o, i) => o + (yellow[i] - o) * (1 - t) * 0.6);
          if (inPoly(u, v, bolt)) c = bg;
        }
        acc = acc.map((a, i) => a + c[i]);
      }
    }
    return acc.map((a) => Math.round(a / (ss * ss)));
  };
}

mkdirSync(join(root, 'public/icons'), { recursive: true });
for (const size of [180, 192, 512]) {
  const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
  writeFileSync(join(root, 'public/icons', name), encodePng(size, iconPixel(size)));
  console.log(`icons/${name}`);
}
