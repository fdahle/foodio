import db from './db.js'
import { TAGS, TYPES } from './tags.js'
import { challengesCompleted, completedChallengeMonths } from './challenge.js'
import { EXCLUDED } from './diet.js'

// Everything here is for one user ($uid). Hidden dishes and untried ones that don't fit their diet don't count.
const NOT_HIDDEN = `d.id IS NOT NULL AND COALESCE(u.hidden, 0) = 0 AND (NOT ${EXCLUDED} OR u.status = 'tried')`
const U_JOIN = 'LEFT JOIN user_dishes u ON u.dish_id = d.id AND u.user_id = $uid'

export function cuisineProgress(uid) {
  const cuisines = db.prepare(`
    SELECT c.id, c.slug, c.name, c.emoji, c.countries, c.continent, c.is_custom,
      SUM(CASE WHEN ${NOT_HIDDEN} THEN 1 ELSE 0 END) AS total,
      SUM(CASE WHEN ${NOT_HIDDEN} AND u.status = 'tried' THEN 1 ELSE 0 END) AS tried,
      SUM(CASE WHEN ${NOT_HIDDEN} AND u.status = 'wishlist' THEN 1 ELSE 0 END) AS wishlist
    FROM cuisines c
    LEFT JOIN dishes d ON d.cuisine_id = c.id
    ${U_JOIN}
    GROUP BY c.id ORDER BY c.name
  `).all({ uid })

  const regions = db.prepare(`
    SELECT r.id, r.cuisine_id, r.name,
      SUM(CASE WHEN ${NOT_HIDDEN} THEN 1 ELSE 0 END) AS total,
      SUM(CASE WHEN ${NOT_HIDDEN} AND u.status = 'tried' THEN 1 ELSE 0 END) AS tried
    FROM regions r
    LEFT JOIN dishes d ON d.region_id = r.id
    ${U_JOIN}
    GROUP BY r.id ORDER BY r.sort, r.name
  `).all({ uid })

  const byCuisine = new Map()
  for (const r of regions) {
    if (!byCuisine.has(r.cuisine_id)) byCuisine.set(r.cuisine_id, [])
    byCuisine.get(r.cuisine_id).push({ id: r.id, name: r.name, total: r.total, tried: r.tried })
  }

  return cuisines.map(c => ({
    ...c,
    countries: JSON.parse(c.countries),
    regions: (byCuisine.get(c.id) || []).filter(r => r.total > 0),
  }))
}

// Level n starts at 50 * n * (n - 1) points.
export function levelFor(points) {
  const level = Math.floor((1 + Math.sqrt(1 + points / 12.5)) / 2)
  return { level, floor: 50 * level * (level - 1), ceil: 50 * level * (level + 1) }
}

const TITLES = ['Newcomer', 'Taster', 'Snacker', 'Explorer', 'Foodie', 'Epicure', 'Gourmet', 'Connoisseur', 'Globetrotter',
  'Flavour Hunter', 'Spice Sage', 'Culinary Nomad', 'Master Taster', 'Legend', 'Living Legend', 'Food Deity']

// The same dish listed under several cuisines counts once in the overall totals.
const DISH_IDENTITY = `COALESCE(d.same_group, 'id:' || d.id)`

export function computeStats(uid, cuisines = cuisineProgress(uid)) {
  const { tried, total } = db.prepare(`
    SELECT COUNT(DISTINCT CASE WHEN u.status = 'tried' THEN ${DISH_IDENTITY} END) AS tried,
      COUNT(DISTINCT ${DISH_IDENTITY}) AS total
    FROM dishes d ${U_JOIN}
    WHERE ${NOT_HIDDEN}
  `).get({ uid })

  const started = cuisines.filter(c => c.tried > 0)
  const cuisinesCompleted = cuisines.filter(c => c.total >= 5 && c.tried === c.total).length
  const regionsCompleted = cuisines.reduce((s, c) => s + c.regions.filter(r => r.total >= 3 && r.tried === r.total).length, 0)
  const areas = new Set(started.map(c => c.continent).filter(c => c !== 'Other')).size
  const rated = db.prepare(`
    SELECT COUNT(DISTINCT ${DISH_IDENTITY}) AS n FROM user_dishes u JOIN dishes d ON d.id = u.dish_id
    WHERE u.user_id = ? AND u.rating IS NOT NULL AND u.hidden = 0
  `).get(uid).n
  const challenges = challengesCompleted(uid)

  const tagCounts = Object.fromEntries(TAGS.map(t => [t, 0]))
  const rows = db.prepare(`
    SELECT MIN(d.tags) AS tags FROM dishes d JOIN user_dishes u ON u.dish_id = d.id
    WHERE u.user_id = ? AND u.status = 'tried' AND u.hidden = 0 GROUP BY ${DISH_IDENTITY}
  `).all(uid)
  for (const r of rows) for (const t of JSON.parse(r.tags)) if (t in tagCounts) tagCounts[t]++

  const points = tried * 10 + regionsCompleted * 50 + cuisinesCompleted * 200 + rated * 2 + challenges * 100
  const lv = levelFor(points)

  return {
    tried, total, pct: total ? Math.round((tried / total) * 100) : 0,
    cuisinesStarted: started.length, cuisinesTotal: cuisines.length, cuisinesCompleted, regionsCompleted,
    areas, rated, challenges, tagCounts, points,
    level: lv.level, levelFloor: lv.floor, levelCeil: lv.ceil,
    title: TITLES[Math.min(lv.level - 1, TITLES.length - 1)],
  }
}

