import express, { Router } from 'express'
import { statSync, unlinkSync, renameSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import sharp from 'sharp'
import { randomBytes } from 'crypto'
import db, { DATA_DIR } from '../db.js'
import { slugify } from '../seed.js'
import { deriveTags, composeTags, TAGS, TYPES, EXTRAS } from '../tags.js'
import { CONTINENTS, continentOf } from '../continents.js'
import { cuisineProgress, computeStats, computeBadges } from '../stats.js'
import { currentChallenge } from '../challenge.js'
import { catchUpUntil, setCatchUp } from '../catchup.js'
import { getDiet, setDiet, excludedCount, applyDiet, applyDietAll, EXCLUDED, CONTAINS } from '../diet.js'
import { requireAuth } from '../middleware/auth.js'
import { writeWhite } from '../scripts/lib/whiten.js'
import { fold, compact, didYouMean } from '../search.js'

// Everything here is for the logged-in user (req.user.id, $uid in SQL). Only admins change the catalogue
// (cuisines, regions, dishes, pictures).
const router = Router()
router.use(requireAuth)
const adminOnly = (req, res, next) => (req.user.isAdmin ? next() : res.status(403).json({ error: 'Admins only' }))
const U_JOIN = 'LEFT JOIN user_dishes u ON u.dish_id = d.id AND u.user_id = $uid'

const str = (v, max = 100) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const toId = v => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null)
// Server-local date (TZ env), not UTC, so a dish tried late in the evening gets today's date.
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const EMPTY_USER = { status: null, hidden: 0, tried_on: null, rating: null, note: null, place: null }

const loadUser = (uid, id) => db.prepare('SELECT * FROM user_dishes WHERE user_id = ? AND dish_id = ?').get(uid, id) || { ...EMPTY_USER }

// Only a tried dish has a date and a rating (unticking clears them; undo sends them back).
function saveUser(uid, id, u) {
  if (u.status !== 'tried') {
    u.tried_on = null
    u.rating = null
  }
  const empty = !u.status && !u.hidden && !u.rating && !u.note && !u.place
  if (empty) {
    db.prepare('DELETE FROM user_dishes WHERE user_id = ? AND dish_id = ?').run(uid, id)
    return
  }
  db.prepare(`
    INSERT INTO user_dishes (user_id, dish_id, status, hidden, tried_on, rating, note, place, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, dish_id) DO UPDATE SET status = excluded.status, hidden = excluded.hidden, tried_on = excluded.tried_on,
      rating = excluded.rating, note = excluded.note, place = excluded.place,
      updated_at = excluded.updated_at
  `).run(uid, id, u.status ?? null, u.hidden ? 1 : 0, u.tried_on ?? null, u.rating ?? null, u.note ?? null, u.place ?? null)
}

const userOut = u => ({
  status: u.status, hidden: u.hidden, tried_on: u.tried_on, rating: u.rating, note: u.note, place: u.place,
})

const mtime = path => {
  try { return statSync(path).mtimeMs } catch { return null }
}

// The modification time busts browser and service-worker caches when an image is regenerated.
function imageUrl(file) {
  const t = mtime(join(DATA_DIR, 'images', file))
  return t && `/images/${file}?v=${Math.round(t)}`
}

// White-background copy for list rows; falls back to the original while the copy is missing or outdated.
function whiteImageUrl(file) {
  const t = mtime(join(DATA_DIR, 'images', file))
  const w = t && mtime(join(DATA_DIR, 'images-white', file))
  return t && w >= t ? `/images-white/${file}?v=${Math.round(w)}` : imageUrl(file)
}

// List rows (search, suggestions, wishlist…) show the illustration on white.
// Expects key, slug and cuisine_slug in the row; they're replaced by a single image URL.
const withImage = ({ key, slug, cuisine_slug, ...d }) => ({
  ...d,
  image: whiteImageUrl(`${key || `${cuisine_slug}/${slug}`}.webp`),
})
const IMAGE_COLS = 'd.key, d.slug, c.slug AS cuisine_slug'

// Illustration of a dish, relative to data/images (and data/images-white).
const illustration = d =>
  `${d.key || `${db.prepare('SELECT slug FROM cuisines WHERE id = ?').get(d.cuisine_id).slug}/${d.slug}`}.webp`

