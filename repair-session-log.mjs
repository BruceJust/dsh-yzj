// Repair session-279b7ecc-cddc-4384-8bbd-93f4a109f974's corrupt log:
// drop the 4 duplicated synthetic-closer lines (the pre-resume "interrupted"
// tail) while keeping the real resumed stream, preserving frame layout.
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { zstdDecompressSync, zstdCompressSync, constants } from 'node:zlib'

const dir = 'C:/Users/rocks/.dsh/sessions/--D-dev-dsh-yzj--/session-279b7ecc-cddc-4384-8bbd-93f4a109f974'
const src = dir + '/session.jsonl.zstd'
const bak = dir + '/session.jsonl.zstd.corrupt-bak'
const tmp = dir + '/session.jsonl.zstd.repair-tmp'

if (!existsSync(src)) { console.error('missing', src); process.exit(1) }
if (existsSync(bak)) { console.error('backup already exists:', bak); process.exit(1) }

// --- 1. backup ---
copyFileSync(src, bak)
console.log('backup written:', bak)

const raw = readFileSync(src)
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const starts = []
let at = 0
while (true) {
  const i = raw.indexOf(MAGIC, at)
  if (i === -1) break
  starts.push(i)
  at = i + 1
}
console.log('frames:', starts.length)

// --- 2. decompress per frame, build global line array with frame ownership ---
const frames = []          // { start, end, lines: string[] (no trailing \n), raw?: Buffer }
let totalLines = 0
for (let f = 0; f < starts.length; f++) {
  const start = starts[f]
  const end = f + 1 < starts.length ? starts[f + 1] : raw.length
  const bytes = raw.subarray(start, end)
  let plain
  try { plain = zstdDecompressSync(bytes) } catch (e) { console.error(`frame ${f} decompress failed:`, e.message); process.exit(1) }
  const text = plain.toString('utf8')
  const ls = text.split('\n')
  if (ls.at(-1) === '') ls.pop()          // trailing newline
  frames.push({ start, end, lines: ls, raw: bytes })
  totalLines += ls.length
}
console.log('total plaintext lines:', totalLines, '(header +', totalLines - 1, 'event lines)')

// --- 3. sanity-check the 4 lines to delete (array indices 13777..13780) ---
const flat = []
for (const fr of frames) for (const l of fr.lines) flat.push(l)
const target = [13777, 13778, 13779, 13780]
for (const i of target) {
  const v = JSON.parse(flat[i])
  const lineNo = i + 1 // 1-based incl header
  console.log(`delete candidate line ${lineNo}: seq ${v.seq ?? v.seq0} type ${v.type}`)
}
const checks = [
  [13777, 'tool/result', 229786], [13778, 'step/end', 229787],
  [13779, 'turn/end', 229788], [13780, 'session/end-seed', 229789],
]
for (const [i, type, seq] of checks) {
  const v = JSON.parse(flat[i])
  if (v.type !== type || (v.seq ?? v.seq0) !== seq) {
    console.error(`sanity mismatch at ${i}: expected ${type}/${seq}, got ${v.type}/${v.seq ?? v.seq0}`)
    process.exit(1)
  }
}
// and the line after must be the real tool/result 229786
const after = JSON.parse(flat[13781])
if (after.type !== 'tool/result' || after.seq !== 229786) {
  console.error('sanity mismatch: line 13781 is not the real tool/result 229786:', after.type, after.seq)
  process.exit(1)
}
console.log('sanity checks passed')

// --- 4. rebuild frames: frame 0 verbatim; later frames minus the 4 lines ---
const drop = new Set(target)
const outFrames = []
// frame 0 (header) verbatim
outFrames.push(frames[0].raw)
console.log('frame 0 kept verbatim:', frames[0].lines.length, 'line(s)')

let globalIndex = 0
for (let f = 1; f < frames.length; f++) {
  const fr = frames[f]
  const kept = []
  for (const l of fr.lines) {
    if (!drop.has(globalIndex)) kept.push(l)
    globalIndex++
  }
  if (kept.length === 0) { console.log(`frame ${f}: all lines dropped, skipped`); continue }
  const body = kept.join('\n') + '\n'
  const compressed = zstdCompressSync(body, { params: { [constants.ZSTD_c_checksumFlag]: 1 } })
  outFrames.push(compressed)
  if (f < 10 || f % 2000 === 0 || f === frames.length - 1) {
    console.log(`frame ${f}: ${fr.lines.length} lines -> ${kept.length} kept (${compressed.length}B)`)
  }
}

const rebuilt = Buffer.concat(outFrames)
writeFileSync(tmp, rebuilt)
console.log('temp rebuilt file written:', tmp, rebuilt.length, 'bytes (orig', raw.length + ')')

// --- 5. validate the rebuilt file (faithful scanner) ---
{
  const r = readFileSync(tmp)
  const st = []
  let a = 0
  while (true) { const i = r.indexOf(MAGIC, a); if (i === -1) break; st.push(i); a = i + 1 }
  const parts = []
  for (let f = 0; f < st.length; f++) {
    const s = st[f], e = f + 1 < st.length ? st[f + 1] : r.length
    parts.push(zstdDecompressSync(r.subarray(s, e)))
  }
  const lines = Buffer.concat(parts).toString('utf8').split('\n')
  console.log('rebuilt frames:', st.length, 'decompressed lines:', lines.length - 1)
  const decodeSeqs = (line) => {
    const v = JSON.parse(line)
    if (v && typeof v === 'object' && ['text-chunks', 'reasoning-chunks', 'tool-call-chunks'].includes(v.type)) {
      const payload = v.data && (v.data.texts || v.data.args)
      return Array.from({ length: payload.length }, (_, k) => v.seq0 + k)
    }
    return [v.seq]
  }
  let expected = 0
  let bad = null
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue
    let seqs
    try { seqs = decodeSeqs(lines[i]) } catch (e) { bad = { line: i, kind: 'unparsable', msg: e.message }; break }
    if (seqs[0] !== expected) { bad = { line: i, kind: 'gap', expected, got: seqs[0] }; break }
    expected += seqs.length
  }
  if (bad) { console.error('REBUILT FILE STILL CORRUPT:', JSON.stringify(bad)); process.exit(1) }
  console.log('validation OK: contiguous events', expected, '(was 285357 incl 4 dupes)')
  const last = JSON.parse(lines[lines.length - 2])
  console.log('last event:', last.type, 'seq', last.seq)
}

// --- 6. atomic-ish swap ---
import { renameSync } from 'node:fs'
renameSync(tmp, src)
console.log('repaired file installed at', src)