// Longest run of consecutive months in a list of 'YYYY-MM' strings.
function longestMonthRun(list) {
  let best = 0, run = 0, prev = null
  for (const m of [...new Set(list)].sort()) {
    const [y, mo] = m.split('-').map(Number)
    run = prev === y * 12 + mo - 1 ? run + 1 : 1
    best = Math.max(best, run)
    prev = y * 12 + mo
  }
  return best
}

const INGREDIENTS = {
  cheese: /\bchees/i, egg: /\beggs?\b/i, rice: /\brice\b/i, dumpling: /dumpling/i, chicken: /\bchicken/i,
  garlic: /\bgarlic/i, coconut: /\bcoconut/i, potato: /\bpotato/i, chocolate: /chocolate|\bcocoa/i,
}
const DAY = 86400000

// Extra counts that only badges need (kept out of computeStats, which is shared publicly).
function badgeCounts(uid) {
  const n = where => db.prepare(`
    SELECT COUNT(DISTINCT ${DISH_IDENTITY}) AS n FROM user_dishes u JOIN dishes d ON d.id = u.dish_id
    WHERE u.user_id = $uid AND ${where}
  `).get({ uid }).n
  const rows = db.prepare(`
    SELECT ${DISH_IDENTITY} AS dish, d.name, d.description, d.emoji, d.tags, u.tried_on, u.place, c.slug AS cuisine, c.continent,
      (SELECT COUNT(*) FROM dishes o WHERE o.same_group = d.same_group) AS listed_in
    FROM user_dishes u JOIN dishes d ON d.id = u.dish_id JOIN cuisines c ON c.id = d.cuisine_id
    WHERE u.user_id = ? AND u.status = 'tried' AND u.hidden = 0
  `).all(uid)
  // A dish listed under several cuisines counts once.
  const tried = [...new Map(rows.map(r => [r.dish, { ...r, tags: JSON.parse(r.tags) }])).values()]
  const dated = rows.filter(r => r.tried_on).map(r => ({ ...r, tags: JSON.parse(r.tags), date: new Date(`${r.tried_on}T12:00:00`) }))

  // Per day: which dishes, world areas and dish types.
  const days = new Map()
  for (const t of dated) {
    if (!days.has(t.tried_on)) days.set(t.tried_on, { dishes: new Map(), areas: new Set() })
    days.get(t.tried_on).dishes.set(t.dish, t)
    if (t.continent !== 'Other') days.get(t.tried_on).areas.add(t.continent)
  }
  const day = [...days.values()].map(d => ({ ...d, dishes: [...d.dishes.values()] }))
  const dates = [...days.keys()].sort()
  const longestBreak = Math.max(0, ...dates.slice(1).map((d, i) => (new Date(d) - new Date(dates[i])) / DAY))
  const onDay = test => dated.some(t => test(t.tried_on.slice(5), t))

  const letters = new Set(tried.map(t => t.name.normalize('NFD').replace(/[̀-ͯ]/g, '')[0]?.toUpperCase())
    .filter(l => /[A-Z]/.test(l)))
  const places = new Map()
  for (const t of tried.filter(t => t.place?.trim())) {
    const key = t.place.trim().toLowerCase()
    places.set(key, (places.get(key) || 0) + 1)
  }

  const cuisines = cuisineProgress(uid)
  const started = cuisines.filter(c => c.tried > 0)
  const areas = {}
  for (const c of cuisines.filter(c => c.continent !== 'Other' && c.total > 0)) {
    areas[c.continent] ??= { started: 0, total: 0 }
    areas[c.continent].total++
    if (c.tried > 0) areas[c.continent].started++
  }

  return {
    notes: n("TRIM(COALESCE(u.note, '')) != ''"),
    places: n("TRIM(COALESCE(u.place, '')) != ''"),
    fiveStars: n('u.rating = 5 AND u.hidden = 0'),
    oneStars: n('u.rating = 1 AND u.hidden = 0'),
    ratingsUsed: db.prepare('SELECT COUNT(DISTINCT rating) AS n FROM user_dishes WHERE user_id = ? AND rating IS NOT NULL AND hidden = 0').get(uid).n,
    hidden: n('u.hidden = 1'),
    wishlist: n(`u.status = 'wishlist' AND u.hidden = 0 AND NOT ${EXCLUDED}`),
    tried: tried.length,
    bestDay: Math.max(0, ...day.map(d => d.dishes.length)),
    bestDayAreas: Math.max(0, ...day.map(d => d.areas.size)),
    drinksInADay: Math.max(0, ...day.map(d => d.dishes.filter(t => t.tags.includes('drink')).length)),
    dessertDay: day.some(d => d.dishes.length >= 2 && d.dishes.every(t => t.tags.includes('dessert'))) ? 1 : 0,
    streak: longestMonthRun(dates.map(d => d.slice(0, 7))),
    calendarMonths: new Set(dates.map(d => d.slice(5, 7))).size,
    longestBreak,
    letters: letters.size,
    typesTried: new Set(tried.flatMap(t => t.tags).filter(t => TYPES.includes(t))).size,
    ingredients: Object.fromEntries(Object.entries(INGREDIENTS).map(([k, re]) =>
      [k, tried.filter(t => re.test(`${t.name} ${t.description || ''}`)).length])),
    longestName: Math.max(0, ...tried.map(t => t.name.length)),
    shortestName: Math.min(99, ...tried.map(t => t.name.length)),
    mostShared: Math.max(0, ...tried.map(t => t.listed_in)),
    usualSpot: Math.max(0, ...places.values()),
    christmas: onDay(md => ['12-24', '12-25', '12-26'].includes(md)) ? 1 : 0,
    newYear: onDay(md => md === '01-01') ? 1 : 0,
    halloween: onDay(md => md === '10-31') ? 1 : 0,
    valentine: onDay(md => md === '02-14') ? 1 : 0,
    leapDay: onDay(md => md === '02-29') ? 1 : 0,
    tacoTuesday: dated.some(t => t.cuisine === 'mexican' && t.date.getDay() === 2) ? 1 : 0,
    soClose: cuisines.filter(c => c.total >= 10 && c.tried === c.total - 1).length,
    deepest: Math.max(0, ...cuisines.map(c => c.tried)),
    halfway: cuisines.filter(c => c.total >= 5 && c.tried * 2 >= c.total).length,
    countries: new Set(started.flatMap(c => c.countries)).size,
    areas,
    challengeStreak: longestMonthRun(completedChallengeMonths(uid)),
  }
}

