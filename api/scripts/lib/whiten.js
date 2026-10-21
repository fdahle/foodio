import { mkdirSync } from 'fs'
import { join, dirname } from 'path'
import sharp from 'sharp'

// List rows show the illustrations on white instead of their peach paper background. The background is
// flood-filled from the borders over pixels that are light and nearly neutral once white-balanced against
// the border colour; only that region is white-balanced, so plates and food keep their colours and the
// shadows under them turn soft grey.
export async function whiten(input) {
  const { data, info: { width: W, height: H } } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const border = []
  for (let x = 0; x < W; x += 4) border.push(x, (H - 1) * W + x)
  for (let y = 0; y < H; y += 4) border.push(y * W, y * W + W - 1)
  const median = c => border.map(i => data[i * 3 + c]).sort((a, b) => a - b)[border.length >> 1]
  const bg = [median(0), median(1), median(2)]
  const balanced = i => [0, 1, 2].map(c => Math.min(255, data[i * 3 + c] * 255 / bg[c]))
  const isBg = i => {
    const [r, g, b] = balanced(i)
    return Math.min(r, g, b) > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 28
  }

  const mask = new Uint8Array(W * H)
  const stack = border.filter(isBg)
  stack.forEach(i => (mask[i] = 1))
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i / W) | 0
    for (const j of [x > 0 && i - 1, x < W - 1 && i + 1, y > 0 && i - W, y < H - 1 && i + W]) {
      if (j !== false && !mask[j] && isBg(j)) { mask[j] = 1; stack.push(j) }
    }
  }
  const out = Buffer.from(data)
  for (let i = 0; i < W * H; i++) if (mask[i]) out.set(balanced(i), i * 3)
  return sharp(out, { raw: { width: W, height: H, channels: 3 } }).webp({ quality: 82 })
}

// data/images/<file> → data/images-white/<file>
export async function writeWhite(dataDir, file) {
  const out = join(dataDir, 'images-white', file)
  mkdirSync(dirname(out), { recursive: true })
  await (await whiten(join(dataDir, 'images', file))).toFile(out)
}
