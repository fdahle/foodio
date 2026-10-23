import db from './db.js'
import { EXCLUDED } from './diet.js'

// Group stats: what everyone who shares their stats eats, without names. Only people who share can see them.
// With a handful of friends a number about one or two people would give them away, so every number needs
// at least MIN_PEOPLE people behind it, and nothing shows until that many share.
export const MIN_PEOPLE = 3

const SHARERS = "SELECT user_id FROM user_settings WHERE key = 'shareStats'"
// The same dish listed under several cuisines counts once (as in stats.js).
const DISH_IDENTITY = `COALESCE(d.same_group, 'id:' || d.id)`
const TRIED_BY_SHARERS = `u.status = 'tried' AND u.user_id IN (${SHARERS})`

export const sharesStats = uid => !!db.prepare("SELECT 1 FROM user_settings WHERE user_id = ? AND key = 'shareStats'").get(uid)

export function setSharesStats(uid, on) {
  if (on) db.prepare("INSERT OR IGNORE INTO user_settings (user_id, key, value) VALUES (?, 'shareStats', '1')").run(uid)
  else db.prepare("DELETE FROM user_settings WHERE user_id = ? AND key = 'shareStats'").run(uid)
  return on
}

// Dishes as list rows for $uid (their own status, so the page can show what they've tried), in the given
// order. A linked dish shows as its original. Dishes they hid or that don't fit their diet are left out.
function dishRows(uid, ranked) {
  if (!ranked.length) return []
  const rows = db.prepare(`
    SELECT d.id, d.name, d.emoji, c.id AS cuisine_id, c.name AS cuisine, c.emoji AS cuisine_emoji, u.status,
      d.key, d.slug, c.slug AS cuisine_slug
    FROM dishes d JOIN cuisines c ON c.id = d.cuisine_id
    LEFT JOIN user_dishes u ON u.dish_id = d.id AND u.user_id = $uid
    WHERE d.id IN (${ranked.map(r => Number(r.id)).join(',')})
      AND COALESCE(u.hidden, 0) = 0 AND (NOT ${EXCLUDED} OR u.status = 'tried')
  `).all({ uid })
  const byId = new Map(rows.map(r => [r.id, r]))
  return ranked.filter(r => byId.has(r.id)).map(({ id, ...stat }) => ({ ...byId.get(id), ...stat }))
}
const ORIGINAL = 'COALESCE(MIN(CASE WHEN d.key = d.same_group THEN d.id END), MIN(d.id))'