// One levelled badge per type, diet and extra: [emoji, what to try, level names].
const TAG_BADGES = {
  main: ['🍛', 'main dishes', ['Main Character', 'Plat du Jour', 'Main Event']],
  snack: ['🥟', 'snacks or starters', ['Snack Attack', 'Nibbler', 'Grazing Champion']],
  side: ['🥗', 'sides or salads', ['Sidekick', 'Side Hustle', 'Supporting Cast']],
  soup: ['🍲', 'soups or stews', ['Soup Lover', 'Stew Crew', 'Soup-erstar']],
  noodles: ['🍜', 'noodle or pasta dishes', ['Noodle Head', 'Slurp Master', 'Noodle Nirvana']],
  bread: ['🥖', 'breads or pastries', ['Bread Winner', 'Carb Loader', 'Gluten Maximalist']],
  dessert: ['🍰', 'desserts', ['Sweet Tooth', 'Sugar Rush', "Dentist's Nightmare"]],
  deli: ['🧀', 'cheeses or charcuterie', ['Cheese Board', 'Charcuterie Chief', 'Deli Devotee']],
  drink: ['🍹', 'drinks', ['Sipper', 'Thirsty', 'Hydration Hero']],
  meat: ['🥩', 'meat dishes', ['Carnivore', 'Meat Sweats', "Butcher's Best Friend"]],
  seafood: ['🐟', 'fish or seafood dishes', ['Sea Legs', 'Fish Whisperer', "Poseidon's Guest"]],
  vegetarian: ['🥦', 'vegetarian dishes', ['Green Plate', 'Leaf Lover', 'Honorary Rabbit']],
  vegan: ['🌱', 'vegan dishes', ['Plant Powered', 'Leaf It to Me', 'Vegan Virtuoso']],
  spicy: ['🌶️', 'spicy dishes', ['Fire Eater', 'Dragon Breath', 'Asbestos Tongue']],
  street: ['🛺', 'street food dishes', ['Street Smart', 'Market Hopper', 'Night Market Legend']],
}