function moveIllustration(from, to) {
  if (from === to) return
  for (const dir of ['images', 'images-white']) {
    const src = join(DATA_DIR, dir, from)
    if (!existsSync(src)) continue
    mkdirSync(dirname(join(DATA_DIR, dir, to)), { recursive: true })
    renameSync(src, join(DATA_DIR, dir, to))
  }
}

function removeIllustration(file) {
  for (const dir of ['images', 'images-white']) {
    try { unlinkSync(join(DATA_DIR, dir, file)) } catch { /* none */ }
  }
}

const dishExists = id => id && db.prepare('SELECT 1 FROM dishes WHERE id = ?').get(id)

router.get('/cuisines', (req, res) => res.json(cuisineProgress(req.user.id)))

router.get('/cuisines/:id', (req, res) => {
  const id = toId(req.params.id)
  const cuisine = id && db.prepare('SELECT * FROM cuisines WHERE id = ?').get(id)
  if (!cuisine) return res.status(404).json({ error: 'Not found' })

  const regions = db.prepare('SELECT id, name, is_custom FROM regions WHERE cuisine_id = ? ORDER BY sort, name').all(id)
  const rows = db.prepare(`
    SELECT d.id, d.key, d.region_id, d.slug, d.name, d.emoji, d.tags, d.is_custom, d.description, d.wiki, d.same_group, d.contains,
      u.status, COALESCE(u.hidden, 0) AS hidden, u.tried_on, u.rating, u.note, u.place
    FROM dishes d ${U_JOIN}
    WHERE d.cuisine_id = ? AND (NOT ${EXCLUDED} OR u.status = 'tried') ORDER BY d.sort, d.name
  `).all({ uid: req.user.id }, id)

  // The same dish listed under other cuisines, keyed by group.
  const also = new Map()
  for (const t of db.prepare(`
    SELECT d.id, d.same_group, c.id AS cuisine_id, c.name AS cuisine, c.emoji AS cuisine_emoji
    FROM dishes d JOIN cuisines c ON c.id = d.cuisine_id
    WHERE d.cuisine_id != ? AND d.same_group IN (SELECT same_group FROM dishes WHERE cuisine_id = ? AND same_group IS NOT NULL)
  `).all(id, id)) {
    if (!also.has(t.same_group)) also.set(t.same_group, [])
    also.get(t.same_group).push({ id: t.id, cuisine_id: t.cuisine_id, cuisine: t.cuisine, cuisine_emoji: t.cuisine_emoji })
  }

  const dishes = rows.map(({ same_group, ...d }) => {
    const seedImg = `${d.key || `${cuisine.slug}/${d.slug}`}.webp`
    return {
      ...d,
      also: also.get(same_group) || [],
      tags: JSON.parse(d.tags),
      contains: d.contains ? JSON.parse(d.contains) : null,
      image: imageUrl(seedImg),
    }
  })

  res.json({ ...cuisine, countries: JSON.parse(cuisine.countries), regions, dishes })
})

router.post('/cuisines', adminOnly, (req, res) => {
  const name = str(req.body.name)
  if (!name) return res.status(400).json({ error: 'Name required' })
  const emoji = str(req.body.emoji, 16) || '🍽️'
  const countries = (Array.isArray(req.body.countries) ? req.body.countries : [])
    .filter(c => typeof c === 'string' && /^[A-Za-z]{2}$/.test(c)).map(c => c.toUpperCase())
  const continent = CONTINENTS.includes(req.body.continent) ? req.body.continent : continentOf(countries)
  const slug = slugify(name)
  if (!slug) return res.status(400).json({ error: 'Invalid name' })
  if (db.prepare('SELECT 1 FROM cuisines WHERE slug = ?').get(slug)) {
    return res.status(409).json({ error: 'Cuisine already exists' })
  }
  const r = db.prepare('INSERT INTO cuisines (slug, name, emoji, countries, continent, is_custom) VALUES (?, ?, ?, ?, ?, 1)')
    .run(slug, name, emoji, JSON.stringify(countries), continent)
  res.status(201).json({ id: Number(r.lastInsertRowid) })
})

router.delete('/cuisines/:id', adminOnly, (req, res) => {
  const id = toId(req.params.id)
  const r = db.prepare('DELETE FROM cuisines WHERE id = ? AND is_custom = 1').run(id)
  if (!r.changes) return res.status(404).json({ error: 'Not found or not custom' })
  res.json({ ok: true })
})

