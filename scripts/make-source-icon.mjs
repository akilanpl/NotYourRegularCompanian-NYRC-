// Generates icons/source.png — an original 512x512 NYRC device mark — using only Node built-ins.
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "../src-tauri/icons");
mkdirSync(outDir, { recursive: true });
const outFile = resolve(outDir, "source.png");

const W = 512;
const H = 512;

// CRC table per PNG spec
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcVal = Buffer.alloc(4);
  crcVal.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcVal]);
}

// Build pixel data — round nyrc shape with face.
const stride = W * 4;
const raw = Buffer.alloc(H * (stride + 1));

function setPixel(x, y, color) {
  const o = y * (stride + 1) + 1 + x * 4;
  for (let i = 0; i < 4; i++) raw[o + i] = color[i];
}
function rounded(x, y, l, t, w, h, r) {
  const dx = Math.max(l + r - x, 0, x - (l + w - r)),
    dy = Math.max(t + r - y, 0, y - (t + h - r));
  return (
    x >= l && x <= l + w && y >= t && y <= t + h && dx * dx + dy * dy <= r * r
  );
}
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    let color = [0, 0, 0, 0];
    if (rounded(x, y, 28, 28, 456, 456, 108)) color = [25, 32, 42, 255];
    if (rounded(x, y, 91, 85, 330, 346, 99)) color = [194, 201, 209, 255];
    if (rounded(x, y, 115, 111, 282, 234, 72)) color = [16, 23, 32, 255];
    if (
      rounded(x, y, 177, 197, 34, 61, 17) ||
      rounded(x, y, 300, 197, 34, 61, 17)
    )
      color = [232, 241, 249, 255];
    if (rounded(x, y, 231, 379, 50, 9, 4)) color = [151, 192, 224, 255];
    setPixel(x, y, color);
  }

const idat = deflateSync(raw, { level: 9 });

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

writeFileSync(outFile, png);
