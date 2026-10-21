// Image-sheet queue for generating dish illustrations in the Gemini app, 12 dishes per sheet.
//
//   npm run sheet              import the newest image from ~/Downloads for the pending sheet (if there is one),
//                              then copy the prompt for the next 12 dishes to the clipboard
//   npm run sheet -- --file x  import a specific image instead of the newest download
//   npm run sheet -- --api     generate the pending sheet through the Gemini API and import it (paid, needs GEMINI_API_KEY)
//   npm run sheet -- --batch 5 submit the next 5 sheets as one Gemini batch job (half price, done within 24 h);
//                              every later run checks the job and imports the sheets once it has finished
//   npm run sheet -- --redo    put the last imported sheet back in the queue (regenerate it)
//   npm run sheet -- --undo    like --redo, but also removes its images and never accepts that image file again
//                              (use when the wrong image was imported)
//   npm run sheet -- --redo --sheet 12   the same for another sheet than the last
//   npm run sheet -- --skip    drop the pending sheet without importing
//   npm run sheet -- --reslice cut all imported sheets again (after a change to the slicer)
//   npm run sheet -- --print   also print the prompt
//   npm run sheet -- --status  show progress
//
// Dishes you have tried or wishlisted come first, then cuisines you have started, then everything else.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync, unlinkSync, renameSync } from 'fs'
import { join, extname, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { homedir } from 'os'
import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { parseArgs } from 'util'
import sharp from 'sharp'
import { sliceSheet } from './lib/slice.js'

config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env') })

const { default: db, DATA_DIR } = await import('../db.js')
const { seed } = await import('../seed.js')

const { values: opts } = parseArgs({
  options: {
    file: { type: 'string' },
    api: { type: 'boolean', default: false },
    batch: { type: 'string' },
    redo: { type: 'boolean', default: false },
    undo: { type: 'boolean', default: false },
    skip: { type: 'boolean', default: false },
    reslice: { type: 'boolean', default: false },
    sheet: { type: 'string' },
    print: { type: 'boolean', default: false },
    status: { type: 'boolean', default: false },
  },
})

// Sheets made before the grid was configurable are 4 × 3.
const OLD_GRID = { columns: 4, rows: 3 }
const [columns, rows] = (process.env.SHEET_GRID || '4x3').split('x').map(Number)
const GRID = { columns, rows }
const PER_SHEET = columns * rows
const SHEETS = join(DATA_DIR, 'sheets')
const STATE = join(SHEETS, 'queue.json')
const DOWNLOADS = join(homedir(), 'Downloads')
mkdirSync(SHEETS, { recursive: true })

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { pending: null, sheets: [] }
state.rejected ||= []
state.batches ||= []
const hashOf = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 1))
const imageFile = d => join(DATA_DIR, 'images', `${d.key || `${d.cuisine_slug}/${d.slug}`}.webp`)
const pad = n => String(n).padStart(3, '0')
const elapsed = since => {
  const min = Math.round((Date.now() - since) / 60000)
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`
}

seed()
const dishes = db.prepare(`
  SELECT d.id, d.key, d.slug, d.name, d.description, d.same_group, c.slug AS cuisine_slug, c.name AS cuisine,
    u.status, (SELECT COUNT(*) FROM dishes d2 JOIN user_dishes u2 ON u2.dish_id = d2.id
               WHERE d2.cuisine_id = c.id AND u2.status = 'tried') AS cuisine_tried
  FROM dishes d JOIN cuisines c ON c.id = d.cuisine_id
  LEFT JOIN user_dishes u ON u.dish_id = d.id
  LEFT JOIN regions r ON r.id = d.region_id
  WHERE COALESCE(u.hidden, 0) = 0
  ORDER BY (u.status IS NOT NULL) DESC, cuisine_tried DESC, c.name, COALESCE(r.sort, 999), d.sort
`).all()
const keyOf = d => d.key || `${d.cuisine_slug}/${d.slug}`
const twins = new Map()
for (const d of dishes) if (d.same_group) twins.set(d.same_group, [...(twins.get(d.same_group) || []), d])

// A dish linked after its twin was drawn gets the twin's image instead of waiting for one of its own.
for (const group of twins.values()) {
  const drawn = group.find(d => existsSync(imageFile(d)))
  for (const d of drawn ? group : []) {
    if (existsSync(imageFile(d))) continue
    mkdirSync(join(DATA_DIR, 'images', d.cuisine_slug), { recursive: true })
    copyFileSync(imageFile(drawn), imageFile(d))
  }
}

// The same dish listed under several cuisines is drawn once; the image is copied to its twins on import.
// Dishes in a submitted batch job are not missing either.
function missing() {
  const seen = new Set()
  const batched = new Set(state.batches.flatMap(b => b.sheets.flatMap(s => s.dishes)))
  return dishes.filter(d => {
    if (existsSync(imageFile(d)) || batched.has(keyOf(d))) {
      if (d.same_group) seen.add(d.same_group)
      return false
    }
    if (d.same_group) {
      if (seen.has(d.same_group)) return false
      seen.add(d.same_group)
    }
    return true
  })
}

if (opts.status) {
  const have = dishes.filter(d => existsSync(imageFile(d))).length
  const left = missing().length
  console.log(`${have} of ${dishes.length} dishes have an image; ${left} still to draw (≈${Math.ceil(left / PER_SHEET)} sheets, linked dishes share one).`)
  console.log(`${state.sheets.length} sheets imported${state.pending ? `, sheet ${pad(state.pending.n)} pending` : ''}.`)
  for (const b of state.batches) console.log(`Batch ${b.name}: sheets ${b.sheets.map(s => pad(s.n)).join(', ')}, submitted ${elapsed(b.createdAt)} ago.`)
  process.exit(0)
}

function buildPrompt(list, grid) {
  const lines = list.map((d, i) => {
    const row = i % grid.columns === 0 ? `Row ${i / grid.columns + 1}:\n` : ''
    const cuisine = d.name.includes(d.cuisine) ? '' : ` (${d.cuisine})`
    return `${row}${i + 1}. ${d.name}${cuisine}: ${d.description || 'a traditional dish'}`
  })
  return `A 16:9 landscape illustration sheet with a ${grid.columns} × ${grid.rows} grid of ${list.length} separate food illustrations, ${grid.columns} per row, ${grid.rows} rows, evenly spaced. Each dish is centred in its own cell with generous empty space around it, so no dish touches or overlaps the edge of its cell or a neighbouring dish.

Style: cute hand-drawn food illustration, warm colours, soft shading, clean dark-brown outlines. Plain warm cream background (#FAF0E4) across the whole sheet, no borders, no frames, no grid lines. No text, no labels, no letters, no faces on the food, no sparkles, no steam lines, no decorations around the dishes. Same viewing angle and scale for every dish. Show each dish as it is typically served.

The dish names below are only for you to know what to draw: do not write any names, captions or labels on the sheet. The image must contain only the drawings.

Dishes, left to right, top to bottom:
${lines.join('\n')}

Remember: draw only the dishes. No names, captions, labels or any other text anywhere in the image.`
}

function copy(text) {
  const r = spawnSync('pbcopy', { input: text })
  return r.status === 0
}

// A partial sheet gets the smallest grid that fits it: the model fills empty cells with dishes of its own.
function gridFor(count) {
  let best = GRID
  for (let r = 1; r <= GRID.rows; r++) {
    for (let c = r; c <= GRID.columns; c++) if (c * r >= count && c * r <= best.columns * best.rows) best = { columns: c, rows: r }
  }
  return best
}

const sheetOf = (list, n, grid = gridFor(list.length)) =>
  ({ n, grid, dishes: list.map(keyOf), names: list.map(d => d.name), prompt: buildPrompt(list, grid), createdAt: Date.now() })
const nextNumber = () =>
  Math.max(0, state.pending?.n || 0, ...state.sheets.map(s => s.n), ...state.batches.flatMap(b => b.sheets.map(s => s.n))) + 1

function queue(list, n, grid) {
  state.pending = sheetOf(list, n, grid)
  save()
  announce()
}

// Rebuilt before use, so prompt tweaks also apply to a sheet that is already pending.
function refresh(p) {
  const byKey = new Map(dishes.map(d => [keyOf(d), d]))
  const list = p.dishes.map(k => byKey.get(k)).filter(Boolean)
  if (list.length === p.dishes.length) {
    p.prompt = buildPrompt(list, p.grid || OLD_GRID)
    p.names = list.map(d => d.name)
  }
}

function announce() {
  const p = state.pending
  refresh(p)
  save()
  const copied = copy(p.prompt)
  console.log(`\nSheet ${pad(p.n)}: ${p.names.join(', ')}`)
  console.log(copied ? '→ Prompt copied to the clipboard. Paste it into Gemini, download the image, then run `npm run sheet` again.'
    : '→ Copy the prompt below into Gemini, download the image, then run `npm run sheet` again.')
  if (opts.print || !copied) console.log(`\n${p.prompt}\n`)
}

const MODEL = process.env.SHEET_MODEL || 'gemini-3.1-flash-image-preview'
const SIZE = process.env.SHEET_SIZE || '2K'
const API = 'https://generativelanguage.googleapis.com/v1beta'

async function gemini(path, body) {
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set (add it to .env).')
    process.exit(1)
  }
  const res = await fetch(`${API}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: body && JSON.stringify(body),
  })
  const json = await res.json().catch(e => (res.ok ? Promise.reject(new Error(`Unreadable response from ${path}: ${e.message}`)) : {}))
  if (!res.ok) throw new Error(json.error?.message || `HTTP ${res.status}`)
  return json
}

