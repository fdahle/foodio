// Cuts a generated image sheet into one image per dish, stored where the API looks for them:
//   data/images/<cuisine-slug>/<dish-slug>.webp
//
// Usage (from the repo root):
//   npm --prefix api run slice -- <sheet image> <manifest>        e.g. data/sheets/italian-01.png italian-01
//
// A manifest lives in api/sheets/<name>.json: { "columns": 4, "rows": 3, "dishes": [keys...] },
// listing dish keys left to right, top to bottom (null skips a cell).
import { readFileSync, existsSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { parseArgs } from 'util'
import { sliceSheet } from './lib/slice.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const { positionals: [sheetArg, manifestArg] } = parseArgs({ allowPositionals: true })
if (!sheetArg || !manifestArg) {
  console.error('Usage: npm --prefix api run slice -- <sheet image> <manifest name or path>')
  process.exit(1)
}

const { default: db, DATA_DIR } = await import('../db.js')
const sheetPath = resolve(ROOT, sheetArg)
const manifestPath = existsSync(resolve(ROOT, manifestArg)) ? resolve(ROOT, manifestArg)
  : join(ROOT, 'api', 'sheets', `${manifestArg.replace(/\.json$/, '')}.json`)
const { columns, rows, dishes } = JSON.parse(readFileSync(manifestPath, 'utf8'))

const known = db.prepare('SELECT 1 FROM dishes WHERE key = ?')
for (const key of dishes) if (key && !known.get(key)) console.warn(`! ${key} is not a dish key in the database (written anyway)`)

const { width, height, keys } = await sliceSheet(sheetPath, { columns, rows, dishes }, { dataDir: DATA_DIR })
for (const key of keys) console.log(`✓ ${key}`)
console.log(`${keys.length} images from a ${width}×${height} sheet (${columns}×${rows} grid).`)