router.post('/regions', adminOnly, (req, res) => {
  const cuisineId = toId(req.body.cuisine_id)
  const name = str(req.body.name)
  if (!cuisineId || !name) return res.status(400).json({ error: 'cuisine_id and name required' })
  if (!db.prepare('SELECT 1 FROM cuisines WHERE id = ?').get(cuisineId)) return res.status(404).json({ error: 'Cuisine not found' })
  try {
    const r = db.prepare('INSERT INTO regions (cuisine_id, name, sort, is_custom) VALUES (?, ?, 999, 1)').run(cuisineId, name)
    res.status(201).json({ id: Number(r.lastInsertRowid) })
  } catch {
    res.status(409).json({ error: 'Region already exists' })
  }
})

// Details of a custom dish: tags hold its type and extras (the type is guessed from the name when missing,
// e.g. in an old backup); diet tags follow from contains. contains: null means unknown, [] means none.
function customDetails(b, name, emoji) {
  const contains = Array.isArray(b.contains) ? [...new Set(b.contains.filter(x => CONTAINS.includes(x)))] : null
  const given = Array.isArray(b.tags) ? b.tags : deriveTags(name, emoji)
  const type = given.find(t => TYPES.includes(t)) ?? deriveTags(name, emoji)[0]
  return {
    description: str(b.description, 500) || null,
    tags: JSON.stringify(composeTags(type, given.filter(t => EXTRAS.includes(t)), contains)),
    contains: contains && JSON.stringify(contains),
  }
}

router.post('/dishes', adminOnly, (req, res) => {
  const cuisineId = toId(req.body.cuisine_id)
  const regionId = req.body.region_id == null ? null : toId(req.body.region_id)
  const name = str(req.body.name)
  if (!cuisineId || !name) return res.status(400).json({ error: 'cuisine_id and name required' })
  if (regionId && !db.prepare('SELECT 1 FROM regions WHERE id = ? AND cuisine_id = ?').get(regionId, cuisineId)) {
    return res.status(400).json({ error: 'Invalid region' })
  }
  if (!db.prepare('SELECT 1 FROM cuisines WHERE id = ?').get(cuisineId)) return res.status(404).json({ error: 'Cuisine not found' })
  const slug = slugify(name)
  if (!slug) return res.status(400).json({ error: 'Invalid name' })
  const emoji = str(req.body.emoji, 16) || null
  const { description, tags, contains } = customDetails(req.body, name, emoji)
  try {
    const r = db.prepare(`
      INSERT INTO dishes (cuisine_id, region_id, slug, name, emoji, tags, description, contains, sort, is_custom)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 9999, 1)
    `).run(cuisineId, regionId, slug, name, emoji, tags, description, contains)
    applyDietAll()
    res.status(201).json({ id: Number(r.lastInsertRowid) })
  } catch {
    res.status(409).json({ error: 'Dish already exists' })
  }
})

router.patch('/dishes/:id', adminOnly, (req, res) => {
  const id = toId(req.params.id)
  const d = id && db.prepare('SELECT * FROM dishes WHERE id = ?').get(id)
  if (!d) return res.status(404).json({ error: 'Not found' })

  const b = req.body
  const cuisineId = 'cuisine_id' in b ? toId(b.cuisine_id) : d.cuisine_id
  let regionId = 'region_id' in b ? (b.region_id == null ? null : toId(b.region_id)) : d.region_id
  if (cuisineId !== d.cuisine_id && !('region_id' in b)) regionId = null

  if (!cuisineId || !db.prepare('SELECT 1 FROM cuisines WHERE id = ?').get(cuisineId)) {
    return res.status(400).json({ error: 'Invalid cuisine' })
  }
  if (regionId && !db.prepare('SELECT 1 FROM regions WHERE id = ? AND cuisine_id = ?').get(regionId, cuisineId)) {
    return res.status(400).json({ error: 'Invalid region' })
  }
  const name = 'name' in b ? str(b.name) : d.name
  const slug = slugify(name)
  if (!slug) return res.status(400).json({ error: 'Invalid name' })
  // Seeded dishes get their details from the seed, so only custom dishes can change them.
  const emoji = d.is_custom && 'emoji' in b ? str(b.emoji, 16) || null : d.emoji
  const details = d.is_custom
    ? customDetails({ description: d.description, tags: JSON.parse(d.tags), contains: JSON.parse(d.contains || 'null'), ...b }, name, emoji)
    : { description: d.description, tags: d.tags, contains: d.contains }
  try {
    db.prepare(`
      UPDATE dishes SET cuisine_id = ?, region_id = ?, name = ?, slug = ?, emoji = ?, description = ?, tags = ?, contains = ?, moved = 1
      WHERE id = ?
    `).run(cuisineId, regionId, name, slug, emoji, details.description, details.tags, details.contains, id)
  } catch {
    return res.status(409).json({ error: 'A dish with this name already exists there' })
  }
  // A custom dish's picture lives under its cuisine and name, so it follows a rename or move.
  if (d.is_custom) moveIllustration(illustration(d), illustration({ ...d, cuisine_id: cuisineId, slug }))
  applyDietAll()
  res.json({ ok: true, emoji, description: details.description, tags: JSON.parse(details.tags), contains: JSON.parse(details.contains || 'null') })
})