const request = prompt => ({
  // Without this, larger sheets tend to get the dish names written under each drawing.
  systemInstruction: { parts: [{ text: 'You draw illustration sheets that are cut into separate images for an app. Never render any text, letters, numbers, names or labels in the image.' }] },
  contents: [{ parts: [{ text: prompt }] }],
  generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: SIZE } },
})

// Saves the image of a generateContent response next to the other sheets.
function saveImage(response, n) {
  const image = response?.candidates?.[0]?.content?.parts?.find(part => part.inlineData)?.inlineData
  if (!image) throw new Error(`No image in the response (${response?.candidates?.[0]?.finishReason || 'no candidates'})`)
  const usage = response.usageMetadata || {}
  console.log(`Sheet ${pad(n)} tokens: ${usage.promptTokenCount} in, ${usage.candidatesTokenCount} out${usage.thoughtsTokenCount ? `, ${usage.thoughtsTokenCount} thinking` : ''}.`)
  const file = join(SHEETS, `generated-${pad(n)}.${image.mimeType === 'image/png' ? 'png' : 'jpg'}`)
  writeFileSync(file, Buffer.from(image.data, 'base64'))
  return file
}

// Generates the pending sheet through the Gemini API.
async function generateSheet() {
  const p = state.pending
  console.log(`Generating sheet ${pad(p.n)} with ${MODEL} (${SIZE})…`)
  return saveImage(await gemini(`models/${MODEL}:generateContent`, request(p.prompt)), p.n)
}

