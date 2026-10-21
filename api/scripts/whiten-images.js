// Makes the white-background copies of the dish illustrations used in list rows:
//   data/images/<cuisine>/<dish>.webp → data/images-white/<cuisine>/<dish>.webp
// Only copies that are missing or older than their original are (re)made; copies whose original is gone are removed.
//
// Usage (from the repo root):
//   npm --prefix api run whiten             update what's missing or stale
//   npm --prefix api run whiten -- --force  redo every copy
import { fileURLToPath } from 'url'
import { join, dirname, relative } from 'path'
import { existsSync, readdirSync, statSync, unlinkSync } from 'fs'
import { parseArgs } from 'util'
import { writeWhite } from './lib/whiten.js'

const DATA_DIR = process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data')
const { values: opts } = parseArgs({ options: { force: { type: 'boolean', default: false } } })

const webps = dir => (existsSync(dir) ? readdirSync(dir, { recursive: true }) : [])
  .filter(f => f.endsWith('.webp')).map(f => relative(dir, join(dir, f)))

const src = join(DATA_DIR, 'images')
const dst = join(DATA_DIR, 'images-white')
const todo = webps(src).filter(f => {
  const out = join(dst, f)
  return opts.force || !existsSync(out) || statSync(out).mtimeMs < statSync(join(src, f)).mtimeMs
})

let removed = 0
for (const f of webps(dst)) {
  if (!existsSync(join(src, f))) { unlinkSync(join(dst, f)); removed++ }
}

console.log(`${todo.length} image${todo.length === 1 ? '' : 's'} to whiten${removed ? `, ${removed} orphaned copies removed` : ''}`)
let done = 0
for (const f of todo) {
  try {
    await writeWhite(DATA_DIR, f)
  } catch (err) {
    console.error(`✗ ${f} (${err.message})`)
  }
  if (++done % 250 === 0) console.log(`  ${done}/${todo.length}`)
}
console.log('Done.')