router.delete('/dishes/:id', adminOnly, (req, res) => {
  const id = toId(req.params.id)
  const d = db.prepare('SELECT * FROM dishes WHERE id = ? AND is_custom = 1').get(id)
  const r = db.prepare('DELETE FROM dishes WHERE id = ? AND is_custom = 1').run(id)
  if (!r.changes) return res.status(404).json({ error: 'Not found or not custom' })
  removeIllustration(illustration(d))
  res.json({ ok: true })
})

router.patch('/dishes/:id/user', (req, res) => {
  const id = toId(req.params.id)
  if (!dishExists(id)) return res.status(404).json({ error: 'Not found' })

  const b = req.body
  const uid = req.user.id
  const next = { ...loadUser(uid, id) }

  if ('status' in b) {
    if (b.status !== null && b.status !== 'tried' && b.status !== 'wishlist') return res.status(400).json({ error: 'Invalid status' })
    next.status = b.status
  }
  if ('hidden' in b) next.hidden = b.hidden ? 1 : 0
  if ('tried_on' in b) {
    if (b.tried_on !== null && !validDate(b.tried_on)) return res.status(400).json({ error: 'Invalid date' })
    next.tried_on = b.tried_on
  }
  if ('rating' in b) {
    if (b.rating !== null && !(Number.isInteger(b.rating) && b.rating >= 1 && b.rating <= 5)) return res.status(400).json({ error: 'Invalid rating' })
    next.rating = b.rating
  }
  if ('note' in b) next.note = str(b.note, 1000) || null
  if ('place' in b) next.place = str(b.place, 200) || null

  if (next.status === 'tried' && !next.tried_on && !catchUpUntil(uid)) next.tried_on = today()

  saveUser(uid, id, next)
  res.json({ ...userOut(next), synced: SYNCED_FIELDS.some(f => f in b) ? syncTwins(uid, id, next) : [] })
})

// Trying a dish under one cuisine counts for the same dish everywhere it is listed.
const SYNCED_FIELDS = ['status', 'tried_on', 'rating']
function syncTwins(uid, id, next) {
  const twins = db.prepare(`
    SELECT d.id, c.id AS cuisine_id, c.name AS cuisine, c.emoji AS cuisine_emoji
    FROM dishes d JOIN cuisines c ON c.id = d.cuisine_id
    WHERE d.same_group = (SELECT same_group FROM dishes WHERE id = ?) AND d.id != ?
  `).all(id, id)
  for (const t of twins) {
    saveUser(uid, t.id, { ...loadUser(uid, t.id), status: next.status, tried_on: next.tried_on, rating: next.rating })
  }
  return twins
}

// Groups linked after one of their dishes was tried (or restored from a backup holding only one of them)
// catch up on start and after an import: their untried dishes take the earliest tried one's date and rating.
export function syncAllTwins(uid = null) {
  const tried = db.prepare(`
    SELECT u.user_id, u.dish_id, u.tried_on, u.rating, d.same_group FROM user_dishes u JOIN dishes d ON d.id = u.dish_id
    WHERE u.status = 'tried' AND d.same_group IS NOT NULL AND ($uid IS NULL OR u.user_id = $uid) ORDER BY u.tried_on
  `).all({ uid })
  const members = db.prepare('SELECT id FROM dishes WHERE same_group = ?')
  const done = new Set()
  for (const t of tried) {
    if (done.has(`${t.user_id} ${t.same_group}`)) continue
    done.add(`${t.user_id} ${t.same_group}`)
    for (const { id } of members.all(t.same_group)) {
      const u = loadUser(t.user_id, id)
      if (u.status !== 'tried') saveUser(t.user_id, id, { ...u, status: 'tried', tried_on: t.tried_on, rating: t.rating })
    }
  }
}

