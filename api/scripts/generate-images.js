// Generates one image per dish in a consistent style and stores it where the API looks for it:
//   data/images/<cuisine-slug>/<dish-slug>.webp   (seeded dishes use their original seed key)
//
// Usage (from the repo root):
//   npm --prefix api run images -- --dry-run            list what would be generated
//   npm --prefix api run images -- --limit 10           generate the first 10 missing images
//   npm --prefix api run images -- --cuisine german     only one cuisine
//   npm --prefix api run images -- --force              regenerate existing images too
//
// Needs OPENAI_API_KEY in .env. To use another image API, replace generate() below.
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { parseArgs } from 'util'

config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env') })

const { default: db, DATA_DIR } = await import('../db.js')
const { seed } = await import('../seed.js')

const { values: opts } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    limit: { type: 'string' },
    cuisine: { type: 'string' },
    concurrency: { type: 'string', default: '3' },
  },
})

const STYLE = 'Overhead food photograph, 45-degree angle, served on a plain light ceramic plate on a pale wooden table, '
  + 'soft natural daylight, shallow depth of field, appetising and authentic, no text, no people, no hands.'

const MODEL = process.env.IMAGE_MODEL || 'gpt-image-1'

async function generate(prompt) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: MODEL, prompt, n: 1, size: '1536x1024',
      quality: process.env.IMAGE_QUALITY || 'low', output_format: 'webp', output_compression: 80,
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error?.message || `HTTP ${res.status}`)
  return Buffer.from(body.data[0].b64_json, 'base64')
}

seed()

const rows = db.prepare(`
  SELECT d.key, d.slug, d.name, d.description, c.slug AS cuisine_slug, c.name AS cuisine
  FROM dishes d JOIN cuisines c ON c.id = d.cuisine_id
  ${opts.cuisine ? 'WHERE c.slug = ?' : ''}
  ORDER BY c.name, d.sort, d.name
`).all(...(opts.cuisine ? [opts.cuisine] : []))

const jobs = rows
  .map(d => ({ ...d, file: join(DATA_DIR, 'images', `${d.key || `${d.cuisine_slug}/${d.slug}`}.webp`) }))
  .filter(d => opts.force || !existsSync(d.file))
  .slice(0, opts.limit ? Number(opts.limit) : undefined)

console.log(`${rows.length} dishes, ${jobs.length} image${jobs.length === 1 ? '' : 's'} to generate`)
if (opts['dry-run']) {
  for (const j of jobs) console.log(`  ${j.cuisine}: ${j.name} -> ${j.file}`)
  process.exit(0)
}
if (jobs.length && !process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set (add it to .env).')
  process.exit(1)
}

let done = 0
let failed = 0
async function worker() {
  for (let job = jobs.shift(); job; job = jobs.shift()) {
    try {
      const what = job.description ? ` (${job.description})` : ''
      const img = await generate(`${job.name}${what}, a dish from ${job.cuisine} cuisine. ${STYLE}`)
      mkdirSync(dirname(job.file), { recursive: true })
      writeFileSync(job.file, img)
      done++
      console.log(`✓ ${job.cuisine}: ${job.name}`)
    } catch (err) {
      failed++
      console.error(`✗ ${job.cuisine}: ${job.name} (${err.message})`)
    }
  }
}
await Promise.all(Array.from({ length: Math.max(1, Number(opts.concurrency)) }, worker))
console.log(`Done: ${done} generated, ${failed} failed.`)
