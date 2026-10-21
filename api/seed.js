import { readdirSync, readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import db from './db.js'
import { continentOf } from './continents.js'
import { deriveTags, composeTags, TYPES, EXTRAS } from './tags.js'

const SEED_DIR = join(dirname(fileURLToPath(import.meta.url)), 'seed')

export function slugify(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// Dish entries are "Name", "Name|emoji" or { name, aka, emoji, desc, wiki, tags }; aka lists other names, only for search.
function parseDish(entry) {
  if (typeof entry === 'string') {
    const [name, emoji] = entry.split('|')
    return { name: name.trim(), emoji: emoji?.trim() || null }
  }
  return {
    name: entry.name.trim(),
    aka: Array.isArray(entry.aka) && entry.aka.length ? entry.aka : null,
    emoji: entry.emoji || null,
    desc: entry.desc || null,
    wiki: entry.wiki || null,
    tags: Array.isArray(entry.tags) ? entry.tags : null,
  }
}

const readJson = (file, fallback) =>
  existsSync(join(SEED_DIR, file)) ? JSON.parse(readFileSync(join(SEED_DIR, file), 'utf8')) : fallback

// Idempotent sync of the seed into the database:
// - renamed.json ({ oldKey: newKey }) moves keys first, so progress follows a renamed or re-homed dish
// - seeded dishes are inserted or refreshed; dishes the user moved keep their location
// - seeded dishes dropped from the seed are deleted unless they carry user data
// - same-dishes.json ([[key, key, ...]]) links the same dish across cuisines
// - types.json ({ key: 'main' }) gives each dish its one type; the seed files' tags only add extras (spicy, street)
// - contains.json ({ key: ['dairy', 'gluten', ...] }) says what a dish usually contains, which decides its diet tags
// - minor.json ({ key: ['fish'] }) marks contents that are only seasoning, stock or fat, so they don't earn a meat or seafood tag
export function seed() {
  const files = readdirSync(SEED_DIR).filter(f => /^\d+.*\.json$/.test(f)).sort()
  const renamed = readJson('renamed.json', {})
  const groups = readJson('same-dishes.json', [])
  const contains = readJson('contains.json', {})
  const minor = readJson('minor.json', {})
  const types = readJson('types.json', {})

  const getCuisine = db.prepare('SELECT id FROM cuisines WHERE slug = ?')
  const insCuisine = db.prepare('INSERT INTO cuisines (slug, name, emoji, countries, continent) VALUES (?, ?, ?, ?, ?)')
  const updCuisine = db.prepare('UPDATE cuisines SET name = ?, emoji = ?, countries = ?, continent = ? WHERE id = ? AND is_custom = 0')
  const getRegion = db.prepare('SELECT id FROM regions WHERE cuisine_id = ? AND name = ?')
  const insRegion = db.prepare('INSERT INTO regions (cuisine_id, name, sort) VALUES (?, ?, ?)')
  const updRegionSort = db.prepare('UPDATE regions SET sort = ? WHERE id = ?')
  const byKey = db.prepare('SELECT id, moved FROM dishes WHERE key = ?')
  const renameKey = db.prepare('UPDATE dishes SET key = ? WHERE key = ?')
  const insDish = db.prepare(`
    INSERT OR IGNORE INTO dishes (key, cuisine_id, region_id, slug, name, emoji, tags, sort, description, wiki, contains, aka)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const updInfo = db.prepare('UPDATE dishes SET emoji = ?, tags = ?, description = ?, wiki = ?, contains = ?, aka = ? WHERE id = ?')
  const updPlace = db.prepare('UPDATE dishes SET cuisine_id = ?, region_id = ?, slug = ?, name = ?, sort = ? WHERE id = ?')

  db.exec('BEGIN')
  try {
    for (const [from, to] of Object.entries(renamed)) {
      if (!byKey.get(to)) renameKey.run(to, from)
    }

    const seen = new Set()
    for (const file of files) {
      for (const c of JSON.parse(readFileSync(join(SEED_DIR, file), 'utf8'))) {
        const slug = slugify(c.name)
        const countries = c.countries || []
        let row = getCuisine.get(slug)
        if (row) {
          updCuisine.run(c.name, c.emoji, JSON.stringify(countries), continentOf(countries), row.id)
        } else {
          const r = insCuisine.run(slug, c.name, c.emoji, JSON.stringify(countries), continentOf(countries))
          row = { id: Number(r.lastInsertRowid) }
        }
        c.regions.forEach((reg, ri) => {
          let region = getRegion.get(row.id, reg.name)
          if (region) updRegionSort.run(ri, region.id)
          else region = { id: Number(insRegion.run(row.id, reg.name, ri).lastInsertRowid) }

          reg.dishes.forEach((entry, di) => {
            const d = parseDish(entry)
            const dslug = slugify(d.name)
            const key = `${slug}/${dslug}`
            const has = contains[key] ?? null
            const old = d.tags ?? deriveTags(d.name, d.emoji)
            const type = types[key] ?? old.find(t => TYPES.includes(t)) ?? deriveTags(d.name, d.emoji)[0]
            const tags = JSON.stringify(composeTags(type, old.filter(t => EXTRAS.includes(t)), has, minor[key]))
            const hasJson = has && JSON.stringify(has)
            const aka = d.aka && JSON.stringify(d.aka)
            seen.add(key)
            const existing = byKey.get(key)
            if (!existing) {
              insDish.run(key, row.id, region.id, dslug, d.name, d.emoji, tags, di, d.desc ?? null, d.wiki ?? null, hasJson, aka)
              return
            }
            updInfo.run(d.emoji, tags, d.desc ?? null, d.wiki ?? null, hasJson, aka, existing.id)
            if (!existing.moved) {
              try { updPlace.run(row.id, region.id, dslug, d.name, di, existing.id) } catch { /* slug clash with a custom dish */ }
            }
          })
        })
      }
    }

    const stale = db.prepare(`
      SELECT d.id, d.key FROM dishes d LEFT JOIN user_dishes u ON u.dish_id = d.id
      WHERE d.is_custom = 0 AND d.key IS NOT NULL AND u.dish_id IS NULL
    `).all().filter(d => !seen.has(d.key))
    const del = db.prepare('DELETE FROM dishes WHERE id = ?')
    for (const d of stale) del.run(d.id)

    db.exec('UPDATE dishes SET same_group = NULL WHERE is_custom = 0')
    const setGroup = db.prepare('UPDATE dishes SET same_group = ? WHERE key = ?')
    for (const g of groups) {
      const keys = g.filter(k => byKey.get(k))
      if (keys.length > 1) for (const k of keys) setGroup.run(keys[0], k)
    }

    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