// A real calendar date, at most a day ahead of the server (the browser may be in a later timezone).
function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !isNaN(d) && d.toISOString().slice(0, 10) === s && d <= new Date(`${today()}T00:00:00Z`).getTime() + DAY_MS
}
const DAY_MS = 86400000

const imageType = buf => {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.length > 12 && buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'png'
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  return null
}

// The illustration of your own dish (e.g. made with an AI image tool), stored like the seeded ones:
// 800×600 WebP, plus the white-background copy for lists.
router.post('/dishes/:id/image', adminOnly, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '8mb' }), async (req, res) => {
  const id = toId(req.params.id)
  const d = id && db.prepare('SELECT * FROM dishes WHERE id = ? AND is_custom = 1').get(id)
  if (!d) return res.status(404).json({ error: 'Not found or not custom' })
  if (!Buffer.isBuffer(req.body) || !imageType(req.body)) return res.status(400).json({ error: 'JPEG, PNG or WebP image required' })
  const file = illustration(d)
  try {
    mkdirSync(dirname(join(DATA_DIR, 'images', file)), { recursive: true })
    await sharp(req.body, { limitInputPixels: 50_000_000 }).rotate().resize(800, 600, { fit: 'cover' }).webp({ quality: 82 }).toFile(join(DATA_DIR, 'images', file))
    await writeWhite(DATA_DIR, file)
  } catch {
    return res.status(400).json({ error: 'Could not read that image' })
  }
  res.json({ image: imageUrl(file) })
})

router.delete('/dishes/:id/image', adminOnly, (req, res) => {
  const id = toId(req.params.id)
  const d = id && db.prepare('SELECT * FROM dishes WHERE id = ? AND is_custom = 1').get(id)
  if (!d) return res.status(404).json({ error: 'Not found or not custom' })
  removeIllustration(illustration(d))
  res.json({ image: null })
})

// Ranks a dish for query q: exact name, then exact other name (aka), names starting with q, other names starting
// with q, names containing it, other names containing it, and last the rest. "Ramen (Miso)" counts as named
// "Ramen (Miso)", "Ramen" and "Miso".
function nameRank(d, q) {
  const own = [d.name, ...d.name.split(/\s*[()]\s*/)].map(compact)
  const aka = (d.aka ? JSON.parse(d.aka) : []).map(compact)
  const tests = [n => n === q, n => n.startsWith(q), n => n.includes(q)]
  for (const [i, test] of tests.entries()) {
    if (own.some(test)) return 2 * i
    if (aka.some(test)) return 2 * i + 1
  }
  return 6
}

// Matches dish names and other names (aka) first, then cuisine names and descriptions (so "lamb" or "Korean" work too),
// ignoring accents and spacing. When no dish name matches, didYouMean lists names with a similar spelling.
router.get('/search', (req, res) => {
  const q = str(req.query.q, 60)
  // ?tags=dessert,vegan: every tag must match (at most one per group in the app).
  const tags = String(req.query.tags || '').split(',').filter(t => TAGS.includes(t))
  const name = q.length >= 2 ? compact(q) : ''
  if (!name && !tags.length) return res.json({ results: [], didYouMean: [] })
  // fold() and compact() leave only letters, digits and spaces, so the patterns need no escaping.
  const nameLike = `%${name}%`
  const visible = `COALESCE(u.hidden, 0) = 0 AND (NOT ${EXCLUDED} OR u.status = 'tried')
    ${tags.map(() => 'AND d.tags LIKE ?').join(' ')}`
  const tagParams = tags.map(t => `%"${t}"%`)
  const results = db.prepare(`
    SELECT d.id, d.name, d.aka, d.emoji, d.description, d.cuisine_id, c.name AS cuisine, c.emoji AS cuisine_emoji, u.status,
      ${IMAGE_COLS}
    FROM dishes d JOIN cuisines c ON c.id = d.cuisine_id
    ${U_JOIN}
    WHERE ${visible}
      AND (? = '' OR compact(d.name) LIKE ? OR compact(d.aka) LIKE ? OR compact(c.name) LIKE ? OR fold(d.description) LIKE ?)
    ORDER BY compact(d.name) LIKE ? OR compact(d.aka) LIKE ? DESC, d.name LIMIT 150
  `).all({ uid: req.user.id }, ...tagParams, name, nameLike, nameLike, nameLike, `%${fold(q)}%`, nameLike, nameLike)
  if (name) results.sort((a, b) => nameRank(a, name) - nameRank(b, name))
  const nameHit = name && results.length && nameRank(results[0], name) < 6
  const candidates = name && !nameHit
    ? db.prepare(`SELECT d.name, d.aka, d.sort FROM dishes d ${U_JOIN} WHERE ${visible}`).all({ uid: req.user.id }, ...tagParams)
    : []
  res.json({ results: results.map(({ aka, ...r }) => withImage(r)), didYouMean: didYouMean(q, candidates) })
})

