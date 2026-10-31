// Draws the app's icon (a white K on a rounded blue square) and writes it as
// icon.png, tray.png and icon.ico, with nothing but Node itself.
//
//   node assets/make-icon.mjs

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));

const BLUE = [22, 119, 255];
const WHITE = [255, 255, 255];
// Each pixel is the average of this many samples a side, which smooths the edges.
const SAMPLES = 4;

// The strokes of the K, in a square that runs from 0 to 1: [x1, y1, x2, y2].
const STROKES = [
  [0.34, 0.26, 0.34, 0.74],
  [0.36, 0.52, 0.66, 0.26],
  [0.44, 0.45, 0.67, 0.74],
];
const STROKE_HALF_WIDTH = 0.058;
const CORNER = 0.22;

function distanceToStroke(x, y, [x1, y1, x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const along = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + along * dx), y - (y1 + along * dy));
}

function insideSquare(x, y) {
  // The distance from the nearest corner's centre decides the rounded parts.
  const cx = Math.min(Math.max(x, CORNER), 1 - CORNER);
  const cy = Math.min(Math.max(y, CORNER), 1 - CORNER);
  return Math.hypot(x - cx, y - cy) <= CORNER;
}

function pixels(size) {
  const data = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let covered = 0;
      let letter = 0;

      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = (px + (sx + 0.5) / SAMPLES) / size;
          const y = (py + (sy + 0.5) / SAMPLES) / size;
          if (!insideSquare(x, y)) continue;

          covered += 1;
          if (STROKES.some((stroke) => distanceToStroke(x, y, stroke) <= STROKE_HALF_WIDTH)) letter += 1;
        }
      }

      const offset = (py * size + px) * 4;
      const white = covered ? letter / covered : 0;
      for (let channel = 0; channel < 3; channel += 1) {
        data[offset + channel] = Math.round(BLUE[channel] * (1 - white) + WHITE[channel] * white);
      }
      data[offset + 3] = Math.round((covered / (SAMPLES * SAMPLES)) * 255);
    }
  }
  return data;
}

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

function png(size) {
  const rgba = pixels(size);
  // Every row starts with the byte that says it is stored as it is.
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits a channel, RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// An .ico is a small directory followed by the images, which may be PNGs.
function ico(sizes) {
  const images = sizes.map((size) => ({ size, data: png(size) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size === 256 ? 0 : size;
    entry[1] = size === 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map(({ data }) => data)]);
}

writeFileSync(path.join(here, 'icon.png'), png(256));
writeFileSync(path.join(here, 'tray.png'), png(32));
writeFileSync(path.join(here, 'icon.ico'), ico([16, 24, 32, 48, 64, 256]));
console.log('icon.png, tray.png and icon.ico written');
