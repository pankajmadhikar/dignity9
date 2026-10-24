import zlib from 'zlib';
import fs from 'fs';
import path from 'path';

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([length, body, checksum]);
}

function icon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const arm = size * 0.09;
  const reach = size * 0.28;
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const offset = row + 1 + x * 4;
      const cx = size / 2;
      const cy = size / 2;
      const plus =
        (Math.abs(x - cx) <= arm && Math.abs(y - cy) <= reach) ||
        (Math.abs(y - cy) <= arm && Math.abs(x - cx) <= reach);
      raw[offset] = plus ? 255 : 12;
      raw[offset + 1] = plus ? 255 : 107;
      raw[offset + 2] = plus ? 255 : 102;
      raw[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = path.resolve('apps/web/public');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon-192.png'), icon(192));
fs.writeFileSync(path.join(dir, 'icon-512.png'), icon(512));
console.log('icons written');
