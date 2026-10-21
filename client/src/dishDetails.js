import { TAG_GROUPS, CONTAINS } from './util.js'

// The details form of a dish you add yourself: { description, type, diet, contains, extras }.
// The diet is a shortcut to the contains list, which is what's stored (diet tags follow from it on the server).
const ALLERGENS = ['gluten', 'nuts', 'peanuts', 'soy', 'sesame', 'alcohol']
export const DIET_CHOICES = {
  meat: { label: '🥩 Meat', ask: 'Which meat?', which: ['meat', 'pork', 'poultry'], also: ['fish', 'shellfish', 'egg', 'dairy', 'honey', ...ALLERGENS] },
  seafood: { label: '🐟 Fish & seafood', ask: 'Which?', which: ['fish', 'shellfish'], also: ['egg', 'dairy', 'honey', ...ALLERGENS] },
  vegetarian: { label: '🥦 Vegetarian', ask: 'Which animal products?', which: ['egg', 'dairy', 'honey'], also: ALLERGENS },
  vegan: { label: '🌱 Vegan', ask: '', which: [], also: ALLERGENS },
}

export const allowedContains = diet => (DIET_CHOICES[diet] ? [...DIET_CHOICES[diet].which, ...DIET_CHOICES[diet].also] : [])

const dietOf = contains => {
  if (!contains) return ''
  const has = list => contains.some(c => list.includes(c))
  return has(['meat', 'pork', 'poultry']) ? 'meat' : has(['fish', 'shellfish']) ? 'seafood' : has(['egg', 'dairy', 'honey']) ? 'vegetarian' : 'vegan'
}

export const blankDetails = () => ({ description: '', type: '', diet: '', contains: [], extras: [] })

export const detailsFromDish = d => ({
  description: d.description || '',
  type: d.tags.find(t => TAG_GROUPS.type.tags.includes(t)) || '',
  diet: dietOf(d.contains),
  contains: [...(d.contains || [])],
  extras: d.tags.filter(t => TAG_GROUPS.extra.tags.includes(t)),
})

export function detailsError(x) {
  if (!x.type) return 'Pick a type.'
  if (!x.diet) return 'Pick a diet.'
  const which = DIET_CHOICES[x.diet].which
  if (which.length && !x.contains.some(c => which.includes(c))) {
    const names = which.map(c => CONTAINS[c].replace(/^\S+\s/, '').toLowerCase())
    return x.diet === 'vegetarian'
      ? 'Pick egg, dairy or honey for a vegetarian dish, or choose Vegan.'
      : `${DIET_CHOICES[x.diet].ask} Pick ${names.slice(0, -1).join(', ')} or ${names.at(-1)}.`
  }
  return ''
}

export const detailsBody = x => ({
  description: x.description,
  tags: [x.type, ...x.extras],
  contains: x.contains.filter(c => allowedContains(x.diet).includes(c)),
})