async function submitBatch(count) {
  const batch = { createdAt: Date.now(), model: MODEL, size: SIZE, sheets: [] }
  state.batches.push(batch)
  if (state.pending) {
    refresh(state.pending)
    batch.sheets.push(state.pending)
    state.pending = null
  }
  while (batch.sheets.length < count) {
    const list = missing().slice(0, PER_SHEET)
    if (!list.length) break
    batch.sheets.push(sheetOf(list, nextNumber()))
  }
  if (!batch.sheets.length) {
    state.batches.pop()
    console.log('Every dish has an image or is in a batch already.')
    return false
  }
  const job = await gemini(`models/${MODEL}:batchGenerateContent`, {
    batch: {
      display_name: `foodio sheets ${batch.sheets.map(s => pad(s.n)).join(', ')}`,
      input_config: { requests: { requests: batch.sheets.map(s => ({ request: request(s.prompt), metadata: { key: String(s.n) } })) } },
    },
  })
  batch.name = job.name
  save()
  console.log(`Submitted ${batch.name} with ${batch.sheets.length} sheets (${pad(batch.sheets[0].n)}–${pad(batch.sheets.at(-1).n)}, ${MODEL}, ${SIZE}).`)
  console.log('Run `npm run sheet` later to check on it; the sheets are imported once it has finished.')
  return true
}

