import { mkdirSync } from 'fs'
import { join, dirname } from 'path'
import sharp from 'sharp'
import { writeWhite } from './whiten.js'

// Cuts a sheet with a columns × rows grid of drawings into one 800×600 WebP per dish key (null skips a cell).
// Captions the model wrote under the drawings are painted over first. Each tile is centred on its drawing
// rather than on the grid cell, since the model rarely keeps to its own grid: a drawing that reaches into the
// next cell is kept whole, and bits of neighbouring drawings that end up in the tile are painted over.
export async function sliceSheet(sheetPath, { columns, rows, dishes }, { dataDir } = {}) {
  const { data, info: { width, height } } = await sharp(sheetPath).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const captions = eraseCaptions(data, width, height, columns, rows) + eraseText(data, width, height, columns, rows).length
  const drawings = findDrawings(data, width, height, columns, rows)
  if (drawings.large > columns * rows) throw new Error(`the image has ${drawings.large} drawings instead of ${columns * rows}, so it doesn't follow the grid`)
  const cellW = width / columns
  const cellH = height / rows
  const keys = []
  for (let i = 0; i < columns * rows; i++) {
    const key = dishes[i]
    if (!key) continue
    const { box, bg } = drawings.cells[i]
    // Never smaller than a cell, so every dish keeps the same scale unless it is too big to fit.
    const w = Math.round(Math.max(cellW, cellH * 4 / 3, (box.x1 - box.x0) * 1.08, (box.y1 - box.y0) * 1.08 * 4 / 3))
    const h = Math.round(w * 3 / 4)
    const left = Math.round((box.x0 + box.x1 - w) / 2)
    const top = Math.round((box.y0 + box.y1 - h) / 2)
    const tile = Buffer.alloc(w * h * 3)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = left + x, sy = top + y
        const inside = sx >= 0 && sy >= 0 && sx < width && sy < height
        const owner = inside && drawings.ownerAt(sx, sy)
        const keep = inside && (owner === false || owner === i)
        tile.set(keep ? data.subarray((sy * width + sx) * 3, (sy * width + sx) * 3 + 3) : bg, (y * w + x) * 3)
      }
    }
    const out = join(dataDir, 'images', `${key}.webp`)
    mkdirSync(dirname(out), { recursive: true })
    await sharp(tile, { raw: { width: w, height: h, channels: 3 } }).resize(800, 600).webp({ quality: 82 }).toFile(out)
    await writeWhite(dataDir, `${key}.webp`)
    keys.push(key)
  }
  return { width, height, keys, captions }
}

