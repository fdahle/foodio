import db from './db.js'
import { EXCLUDED } from './diet.js'
// One theme per calendar month.
const THEMES = ['soup', 'dessert', 'vegetarian', 'street', 'noodles', 'seafood', 'drink', 'spicy', 'snack', 'bread', 'vegan', 'deli']

// Server-local time (set TZ in the container) so the challenge rolls over at local midnight.
const month = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Everyone gets the same theme in a month, but their own three dishes (fitting their diet and not tried yet,
// and never the same dish listed under two cuisines).
function pickDishes(uid, tag) {
  const candidates = shuffle(db.prepare(`
    SELECT d.id, COALESCE(d.same_group, 'id:' || d.id) AS dish, c.continent FROM dishes d
    JOIN cuisines c ON c.id = d.cuisine_id
    LEFT JOIN user_dishes u ON u.dish_id = d.id AND u.user_id = $uid
    WHERE d.tags LIKE ? AND COALESCE(u.hidden, 0) = 0 AND NOT ${EXCLUDED} AND COALESCE(u.status, '') != 'tried'
  `).all({ uid }, `%"${tag}"%`))

  const picked = []
  const continents = new Set()
  const dishes = new Set()
  const take = c => { picked.push(c.id); continents.add(c.continent); dishes.add(c.dish) }
  for (const c of candidates) {
    if (picked.length === 3) break
    if (!continents.has(c.continent) && !dishes.has(c.dish)) take(c)
  }
  for (const c of candidates) {
    if (picked.length === 3) break
    if (!dishes.has(c.dish)) take(c)
  }
  return picked
}

function createChallenge(uid, m) {
  const tag = THEMES[Number(m.slice(5, 7)) - 1]
  const picked = JSON.stringify(pickDishes(uid, tag))
  db.prepare('INSERT INTO user_challenges (user_id, month, tag, dish_ids) VALUES (?, ?, ?, ?)').run(uid, m, tag, picked)
  return { month: m, tag, dish_ids: picked }
}

export function currentChallenge(uid) {
  const m = month()
  const row = db.prepare('SELECT * FROM user_challenges WHERE user_id = ? AND month = ?').get(uid, m) || createChallenge(uid, m)
  // Nothing fitted (e.g. a vegan in the seafood month): try again, the diet or the catalogue may have changed.
  if (row.dish_ids === '[]') {
    row.dish_ids = JSON.stringify(pickDishes(uid, row.tag))
    if (row.dish_ids !== '[]') db.prepare('UPDATE user_challenges SET dish_ids = ? WHERE user_id = ? AND month = ?').run(row.dish_ids, uid, m)
  }
  const ids = JSON.parse(row.dish_ids)
  const dishes = ids.length
    ? db.prepare(`
        SELECT d.id, d.name, d.emoji, d.description, c.id AS cuisine_id, c.name AS cuisine, c.emoji AS cuisine_emoji, c.continent, u.status,
          d.key, d.slug, c.slug AS cuisine_slug
        FROM dishes d JOIN cuisines c ON c.id = d.cuisine_id
        LEFT JOIN user_dishes u ON u.dish_id = d.id AND u.user_id = $uid
        WHERE d.id IN (${ids.map(() => '?').join(',')})
      `).all({ uid }, ...ids)
    : []
  return { month: m, tag: row.tag, dishes, done: dishes.length > 0 && dishes.every(d => d.status === 'tried') }
}

// Months ('YYYY-MM') whose challenge dishes this user has all tried. Dishes deleted since don't count,
// the same as in currentChallenge.
export function completedChallengeMonths(uid) {
  const months = []
  for (const row of db.prepare('SELECT month, dish_ids FROM user_challenges WHERE user_id = ? ORDER BY month').all(uid)) {
    const ids = JSON.parse(row.dish_ids)
    if (!ids.length) continue
    const { total, tried } = db.prepare(`
      SELECT COUNT(*) AS total, COUNT(CASE WHEN u.status = 'tried' THEN 1 END) AS tried
      FROM dishes d LEFT JOIN user_dishes u ON u.dish_id = d.id AND u.user_id = ?
      WHERE d.id IN (${ids.map(() => '?').join(',')})
    `).get(uid, ...ids)
    if (total > 0 && tried === total) months.push(row.month)
  }
  return months
}

export const challengesCompleted = uid => completedChallengeMonths(uid).length