// Imports finished batch jobs; a failed job puts its dishes back in the queue.
async function checkBatches() {
  for (const batch of [...state.batches]) {
    const job = await gemini(batch.name)
    const info = job.metadata || job
    const status = String(info.state || 'unknown').replace(/^(BATCH|JOB)_STATE_/, '').toLowerCase()
    if (status === 'pending' || status === 'running' || status === 'unknown') {
      console.log(`Batch ${batch.name} (${batch.sheets.length} sheets): ${status}, submitted ${elapsed(batch.createdAt)} ago.`)
      continue
    }
    state.batches = state.batches.filter(b => b !== batch)
    if (status !== 'succeeded') {
      save()
      console.log(`Batch ${batch.name} ${status} after ${elapsed(batch.createdAt)}; its dishes are back in the queue.`)
      continue
    }
    console.log(`Batch ${batch.name} finished after ${elapsed(batch.createdAt)}.`)
    const results = (job.response || info.output)?.inlinedResponses?.inlinedResponses || []
    for (const [i, sheet] of batch.sheets.entries()) {
      const result = results.find(r => r.metadata?.key === String(sheet.n)) || results[i]
      try {
        if (result?.error) throw new Error(result.error.message)
        const file = saveImage(result?.response, sheet.n)
        await importSheet(sheet, file)
        unlinkSync(file)
      } catch (e) {
        console.log(`! Sheet ${pad(sheet.n)} failed (${e.message}); its dishes are back in the queue.`)
      }
    }
    save()
  }
}

// Only wide, large images count, so an unrelated download (a photo, a screenshot) is never taken for a sheet.
async function looksLikeSheet(path) {
  try {
    const { width, height } = await sharp(path).metadata()
    return width >= 1200 && width / height >= 1.6 && width / height <= 1.9
  } catch {
    return false
  }
}

async function newestDownload(after) {
  if (!existsSync(DOWNLOADS)) return null
  const candidates = readdirSync(DOWNLOADS)
    .filter(f => /\.(jpe?g|png|webp)$/i.test(f))
    .map(f => ({ path: join(DOWNLOADS, f), mtime: statSync(join(DOWNLOADS, f)).mtimeMs }))
    .filter(f => f.mtime > after)
    .sort((a, b) => b.mtime - a.mtime)
  for (const c of candidates) if (await looksLikeSheet(c.path) && !isImported(c.path)) return c.path
  return null
}

// A second download of an earlier sheet, or an image undone before, must not be imported as the next one.
function isImported(path) {
  const h = hashOf(path)
  return state.rejected.includes(h) || state.sheets.some(s => s.hash ? s.hash === h : existsSync(s.file) && hashOf(s.file) === h)
}

async function importSheet(p, file) {
  const target = join(SHEETS, `sheet-${pad(p.n)}${extname(file).toLowerCase()}`)
  const grid = p.grid || OLD_GRID
  const { width, height, keys, captions } = await sliceSheet(file, { ...grid, dishes: p.dishes }, { dataDir: DATA_DIR })
  if (resolve(file) !== target) copyFileSync(file, target)
  const byKey = new Map(dishes.map(d => [keyOf(d), d]))
  for (const k of keys) {
    const d = byKey.get(k)
    for (const t of twins.get(d?.same_group) || []) {
      if (t === d) continue
      mkdirSync(join(DATA_DIR, 'images', t.cuisine_slug), { recursive: true })
      copyFileSync(imageFile(d), imageFile(t))
    }
  }
  writeFileSync(join(SHEETS, `sheet-${pad(p.n)}.json`), JSON.stringify({ ...grid, dishes: p.dishes, prompt: p.prompt }, null, 1))
  state.sheets = state.sheets.filter(s => s.n !== p.n).concat({ n: p.n, grid, file: target, dishes: p.dishes, hash: hashOf(target) })
  save()
  const ratio = width / height
  console.log(`✓ Sheet ${pad(p.n)} imported: ${keys.length} images from ${width}×${height}${captions ? `, ${captions} captions erased` : ''}.`)
  if (ratio < 1.6 || ratio > 1.9) {
    console.log(`! The image is not 16:9 (${ratio.toFixed(2)}:1), so the grid may be off. Check these dishes in the app; \`npm run sheet -- --redo\` regenerates the sheet.`)
  }
}