// Finds each cell's drawing as the ink blobs that belong to it: the largest blob centred in the cell, plus the
// smaller ones (side bowls, garnish) closest to it. Works on a 4× smaller ink mask, grown a little so the parts of
// one drawing join up. ownerAt(x, y) tells which cell the blob at a pixel belongs to (false: no blob there).
export function findDrawings(data, width, height, columns, rows) {
  const S = 4
  const mw = Math.ceil(width / S), mh = Math.ceil(height / S)
  const cellW = width / columns, cellH = height / rows
  const cellOf = (x, y) => Math.min(rows - 1, Math.floor(y / cellH)) * columns + Math.min(columns - 1, Math.floor(x / cellW))
  const cells = cellBackgrounds(data, width, height, columns, rows).map((bg, i) => {
    const x0 = Math.round((i % columns) * cellW), y0 = Math.round(Math.floor(i / columns) * cellH)
    return { bg, box: { x0, y0, x1: Math.round(x0 + cellW), y1: Math.round(y0 + cellH) } }
  })

  const ink = new Uint8Array(mw * mh)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const m = Math.floor(y / S) * mw + Math.floor(x / S)
      if (ink[m]) continue
      const bg = cells[cellOf(x, y)].bg, i = (y * width + x) * 3
      if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 40) ink[m] = 1
    }
  }
  const R = 3
  const grown = new Uint8Array(mw * mh)
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    if (!ink[y * mw + x]) continue
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const yy = y + dy, xx = x + dx
      if (yy >= 0 && xx >= 0 && yy < mh && xx < mw) grown[yy * mw + xx] = 1
    }
  }

  // Connected blobs of the grown mask.
  const label = new Int32Array(mw * mh).fill(-1)
  const blobs = []
  for (let start = 0; start < mw * mh; start++) {
    if (!grown[start] || label[start] >= 0) continue
    const blob = { x0: mw, y0: mh, x1: 0, y1: 0, area: 0, sx: 0, sy: 0, owner: -1 }
    const stack = [start]
    label[start] = blobs.length
    while (stack.length) {
      const p = stack.pop()
      const x = p % mw, y = (p - x) / mw
      blob.area++; blob.sx += x; blob.sy += y
      if (x < blob.x0) blob.x0 = x; if (x > blob.x1) blob.x1 = x
      if (y < blob.y0) blob.y0 = y; if (y > blob.y1) blob.y1 = y
      for (const q of [x > 0 && p - 1, x < mw - 1 && p + 1, y > 0 && p - mw, y < mh - 1 && p + mw]) {
        if (q !== false && grown[q] && label[q] < 0) { label[q] = blobs.length; stack.push(q) }
      }
    }
    blobs.push(blob)
  }

  const main = cells.map(() => null)
  for (const b of blobs) {
    const c = cellOf((b.sx / b.area) * S, (b.sy / b.area) * S)
    if (!main[c] || b.area > main[c].area) main[c] = b
  }
  main.forEach((b, c) => { if (b) b.owner = c })
  const gap = (a, b) => Math.max(0, a.x0 - b.x1, b.x0 - a.x1) + Math.max(0, a.y0 - b.y1, b.y0 - a.y1)
  for (const b of blobs) {
    if (b.owner >= 0) continue
    let best = null
    for (const m of main) if (m && (!best || gap(b, m) < gap(b, best))) best = m
    // Specks far from any drawing stay unowned and are left as they are; anything bigger (a spoon lying
    // beside the plate) belongs to the nearest drawing however far away it is.
    const speck = b.area * S * S < (cellW * 0.05) ** 2
    if (best && (!speck || gap(b, best) * S < cellW * 0.2)) b.owner = best.owner
  }

  for (const [c, cell] of cells.entries()) {
    const own = blobs.filter(b => b.owner === c)
    if (!own.length) continue
    cell.box = {
      x0: Math.min(...own.map(b => b.x0)) * S, y0: Math.min(...own.map(b => b.y0)) * S,
      x1: (Math.max(...own.map(b => b.x1)) + 1) * S, y1: (Math.max(...own.map(b => b.y1)) + 1) * S,
    }
  }
  const ownerAt = (x, y) => {
    const l = label[Math.floor(y / S) * mw + Math.floor(x / S)]
    return l < 0 || blobs[l].owner < 0 ? false : blobs[l].owner
  }
  // Drawings at least a third of a cell wide and high, with large pieces of one dish (a cake and its slice) taken
  // together; more of them than there are cells means the model drew another grid.
  const centres = []
  for (const b of blobs) {
    if ((b.x1 - b.x0 + 1) * S < cellW / 3 || (b.y1 - b.y0 + 1) * S < cellH / 3) continue
    const x = b.sx / b.area * S, y = b.sy / b.area * S
    if (!centres.some(c => Math.abs(c.x - x) < cellW * 0.6 && Math.abs(c.y - y) < cellH * 0.6)) centres.push({ x, y })
  }
  const large = centres.length
  return { cells, ownerAt, large }
}

// Image models often write the dish name under each drawing despite being told not to. Per column, over the
// whole sheet height (captions can straddle the grid lines), a short band of ink right below a tall one (a drawing)
// is taken for a caption and filled with the background colour of that row. Returns how many were erased.
export function eraseCaptions(data, width, height, columns, rows) {
  const cellH = height / rows
  const bgs = cellBackgrounds(data, width, height, columns, rows)
  const at = (x, y) => (y * width + x) * 3
  let erased = 0
  for (let c = 0; c < columns; c++) {
    const x0 = Math.round(c * width / columns)
    const x1 = Math.round((c + 1) * width / columns)
    // The left edge of the column follows the shading of the background, unless a caption starts right there.
    const bgAt = y => {
      const edge = data.subarray(at(x0 + 3, y), at(x0 + 3, y) + 3)
      const cell = bgs[Math.min(rows - 1, Math.floor(y / cellH)) * columns + c]
      return Math.abs(edge[0] - cell[0]) + Math.abs(edge[1] - cell[1]) + Math.abs(edge[2] - cell[2]) <= 40 ? edge : cell
    }
    const inked = y => {
      const bg = bgAt(y)
      let n = 0
      for (let x = x0 + 6; x < x1 - 6 && n <= 2; x++) {
        const i = at(x, y)
        if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 90) n++
      }
      return n > 2
    }
    // Bands of ink rows; tiny gaps (the dot on an İ, accents) don't split a band.
    const merge = Math.round(cellH * 0.012)
    const bands = []
    for (let y = 0; y < height; y++) {
      if (!inked(y)) continue
      const last = bands.at(-1)
      if (last && y - last.end <= merge) last.end = y
      else bands.push({ start: y, end: y })
    }
    for (let i = 1; i < bands.length; i++) {
      const band = bands[i]
      const above = bands[i - 1]
      if (band.end - band.start + 1 > cellH * 0.16 || above.end - above.start + 1 < cellH * 0.3) continue
      const from = Math.round((above.end + band.start) / 2)
      const to = i + 1 < bands.length ? Math.round((band.end + bands[i + 1].start) / 2) : height - 1
      for (let y = from; y <= to; y++) {
        const bg = Buffer.from(bgAt(y))
        for (let x = x0; x < x1; x++) data.set(bg, at(x, y))
      }
      erased++
    }
  }
  return erased
}

