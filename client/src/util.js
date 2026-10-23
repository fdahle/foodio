export const CONTINENTS = [
  'Europe', 'Middle East', 'Africa', 'Asia', 'North America', 'Latin America & Caribbean', 'Oceania', 'Other',
]

// Every dish has one type, diet tags (worked out from what it contains) and optional extras.
export const TAG_GROUPS = {
  type: { label: 'Type', tags: ['main', 'snack', 'side', 'soup', 'noodles', 'bread', 'dessert', 'deli', 'drink'] },
  diet: { label: 'Diet', tags: ['meat', 'seafood', 'vegetarian', 'vegan'] },
  extra: { label: 'Extras', tags: ['spicy', 'street'] },
}

export const TAGS = {
  main: '🍛 Main dish',
  snack: '🥟 Snack & starter',
  side: '🥗 Side & salad',
  soup: '🍲 Soup & stew',
  noodles: '🍜 Noodles & pasta',
  bread: '🥖 Bread & pastry',
  dessert: '🍰 Dessert',
  deli: '🧀 Cheese & charcuterie',
  drink: '🍹 Drink',
  meat: '🥩 Meat',
  seafood: '🐟 Fish & seafood',
  vegetarian: '🥦 Vegetarian',
  vegan: '🌱 Vegan',
  spicy: '🌶️ Spicy',
  street: '🛺 Street food',
}

// "Try 3 … from different parts of the world" (monthly challenge).
export const TAG_PLURALS = {
  main: 'main dishes', snack: 'snacks & starters', side: 'sides & salads', soup: 'soups & stews', noodles: 'noodle & pasta dishes',
  bread: 'breads & pastries', dessert: 'desserts', deli: 'cheeses & charcuterie', drink: 'drinks', meat: 'meat dishes', seafood: 'fish & seafood dishes',
  vegetarian: 'vegetarian dishes', vegan: 'vegan dishes', spicy: 'spicy dishes', street: 'street foods',
}

// Tag filters are { type, diet, extra } with one tag (or '') each.
export const blankFilters = () => ({ type: '', diet: '', extra: '' })
export const activeTags = filters => Object.values(filters).filter(Boolean)
export const filtersLabel = filters => activeTags(filters).map(t => TAGS[t]).join(' · ')

// For accent-insensitive matching: "Crème Brûlée" → "creme brulee" (as fold() in api/search.js).
const LETTERS = { ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i', ħ: 'h' }
export const fold = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[øæœßłđðþıħ]/g, c => LETTERS[c]).replace(/[^a-z0-9]+/g, ' ').trim()

// A vegan dish is also vegetarian; showing both is noise.
export const shownTags = tags => (tags.includes('vegan') ? tags.filter(t => t !== 'vegetarian') : tags)


// What a dish usually contains (from typical recipes); also the options for "avoid" in Settings.
export const CONTAINS = {
  meat: '🥩 Meat',
  pork: '🐖 Pork',
  poultry: '🍗 Poultry',
  fish: '🐟 Fish',
  shellfish: '🦐 Shellfish',
  egg: '🥚 Egg',
  dairy: '🥛 Dairy',
  gluten: '🌾 Gluten',
  nuts: '🌰 Tree nuts',
  peanuts: '🥜 Peanuts',
  soy: '🫘 Soy',
  sesame: '🫙 Sesame',
  alcohol: '🍷 Alcohol',
  honey: '🍯 Honey',
}

// What feedback is about: the first group for "Report a problem" on a dish, the second for the Feedback button.
// The kinds are also checked in api/routes/food.js.
export const FEEDBACK = {
  picture: '🖼️ Wrong picture',
  description: '📝 Wrong description or ingredients',
  cuisine: '🗺️ Wrong cuisine or region',
  duplicate: '👯 Listed twice',
  idea: '💡 Idea',
  bug: '🐞 Something’s broken',
  other: '💬 Something else',
}
export const DISH_FEEDBACK = ['picture', 'description', 'cuisine', 'duplicate', 'other']
export const GENERAL_FEEDBACK = ['idea', 'bug', 'other']

export const wikiUrl = title => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`

// "Rabbit Stew (Stuffat tal-Fenek)" → ['Rabbit Stew', 'Stuffat tal-Fenek'], so cards can show the local name smaller.
export const splitName = name => {
  const m = name.match(/^(.+?)\s*\(([^)]+)\)$/)
  return m ? [m[1], m[2]] : [name, '']
}

export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)

export const medal = p => (p >= 100 ? '🏆' : p >= 75 ? '🥇' : p >= 50 ? '🥈' : p >= 25 ? '🥉' : '')

export const formatDate = iso =>
  iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''

export const formatMonth = ym =>
  `${new Date(`${ym}-15T12:00:00`).toLocaleDateString(undefined, { month: 'short' })} ’${ym.slice(2, 4)}`

export const isUrl = s => /^https?:\/\/\S+$/i.test(s || '')

// Per-device UI preferences; storage can be unavailable (private mode), so never let it throw.
export function loadPref(key, fallback) {
  try {
    const v = localStorage.getItem(`foodio:${key}`)
    return v == null ? fallback : JSON.parse(v)
  } catch {
    return fallback
  }
}

export function savePref(key, value) {
  try { localStorage.setItem(`foodio:${key}`, JSON.stringify(value)) } catch { /* ignore */ }
}

export async function resizeImage(file, max = 1600) {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not process image'))), 'image/jpeg', 0.85))
}