if (opts.skip && state.pending) {
  console.log(`Dropped sheet ${pad(state.pending.n)}.`)
  state.pending = null
  save()
}

if (opts.redo || opts.undo) {
  const last = opts.sheet ? state.sheets.find(s => s.n === Number(opts.sheet)) : [...state.sheets].sort((a, b) => a.n - b.n).at(-1)
  if (!last) { console.log(opts.sheet ? `Sheet ${opts.sheet} has not been imported.` : 'No imported sheet to redo.'); process.exit(1) }
  const byKey = new Map(dishes.map(d => [keyOf(d), d]))
  const list = last.dishes.map(k => byKey.get(k)).filter(Boolean)
  if (opts.undo) {
    let removed = 0
    for (const d of list) {
      if (!existsSync(imageFile(d))) continue
      const tile = readFileSync(imageFile(d))
      for (const t of twins.get(d.same_group) || []) {
        if (t !== d && existsSync(imageFile(t)) && readFileSync(imageFile(t)).equals(tile)) { unlinkSync(imageFile(t)); removed++ }
      }
      unlinkSync(imageFile(d))
      removed++
    }
    if (existsSync(last.file)) {
      state.rejected.push(last.hash || hashOf(last.file))
      renameSync(last.file, last.file.replace(/sheet-(\d+)/, 'rejected-$1-' + Date.now()))
    }
    console.log(`Undid sheet ${pad(last.n)}: removed ${removed} images; that image file will not be accepted again.`)
  }
  state.sheets = state.sheets.filter(s => s !== last)
  queue(list, last.n, last.grid || OLD_GRID)
  process.exit(0)
}

if (opts.reslice) {
  for (const s of [...state.sheets].sort((a, b) => a.n - b.n)) {
    const json = join(SHEETS, `sheet-${pad(s.n)}.json`)
    const prompt = existsSync(json) ? JSON.parse(readFileSync(json, 'utf8')).prompt : undefined
    if (existsSync(s.file)) await importSheet({ ...s, prompt }, s.file)
  }
  process.exit(0)
}

// A finished job comes back as one JSON response with every image inlined, and Node can't read one over
// ~500 MB (a 2K sheet is ~14 MB), so larger requests are split into several jobs.
const SHEETS_PER_JOB = { '1K': 80, '2K': 20, '4K': 5 }[SIZE] || 5

if (opts.batch) {
  for (let left = Number(opts.batch); left > 0; left -= SHEETS_PER_JOB) {
    if (!(await submitBatch(Math.min(left, SHEETS_PER_JOB)))) break
  }
  process.exit(0)
}

if (state.batches.length) await checkBatches()

if (state.pending) {
  const generated = opts.api && !opts.file ? await generateSheet() : null
  const file = generated || (opts.file ? resolve(opts.file) : await newestDownload(state.pending.createdAt))
  if (!file) {
    console.log(`Waiting for sheet ${pad(state.pending.n)}: no new 16:9 image in ~/Downloads yet.`)
    announce()
    process.exit(0)
  }
  await importSheet(state.pending, file)
  state.pending = null
  save()
  if (generated) unlinkSync(generated)
}

const next = missing().slice(0, PER_SHEET)
if (!next.length) {
  console.log('🎉 Every dish has an image.')
  process.exit(0)
}
queue(next, nextNumber())
console.log(`(${missing().length} dishes without an image left)`)