// The background colour of each cell, from its corners (the median of four, so one corner with a drawing in it
// doesn't matter).
function cellBackgrounds(data, width, height, columns, rows) {
  const cellW = width / columns, cellH = height / rows
  return Array.from({ length: columns * rows }, (_, i) => {
    const x0 = Math.round((i % columns) * cellW) + 2, y0 = Math.round(Math.floor(i / columns) * cellH) + 2
    const x1 = Math.round((i % columns + 1) * cellW) - 3, y1 = Math.round((Math.floor(i / columns) + 1) * cellH) - 3
    const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => data.subarray((y * width + x) * 3, (y * width + x) * 3 + 3))
    return Buffer.from([0, 1, 2].map(k => corners.map(p => p[k]).sort((a, b) => a - b)[1]))
  })
}

// Captions eraseCaptions can't separate from a drawing (above it, beside part of it, or close below it). Dark
// pixels are joined sideways into words; a word or line counts as text when it is flat, made of at least three
// separate dark pieces (letters) with thin strokes, and has plain background between them. Each is filled with
// the background colour; returns their boxes.
export function eraseText(data, width, height, columns, rows) {
  const S = 2, GX = 5
  const mw = Math.ceil(width / S), mh = Math.ceil(height / S)
  const cellW = width / columns, cellH = height / rows
  const bgs = cellBackgrounds(data, width, height, columns, rows)
  const bgAt = (x, y) => bgs[Math.min(rows - 1, Math.floor(y / cellH)) * columns + Math.min(columns - 1, Math.floor(x / cellW))]
  const isDark = i => data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11 < 120

  const dark = new Uint8Array(mw * mh)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (isDark((y * width + x) * 3)) dark[Math.floor(y / S) * mw + Math.floor(x / S)] = 1
  }
  const grown = new Uint8Array(mw * mh)
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    if (!dark[y * mw + x]) continue
    for (let dx = -GX; dx <= GX; dx++) if (x + dx >= 0 && x + dx < mw) grown[y * mw + x + dx] = 1
  }

  const seen = new Uint8Array(mw * mh)
  const found = []
  for (let start = 0; start < mw * mh; start++) {
    if (!grown[start] || seen[start]) continue
    let x0 = mw, y0 = mh, x1 = 0, y1 = 0
    const stack = [start]
    seen[start] = 1
    while (stack.length) {
      const p = stack.pop()
      const x = p % mw, y = (p - x) / mw
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
      for (const q of [x > 0 && p - 1, x < mw - 1 && p + 1, y > 0 && p - mw, y < mh - 1 && p + mw]) {
        if (q !== false && grown[q] && !seen[q]) { seen[q] = 1; stack.push(q) }
      }
    }
    const box = { x0: x0 * S, y0: y0 * S, x1: Math.min(width, (x1 + 1) * S), y1: Math.min(height, (y1 + 1) * S) }
    const w = box.x1 - box.x0, h = box.y1 - box.y0
    if (h < cellH * 0.02 || h > cellH * 0.2 || w < h * 1.5) continue
    if (looksLikeText(data, width, box, bgAt, isDark)) found.push(box)
  }

  for (const box of found) {
    for (let y = Math.max(0, box.y0 - 3); y < Math.min(height, box.y1 + 3); y++) {
      for (let x = Math.max(0, box.x0 - 3); x < Math.min(width, box.x1 + 3); x++) data.set(bgAt(x, y), (y * width + x) * 3)
    }
  }
  return found
}

function looksLikeText(data, width, box, bgAt, isDark) {
  const w = box.x1 - box.x0, h = box.y1 - box.y0
  const mask = new Uint8Array(w * h)
  let darkCount = 0, plain = 0, other = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = box.x0 + x, sy = box.y0 + y, i = (sy * width + sx) * 3
    if (isDark(i)) { mask[y * w + x] = 1; darkCount++; continue }
    const bg = bgAt(sx, sy)
    if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) <= 40) plain++
    else other++
  }
  if (darkCount / (w * h) > 0.45 || plain / (plain + other) < 0.8) return false
  let pieces = 0
  for (let start = 0; start < w * h && pieces < 3; start++) {
    if (mask[start] !== 1) continue
    let size = 0
    const stack = [start]
    mask[start] = 2
    while (stack.length) {
      const p = stack.pop()
      const x = p % w
      size++
      for (const q of [x > 0 && p - 1, x < w - 1 && p + 1, p >= w && p - w, p < w * (h - 1) && p + w]) {
        if (q !== false && mask[q] === 1) { mask[q] = 2; stack.push(q) }
      }
    }
    if (size >= 15) pieces++
  }
  return pieces >= 3
}
