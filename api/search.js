// Forgiving dish search: accents, case and spacing don't matter ("pho" finds Phở, "xiao long bao" Xiaolongbao),
// and a query that matches no dish name gets "did you mean" suggestions for close spellings.

const LETTERS = { ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i', ħ: 'h' }

// "Crème Brûlée" → "creme brulee"
export const fold = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[øæœßłđðþıħ]/g, c => LETTERS[c]).replace(/[^a-z0-9]+/g, ' ').trim()

// "Xiao Long-Bao" → "xiaolongbao"
export const compact = s => fold(s).replace(/ /g, '')

// Edit distance between q and its best-matching part of text (typos, swapped letters), so a partly typed
// or misspelt word still finds a longer name.
function partDistance(q, text) {
  let prev2 = null
  let prev = new Array(text.length + 1).fill(0)
  for (let i = 1; i <= q.length; i++) {
    const row = [i]
    for (let j = 1; j <= text.length; j++) {
      const cost = q[i - 1] === text[j - 1] ? 0 : 1
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
      if (prev2 && q[i - 1] === text[j - 2] && q[i - 2] === text[j - 1]) row[j] = Math.min(row[j], prev2[j - 2] + 1)
    }
    prev2 = prev
    prev = row
  }
  return Math.min(...prev)
}

const allowedTypos = n => (n < 4 ? 0 : n < 6 ? 1 : n < 9 ? 2 : 3)

// Up to `limit` distinct dish names closest to the query (by name or other names), best first;
// dishes are { name, aka, sort } with aka as stored (a JSON list or null).
export function didYouMean(query, dishes, limit = 4) {
  const q = compact(query)
  const max = allowedTypos(q.length)
  if (!max) return []
  const best = new Map()
  for (const d of dishes) {
    const names = [d.name, ...(d.aka ? JSON.parse(d.aka) : [])].map(compact)
    const score = names.map(n => [partDistance(q, n), Math.abs(n.length - q.length), d.sort]).sort(compare)[0]
    if (score[0] > max) continue
    const seen = best.get(d.name)
    if (!seen || compare(score, seen) < 0) best.set(d.name, score)
  }
  const ranked = [...best].sort((a, b) => compare(a[1], b[1]))
  // Only the closest spellings: "tiramisou" suggests Tiramisu, not Tiradito.
  return ranked.filter(([, s]) => s[0] === ranked[0][1][0]).slice(0, limit).map(([name]) => name)
}

const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
