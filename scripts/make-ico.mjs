// Packs PNG files into a multi-image ICO (PNG-compressed entries). Usage: node make-ico.mjs out.ico a.png b.png ...
import { readFileSync, writeFileSync } from 'node:fs'
const [out, ...pngs] = process.argv.slice(2)
const bufs = pngs.map(p => readFileSync(p))
const head = Buffer.alloc(6 + 16 * bufs.length)
head.writeUInt16LE(1, 2); head.writeUInt16LE(bufs.length, 4)
let off = head.length
bufs.forEach((b, i) => {
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), e = 6 + 16 * i
  head[e] = w >= 256 ? 0 : w; head[e + 1] = h >= 256 ? 0 : h
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6)
  head.writeUInt32LE(b.length, e + 8); head.writeUInt32LE(off, e + 12)
  off += b.length
})
writeFileSync(out, Buffer.concat([head, ...bufs]))