const AREA_NAMES = { 'Middle East': 'the Middle East', 'Latin America & Caribbean': 'Latin America & the Caribbean' }
const AREA_BADGES = [
  ['Europe', '🏰', ['Euro Trip', 'Interrail Pass', 'Grand Tour']],
  ['Middle East', '🕌', ['Spice Route', 'Caravan', 'Thousand and One Nights']],
  ['Africa', '🦁', ['Safari Supper', 'Savanna Snacker', 'Out of Africa']],
  ['Asia', '🏯', ['Silk Road', 'Monsoon Menu', 'Pan-Asian Palate']],
  ['North America', '🗽', ['Road Trip', 'Coast to Coast']],
  ['Latin America & Caribbean', '💃', ['Carnival', 'Salsa Steps', 'Fiesta Forever']],
  ['Oceania', '🦘', ['Down Under', 'Island Hopper']],
]

const INGREDIENT_BADGES = [
  ['cheese', '🧀', 'cheese', ['Cheesy', 'Big Cheese', 'Cheese Wizard']],
  ['egg', '🥚', 'egg', ['Egg-cellent', 'Egg-straordinary', 'Egg-sistential Crisis']],
  ['rice', '🍚', 'rice', ['Rice to Meet You', 'Rice Rice Baby', 'Lord of the Rice']],
  ['dumpling', '🥟', 'dumplings', ['Dumpling Darling', 'Dumpling Gang', 'Dumpling Dynasty']],
  ['chicken', '🍗', 'chicken', ['Winner Winner', 'Chicken Run', 'Cluck Norris']],
  ['garlic', '🧄', 'garlic', ['Garlic Breath', 'Vampire-Proof', 'Garlic Overlord']],
  ['coconut', '🥥', 'coconut', ['Coco Loco', 'Coconut Crew', 'Palm Tree Royalty']],
  ['potato', '🥔', 'potato', ['Couch Potato', 'Spud Buddy', 'Mashter Chef']],
  ['chocolate', '🍫', 'chocolate', ['Cocoa Curious', 'Chocoholic', 'Chocolate Factory']],
]