export function groupStats(uid) {
  const people = db.prepare(`SELECT COUNT(*) AS n FROM (${SHARERS})`).get().n
  if (people < MIN_PEOPLE) return { people, minPeople: MIN_PEOPLE, enough: false }

  // Dishes tried per person, sharers without any included.
  const perPerson = db.prepare(`
    SELECT s.user_id, COUNT(DISTINCT CASE WHEN u.status = 'tried' THEN ${DISH_IDENTITY} END) AS n
    FROM (${SHARERS}) s LEFT JOIN user_dishes u ON u.user_id = s.user_id LEFT JOIN dishes d ON d.id = u.dish_id
    GROUP BY s.user_id
  `).all()
  const totals = db.prepare(`
    SELECT
      (SELECT COUNT(DISTINCT ${DISH_IDENTITY}) FROM dishes d) AS dishes,
      (SELECT COUNT(DISTINCT ${DISH_IDENTITY}) FROM dishes d JOIN user_dishes u ON u.dish_id = d.id WHERE ${TRIED_BY_SHARERS}) AS tried,
      (SELECT COUNT(*) FROM cuisines) AS cuisines,
      (SELECT COUNT(DISTINCT d.cuisine_id) FROM dishes d JOIN user_dishes u ON u.dish_id = d.id WHERE ${TRIED_BY_SHARERS}) AS cuisinesStarted
  `).get()

  // For the map: per cuisine, the dishes anyone in the group has tried.
  const map = db.prepare(`
    SELECT c.id, c.name, c.emoji, c.countries, COUNT(d.id) AS total,
      COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM user_dishes u WHERE u.dish_id = d.id AND ${TRIED_BY_SHARERS}) THEN d.id END) AS tried
    FROM cuisines c LEFT JOIN dishes d ON d.cuisine_id = c.id
    GROUP BY c.id
  `).all().map(c => ({ ...c, countries: JSON.parse(c.countries) }))

  // Each person's average counts once, so someone who rates a lot doesn't outweigh the rest.
  const lovedCuisines = db.prepare(`
    SELECT c.id, c.name, c.emoji, ROUND(AVG(p.avg), 1) AS rating, COUNT(*) AS people
    FROM (
      SELECT d.cuisine_id, u.user_id, AVG(u.rating) AS avg
      FROM user_dishes u JOIN dishes d ON d.id = u.dish_id
      WHERE ${TRIED_BY_SHARERS} AND u.rating IS NOT NULL GROUP BY d.cuisine_id, u.user_id
    ) p JOIN cuisines c ON c.id = p.cuisine_id
    GROUP BY c.id HAVING people >= ${MIN_PEOPLE}
    ORDER BY rating DESC, people DESC, c.name LIMIT 10
  `).all()

  const popularCuisines = db.prepare(`
    SELECT c.id, c.name, c.emoji, COUNT(DISTINCT u.user_id) AS people, COUNT(*) AS tries
    FROM user_dishes u JOIN dishes d ON d.id = u.dish_id JOIN cuisines c ON c.id = d.cuisine_id
    WHERE ${TRIED_BY_SHARERS}
    GROUP BY c.id HAVING people >= ${MIN_PEOPLE}
    ORDER BY people DESC, tries DESC, c.name LIMIT 10
  `).all()

  const lovedDishes = dishRows(uid, db.prepare(`
    SELECT ${ORIGINAL} AS id, ROUND(AVG(p.rating), 1) AS rating, COUNT(DISTINCT p.user_id) AS people
    FROM (
      SELECT ${DISH_IDENTITY} AS ident, u.user_id, MAX(u.rating) AS rating
      FROM user_dishes u JOIN dishes d ON d.id = u.dish_id
      WHERE ${TRIED_BY_SHARERS} AND u.rating IS NOT NULL GROUP BY ident, u.user_id
    ) p JOIN dishes d ON ${DISH_IDENTITY} = p.ident
    GROUP BY p.ident HAVING people >= ${MIN_PEOPLE}
    ORDER BY rating DESC, people DESC LIMIT 15
  `).all())

  const byPeople = status => dishRows(uid, db.prepare(`
    SELECT ${ORIGINAL} AS id, COUNT(DISTINCT u.user_id) AS people
    FROM user_dishes u JOIN dishes d ON d.id = u.dish_id
    WHERE u.status = '${status}' AND u.user_id IN (${SHARERS})
    GROUP BY ${DISH_IDENTITY} HAVING people >= ${MIN_PEOPLE}
    ORDER BY people DESC, MIN(d.sort) LIMIT 15
  `).all())

  // Yours alone: tried by you and by nobody else who shares.
  const onlyYou = dishRows(uid, db.prepare(`
    SELECT ${ORIGINAL} AS id
    FROM user_dishes u JOIN dishes d ON d.id = u.dish_id
    WHERE u.user_id = $uid AND u.status = 'tried' AND NOT EXISTS (
      SELECT 1 FROM user_dishes o JOIN dishes od ON od.id = o.dish_id
      WHERE o.status = 'tried' AND o.user_id != $uid AND o.user_id IN (${SHARERS})
        AND COALESCE(od.same_group, 'id:' || od.id) = ${DISH_IDENTITY}
    )
    GROUP BY ${DISH_IDENTITY} ORDER BY MAX(u.tried_on) DESC
  `).all({ uid }))

  return {
    people,
    minPeople: MIN_PEOPLE,
    enough: true,
    totals: {
      ...totals,
      average: Math.round(perPerson.reduce((s, p) => s + p.n, 0) / people),
      yours: perPerson.find(p => p.user_id === uid)?.n ?? 0,
    },
    map,
    lovedCuisines,
    popularCuisines,
    lovedDishes,
    mostTried: byPeople('tried'),
    mostWanted: byPeople('wishlist'),
    onlyYou,
  }
}
