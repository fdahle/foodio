import db from './db.js'

// What a seeded dish usually contains (seed/contains.json); custom dishes have no list and are never excluded.
export const CONTAINS = ['meat', 'pork', 'poultry', 'fish', 'shellfish', 'egg', 'dairy', 'gluten', 'nuts', 'peanuts', 'soy', 'sesame', 'alcohol', 'honey']

const FLESH = ['meat', 'pork', 'poultry', 'fish', 'shellfish']
export const DIETS = {
  all: [],
  pescatarian: ['meat', 'pork', 'poultry'],
  vegetarian: FLESH,
  vegan: [...FLESH, 'egg', 'dairy', 'honey'],
}

// Diet tags of a dish from its contains list (none when unknown). Surf and turf is both meat and seafood.
// Minor ingredients (fish sauce, dashi, stock, lard) still rule out vegetarian but don't make a meat or seafood dish.
export function dietTags(contains, minor = []) {
  if (!contains) return []
  const has = (list, from = contains) => from.some(c => list.includes(c))
  const main = contains.filter(c => !minor.includes(c))
  const tags = []
  if (has(['meat', 'pork', 'poultry'], main)) tags.push('meat')
  if (has(['fish', 'shellfish'], main)) tags.push('seafood')
  if (!has(FLESH)) tags.push('vegetarian')
  if (tags[0] === 'vegetarian' && !has(['egg', 'dairy', 'honey'])) tags.push('vegan')
  return tags
}

const DEFAULT = { diet: 'all', avoid: [] }

export function getDiet(uid) {
  const row = db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'diet'").get(uid)
  try {
    return row ? { ...DEFAULT, ...JSON.parse(row.value) } : { ...DEFAULT }
  } catch {
    return { ...DEFAULT }
  }
}

export function setDiet(uid, { diet, avoid }) {
  const next = {
    diet: diet in DIETS ? diet : 'all',
    avoid: [...new Set((Array.isArray(avoid) ? avoid : []).filter(a => CONTAINS.includes(a)))],
  }
  db.prepare(`
    INSERT INTO user_settings (user_id, key, value) VALUES (?, 'diet', ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
  `).run(uid, JSON.stringify(next))
  applyDiet(uid)
  return next
}

// Lists the dishes that don't fit someone's diet in user_excluded. Queries treat them like hidden dishes,
// except ones already tried, so changing your diet never takes away progress.
export function applyDiet(uid) {
  const { diet, avoid } = getDiet(uid)
  const banned = [...new Set([...DIETS[diet], ...avoid])]
  db.prepare('DELETE FROM user_excluded WHERE user_id = ?').run(uid)
  if (!banned.length) return
  db.prepare(`
    INSERT INTO user_excluded (user_id, dish_id)
    SELECT ?, d.id FROM dishes d
    WHERE d.contains IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(d.contains) WHERE value IN (${banned.map(() => '?').join(',')}))
  `).run(uid, ...banned)
}

// After the catalogue changes (seed, a dish added or edited).
export function applyDietAll() {
  for (const { id } of db.prepare('SELECT id FROM users').all()) applyDiet(id)
}

// SQL: the dish d doesn't fit the diet of user $uid.
export const EXCLUDED = 'EXISTS (SELECT 1 FROM user_excluded x WHERE x.user_id = $uid AND x.dish_id = d.id)'

export const excludedCount = uid =>
  db.prepare(`
    SELECT COUNT(*) AS n FROM user_excluded x LEFT JOIN user_dishes u ON u.user_id = x.user_id AND u.dish_id = x.dish_id
    WHERE x.user_id = ? AND COALESCE(u.status, '') != 'tried'
  `).get(uid).n