const SUGGEST_SELECT = `
  SELECT d.id, d.name, d.emoji, d.description, d.cuisine_id, c.name AS cuisine, c.emoji AS cuisine_emoji, u.status,
    ${IMAGE_COLS}
  FROM dishes d JOIN cuisines c ON c.id = d.cuisine_id
  ${U_JOIN}
`
const OPEN = `COALESCE(u.hidden, 0) = 0 AND NOT ${EXCLUDED} AND COALESCE(u.status, '') != 'tried'`

router.get('/suggest', (req, res) => {
  const mode = ['random', 'close', 'new', 'wishlist'].includes(req.query.mode) ? req.query.mode : 'random'
  const progress = cuisineProgress(req.user.id)
  let ids = null

  if (mode === 'close') {
    const close = progress.filter(c => c.tried > 0 && c.tried < c.total)
      .sort((a, b) => b.tried / b.total - a.tried / a.total)
    ids = close.slice(0, 3).map(c => c.id)
  } else if (mode === 'new') {
    ids = progress.filter(c => c.tried === 0 && c.total > 0).map(c => c.id)
  }
  if (ids && !ids.length) return res.json(null)

  const where = [OPEN]
  const params = []
  if (mode === 'wishlist') where.push(`u.status = 'wishlist'`)
  if (ids) { where.push(`d.cuisine_id IN (${ids.map(() => '?').join(',')})`); params.push(...ids) }

  const row = db.prepare(`${SUGGEST_SELECT} WHERE ${where.join(' AND ')} ORDER BY (u.status = 'wishlist') DESC, RANDOM() LIMIT 1`).get({ uid: req.user.id }, ...params)
  res.json(row ? withImage(row) : null)
})

const LIST_SELECT = `
  SELECT d.id, d.name, d.emoji, d.description, c.id AS cuisine_id, c.name AS cuisine, c.emoji AS cuisine_emoji,
    u.status, u.tried_on, u.rating, u.place, ${IMAGE_COLS}
  FROM user_dishes u JOIN dishes d ON d.id = u.dish_id JOIN cuisines c ON c.id = d.cuisine_id
  WHERE u.user_id = $uid
`
const list = (req, where) => db.prepare(`${LIST_SELECT} AND ${where}`).all({ uid: req.user.id }).map(withImage)

router.get('/favorites', (req, res) => {
  res.json(list(req, `u.rating >= 4 AND u.status = 'tried' AND u.hidden = 0 ORDER BY u.rating DESC, u.tried_on DESC LIMIT 50`))
})

router.get('/wishlist', (req, res) => {
  res.json(list(req, `u.status = 'wishlist' AND u.hidden = 0 AND NOT ${EXCLUDED} ORDER BY c.name, d.sort, d.name`))
})

router.get('/hidden', (req, res) => {
  res.json(list(req, 'u.hidden = 1 ORDER BY c.name, d.name'))
})

router.get('/stats', (req, res) => {
  const stats = computeStats(req.user.id)
  res.json({ stats, badges: computeBadges(stats, req.user.id) })
})

router.get('/diet', (req, res) => res.json({ ...getDiet(req.user.id), excluded: excludedCount(req.user.id) }))

router.put('/diet', (req, res) => res.json({ ...setDiet(req.user.id, req.body || {}), excluded: excludedCount(req.user.id) }))

router.get('/challenge', (req, res) => {
  const ch = currentChallenge(req.user.id)
  res.json({ ...ch, dishes: ch.dishes.map(withImage) })
})