// A badge has one or more levels; it shows the name of the highest level reached and works towards the next.
// Secret badges stay a mystery until their first level is earned.
export function computeBadges(s, uid, c = badgeCounts(uid)) {
  const out = []
  let group = 'Milestones'
  const badge = (id, emoji, value, levels, desc, { secret = false } = {}) => {
    const tier = levels.filter(([t]) => value >= t).length
    const [target, name] = levels[Math.min(tier, levels.length - 1)]
    const shown = levels[Math.max(tier - 1, 0)][1]
    if (secret && !tier) {
      out.push({ id, group: 'Secrets', emoji: '❓', name: 'Secret', desc: 'Keep eating to find out', progress: 0, target: 1, tier, tiers: levels.length, earned: false, secret })
      return
    }
    out.push({ id, group: secret ? 'Secrets' : group, emoji, name: shown, desc: desc(target), progress: Math.min(value, target), target, tier, tiers: levels.length, earned: tier > 0 })
  }
  const plural = (t, word, words = `${word}s`) => `${t} ${t === 1 ? word : words}`

  badge('dishes', '🍽️', s.tried, [[1, 'First Bite'], [10, 'Getting Started'], [50, 'Hungry Explorer'], [100, 'Centurion'],
    [250, 'Food Hoarder'], [500, 'Half a Thousand'], [1000, 'Thousand Plates'], [2000, 'Bottomless Stomach']],
  t => `Try ${plural(t, 'dish', 'dishes')}`)
  badge('cuisines', '🌍', s.cuisinesStarted, [[3, 'Curious'], [10, 'Well Travelled'], [25, 'Citizen of the Table'],
    [50, 'World Tour'], [100, 'Passport Full']], t => `Try a dish from ${t} cuisines`)
  badge('areas', '🧭', s.areas, [[2, 'Two Worlds'], [5, 'Five Worlds'], [7, 'Around the World']],
    t => `Try food from ${t} world areas`)
  badge('complete', '🏆', s.cuisinesCompleted, [[1, 'Completionist'], [3, 'Collector'], [10, 'Master of Many'], [25, 'Cuisine Royalty']],
    t => `Complete ${plural(t, 'cuisine')}`)
  badge('regions', '📍', s.regionsCompleted, [[1, 'Local Expert'], [5, 'Regional Pro'], [15, 'Region Hopper'], [40, 'Map Colourer']],
    t => `Complete ${plural(t, 'region')}`)
  badge('rated', '⭐', s.rated, [[10, 'Critic'], [50, 'Food Critic'], [200, 'Michelin Inspector']], t => `Rate ${t} dishes`)
  badge('challenge', '🎯', s.challenges, [[1, 'Challenger'], [3, 'Challenge Accepted'], [12, 'Year of Challenges']],
    t => `Complete ${plural(t, 'monthly challenge')}`)
  group = 'Food types'
  for (const [tag, [emoji, label, names]] of Object.entries(TAG_BADGES)) {
    badge(`tag-${tag}`, emoji, s.tagCounts[tag] || 0, [10, 25, 50].map((t, i) => [t, names[i]]), t => `Try ${t} ${label}`)
  }

  group = 'Habits'
  badge('notes', '📝', c.notes, [[5, 'Food Diarist'], [25, 'Tasting Notes'], [100, 'Memoirist']], t => `Write notes on ${t} dishes`)
  badge('places', '🗺️', c.places, [[5, 'Regular'], [25, 'Local Guide']], t => `Note where you ate ${t} dishes`)
  badge('wishlist', '📋', c.wishlist, [[10, 'Window Shopper'], [50, 'Big Plans'], [100, 'Eyes Bigger Than Stomach']],
    t => `Have ${t} dishes on your wishlist`)
  badge('streak', '🔥', c.streak, [[3, 'Habit'], [6, 'Lifestyle'], [12, 'Year-round Eater']],
    t => `Try a new dish ${t} months in a row`)
  badge('letters', '🔤', c.letters, [[10, 'Alphabet Soup'], [20, 'Spelling Bee'], [26, 'A to Z']],
    t => `Try dishes starting with ${t} different letters`)
  badge('feast', '🤤', c.bestDay, [[3, 'Feast Mode'], [5, 'Food Coma'], [10, 'Are You OK?']],
    t => `Try ${t} new dishes on one day`, { secret: true })
  badge('jetlag', '✈️', c.bestDayAreas, [[2, 'Jet Lag'], [3, 'Around the World in a Day']],
    t => `Try food from ${t} world areas on one day`, { secret: true })
  badge('five-stars', '😍', c.fiveStars, [[1, 'Love at First Bite'], [10, 'Heart Eyes'], [25, 'Easily Impressed']],
    t => `Give ${t} dish${t === 1 ? '' : 'es'} 5★`, { secret: true })
  badge('one-star', '🤢', c.oneStars, [[1, 'Well, You Tried'], [5, 'Tough Crowd']],
    t => `Give ${t} dish${t === 1 ? '' : 'es'} 1★`, { secret: true })
  badge('hidden', '🙈', c.hidden, [[1, 'Not for Me'], [10, 'Picky Eater'], [50, "We Don't Talk About Those"]],
    t => `Hide ${plural(t, 'dish', 'dishes')}`, { secret: true })
  badge('long-name', '👅', c.longestName, [[25, 'Tongue Twister']], () => 'Try a dish with a name of 25+ characters', { secret: true })
  badge('so-close', '😩', c.soClose, [[1, 'So Close']], () => 'Leave exactly one dish untried in a cuisine of 10+', { secret: true })

  group = 'Exploring'
  for (const [area, emoji, names] of AREA_BADGES) {
    const a = c.areas[area]
    if (!a) continue
    const targets = [...new Set([Math.min(3, a.total), Math.ceil(a.total / 2), a.total])].sort((x, y) => x - y)
    const levels = targets.map((t, i) => [t, names[names.length - targets.length + i]])
    badge(`area-${area}`, emoji, a.started, levels, t => `Try ${t === a.total ? 'all ' : ''}${t} cuisines from ${AREA_NAMES[area] || area}`)
  }
  badge('countries', '🛂', c.countries, [[10, 'Stamp Collector'], [25, 'Frequent Flyer'], [50, 'Jet Setter'], [100, 'Diplomatic Passport']],
    t => `Try food from ${t} countries`)
  badge('deep-dive', '🤿', c.deepest, [[10, 'Deep Dive'], [25, 'Honorary Local'], [50, 'Adopted by Grandma']],
    t => `Try ${t} dishes from one cuisine`)
  badge('halfway', '🌗', c.halfway, [[1, 'Halfway There'], [5, 'Glass Half Full'], [15, 'Half the World']],
    t => `Get ${plural(t, 'cuisine')} (5+ dishes) to 50%`)
  badge('types', '🍱', c.typesTried, [[5, 'Varied Diet'], [TYPES.length, 'Full Menu']],
    t => t === TYPES.length ? 'Try a dish of every type (main, snack, dessert…)' : `Try ${t} types of dish (main, snack, dessert…)`)
  group = 'Ingredients'
  for (const [key, emoji, label, names] of INGREDIENT_BADGES) {
    badge(`ingredient-${key}`, emoji, c.ingredients[key], [5, 15, 30].map((t, i) => [t, names[i]]), t => `Try ${t} dishes with ${label}`)
  }

  group = 'Habits'
  badge('seasons', '🍂', c.calendarMonths, [[6, 'Half-Year Hungry'], [12, 'Four Seasons']],
    t => `Try new dishes in ${t} different calendar months`)
  badge('ratings-used', '🎭', c.ratingsUsed, [[5, 'Mixed Feelings']], () => 'Use every rating from 1★ to 5★')
  badge('usual-spot', '🏠', c.usualSpot, [[3, 'Usual Spot'], [10, 'Second Home']], t => `Eat ${t} dishes at the same place`)
  badge('challenge-streak', '🎩', c.challengeStreak, [[2, 'Double Trouble'], [3, 'Hat Trick'], [6, 'Unstoppable']],
    t => `Complete ${t} monthly challenges in a row`)

  badge('christmas', '🎄', c.christmas, [[1, 'Festive Feast']], () => 'Try a new dish over Christmas', { secret: true })
  badge('new-year', '🎆', c.newYear, [[1, 'New Year, New Plate']], () => 'Try a new dish on New Year’s Day', { secret: true })
  badge('halloween', '🎃', c.halloween, [[1, 'Spooky Snack']], () => 'Try a new dish on Halloween', { secret: true })
  badge('valentine', '💘', c.valentine, [[1, 'Date Night']], () => 'Try a new dish on Valentine’s Day', { secret: true })
  badge('leap-day', '🐸', c.leapDay, [[1, 'Leap of Faith']], () => 'Try a new dish on 29 February', { secret: true })
  badge('taco-tuesday', '🌮', c.tacoTuesday, [[1, 'Taco Tuesday']], () => 'Try a Mexican dish on a Tuesday', { secret: true })
  badge('liquid-lunch', '🥤', c.drinksInADay, [[3, 'Liquid Lunch']], () => 'Try 3 drinks on one day', { secret: true })
  badge('just-desserts', '🍨', c.dessertDay, [[1, 'Just Desserts']], () => 'Have a day of only desserts (2+)', { secret: true })
  badge('comeback', '🐌', c.longestBreak, [[90, 'Prodigal Foodie']], () => 'Come back after 3 months without a new dish', { secret: true })
  badge('commitment', '🙃', c.wishlist >= 20 && c.wishlist > c.tried ? 1 : 0, [[1, 'Commitment Issues']],
    () => 'Have 20+ dishes on your wishlist and fewer tried', { secret: true })
  badge('short-name', '🤏', c.shortestName <= 4 ? 1 : 0, [[1, 'Short & Sweet']], () => 'Try a dish with a name of 4 letters or fewer', { secret: true })
  badge('deja-vu', '👯', c.mostShared, [[3, 'Déjà Vu']], () => 'Try a dish that 3+ cuisines claim as theirs', { secret: true })
  badge('dont-panic', '🐬', s.tried, [[42, 'Don’t Panic']], () => 'Try 42 dishes', { secret: true })
  return out
}