router.post('/catch-up', (req, res) => res.json({ catchUpUntil: setCatchUp(req.user.id, !!req.body?.on) }))

router.get('/activity', (req, res) => {
  const recent = db.prepare(`
    SELECT d.id, d.name, d.emoji, c.id AS cuisine_id, c.name AS cuisine, c.emoji AS cuisine_emoji, u.tried_on, u.rating,
      ${IMAGE_COLS}
    FROM user_dishes u JOIN dishes d ON d.id = u.dish_id JOIN cuisines c ON c.id = d.cuisine_id
    WHERE u.user_id = ? AND u.status = 'tried' AND u.hidden = 0
    ORDER BY u.tried_on DESC, u.updated_at DESC LIMIT 100
  `).all(req.user.id).map(withImage)
  const months = db.prepare(`
    SELECT substr(tried_on, 1, 7) AS month, COUNT(*) AS n FROM user_dishes
    WHERE user_id = ? AND status = 'tried' AND hidden = 0 AND tried_on IS NOT NULL
    GROUP BY month ORDER BY month DESC LIMIT 12
  `).all(req.user.id).reverse()
  res.json({ recent, months })
})

router.get('/share', (req, res) => {
  const row = db.prepare('SELECT token FROM shares WHERE user_id = ?').get(req.user.id)
  res.json({ token: row?.token ?? null })
})

router.post('/share', (req, res) => {
  const token = randomBytes(24).toString('hex')
  db.prepare(`
    INSERT INTO shares (user_id, token, created_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET token = excluded.token, created_at = excluded.created_at
  `).run(req.user.id, token)
  res.json({ token })
})

router.delete('/share', (req, res) => {
  db.prepare('DELETE FROM shares WHERE user_id = ?').run(req.user.id)
  res.json({ ok: true })
})

// A friend asking for a dish that isn't in the app yet; admins see these in the Users tab.
router.post('/suggestions', (req, res) => {
  const name = str(req.body.name)
  if (!name) return res.status(400).json({ error: 'Name required' })
  const open = db.prepare("SELECT COUNT(*) AS n FROM suggestions WHERE user_id = ? AND status = 'open'").get(req.user.id).n
  if (open >= 30) return res.status(429).json({ error: 'You have many open suggestions already; wait until they’re handled' })
  const cuisineId = toId(req.body.cuisine_id)
  db.prepare(`
    INSERT INTO suggestions (user_id, cuisine_id, name, note, created_at) VALUES (?, ?, ?, ?, datetime('now'))
  `).run(req.user.id, cuisineId && dishCuisineExists(cuisineId) ? cuisineId : null, name, str(req.body.note, 300) || null)
  res.status(201).json({ ok: true })
})
const dishCuisineExists = id => db.prepare('SELECT 1 FROM cuisines WHERE id = ?').get(id)

// Your own progress and settings; for admins also the catalogue additions and edits.
router.get('/export', (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="foodio-backup.json"')
  const catalogue = req.user.isAdmin && {
    cuisines: db.prepare('SELECT slug, name, emoji, countries, continent FROM cuisines WHERE is_custom = 1').all()
      .map(c => ({ ...c, countries: JSON.parse(c.countries) })),
    regions: db.prepare('SELECT c.slug AS cuisine, r.name FROM regions r JOIN cuisines c ON c.id = r.cuisine_id WHERE r.is_custom = 1').all(),
    dishes: db.prepare(`
      SELECT c.slug AS cuisine, r.name AS region, d.name, d.emoji, d.description, d.tags, d.contains
      FROM dishes d JOIN cuisines c ON c.id = d.cuisine_id LEFT JOIN regions r ON r.id = d.region_id
      WHERE d.is_custom = 1`).all().map(d => ({ ...d, tags: JSON.parse(d.tags), contains: JSON.parse(d.contains || 'null') })),
    moved: db.prepare(`
      SELECT d.key, c.slug AS cuisine, r.name AS region, d.name
      FROM dishes d JOIN cuisines c ON c.id = d.cuisine_id LEFT JOIN regions r ON r.id = d.region_id
      WHERE d.moved = 1 AND d.key IS NOT NULL`).all(),
  }
  res.json({
    version: 2,
    ...catalogue,
    user: db.prepare(`
      SELECT COALESCE(d.key, 'custom:' || c.slug || '/' || d.slug) AS ref,
        u.status, u.hidden, u.tried_on, u.rating, u.note, u.place
      FROM user_dishes u JOIN dishes d ON d.id = u.dish_id JOIN cuisines c ON c.id = d.cuisine_id
      WHERE u.user_id = ?`).all(req.user.id),
    diet: getDiet(req.user.id),
  })
})

// Catalogue parts are only taken from an admin's import; everyone gets their own progress back.
router.post('/import', (req, res) => {
  const b = req.body
  if (!b || b.version !== 2) return res.status(400).json({ error: 'Invalid backup' })
  const uid = req.user.id
  const arr = v => (Array.isArray(v) && req.user.isAdmin ? v : [])
  const mine = Array.isArray(b.user) ? b.user : []
  const cid = db.prepare('SELECT id FROM cuisines WHERE slug = ?')
  const rid = db.prepare('SELECT id FROM regions WHERE cuisine_id = ? AND name = ?')
  const byKey = db.prepare('SELECT id, name FROM dishes WHERE key = ?')
  const byCustom = db.prepare('SELECT d.id FROM dishes d JOIN cuisines c ON c.id = d.cuisine_id WHERE c.slug = ? AND d.slug = ?')

  db.exec('BEGIN')
  try {
    for (const c of arr(b.cuisines)) {
      const countries = arr(c.countries).filter(x => typeof x === 'string' && /^[A-Za-z]{2}$/.test(x))
      db.prepare('INSERT OR IGNORE INTO cuisines (slug, name, emoji, countries, continent, is_custom) VALUES (?, ?, ?, ?, ?, 1)')
        .run(slugify(str(c.name)), str(c.name), str(c.emoji, 16) || '🍽️', JSON.stringify(countries),
          CONTINENTS.includes(c.continent) ? c.continent : continentOf(countries))
    }
    for (const r of arr(b.regions)) {
      const c = cid.get(str(r.cuisine))
      if (c) db.prepare('INSERT OR IGNORE INTO regions (cuisine_id, name, sort, is_custom) VALUES (?, ?, 999, 1)').run(c.id, str(r.name))
    }
    for (const d of arr(b.dishes)) {
      const c = cid.get(str(d.cuisine))
      if (!c || !str(d.name)) continue
      const reg = d.region ? rid.get(c.id, str(d.region)) : null
      const emoji = d.emoji ? str(d.emoji, 16) : null
      const details = customDetails(d, str(d.name), emoji)
      db.prepare(`
        INSERT OR IGNORE INTO dishes (cuisine_id, region_id, slug, name, emoji, tags, description, contains, sort, is_custom)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 9999, 1)
      `).run(c.id, reg?.id ?? null, slugify(str(d.name)), str(d.name), emoji, details.tags, details.description, details.contains)
    }
    for (const m of arr(b.moved)) {
      const dish = byKey.get(str(m.key, 200))
      const c = cid.get(str(m.cuisine))
      if (!dish || !c) continue
      const reg = m.region ? rid.get(c.id, str(m.region)) : null
      const name = str(m.name) || dish.name
      try {
        db.prepare('UPDATE dishes SET cuisine_id = ?, region_id = ?, name = ?, slug = ?, moved = 1 WHERE id = ?')
          .run(c.id, reg?.id ?? null, name, slugify(name), dish.id)
      } catch { /* name clash at target, keep current location */ }
    }
    for (const u of mine) {
      const ref = str(u.ref, 200)
      let dish
      if (ref.startsWith('custom:')) {
        const [cs, ds] = ref.slice(7).split('/')
        dish = byCustom.get(cs, ds)
      } else {
        dish = byKey.get(ref)
      }
      if (!dish) continue
      const next = {
        status: u.status === 'tried' || u.status === 'wishlist' ? u.status : null,
        hidden: u.hidden ? 1 : 0,
        tried_on: validDate(u.tried_on) ? u.tried_on : null,
        rating: Number.isInteger(u.rating) && u.rating >= 1 && u.rating <= 5 ? u.rating : null,
        note: str(u.note, 1000) || null,
        place: str(u.place, 200) || null,
      }
      saveUser(uid, dish.id, next)
    }
    syncAllTwins(uid)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  if (req.user.isAdmin) applyDietAll()
  if (b.diet) setDiet(uid, b.diet)
  else applyDiet(uid)
  res.json({ ok: true })
})

export default router
