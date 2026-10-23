<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { api, uploadImage } from '../api.js'
import { TAGS, CONTAINS, isUrl, resizeImage, wikiUrl, shownTags } from '../util.js'
import { blankDetails, detailsFromDish, detailsError, detailsBody } from '../dishDetails.js'
import { showToast, alsoIn } from '../toast.js'
import StarRating from './StarRating.vue'
import DishDetailsFields from './DishDetailsFields.vue'
import AiPromptHelp from './AiPromptHelp.vue'
import { me } from '../session.js'

const props = defineProps({
  dish: { type: Object, required: true },
  cuisineId: { type: Number, required: true },
  regions: { type: Array, default: () => [] },
})
const emit = defineEmits(['change', 'close', 'removed'])
const router = useRouter()

const form = reactive({ note: '', place: '' })
const error = ref('')
const busy = ref(false)

const editing = ref(false)
const edit = reactive({ name: '', cuisineId: null, regionId: null, emoji: '', details: blankDetails() })
const allCuisines = ref([])
const targetRegions = ref([])

// Text fields are only reset when another dish opens, so saves of other fields never clobber typing.
const saved = { note: '', place: '' }
watch(() => props.dish.id, () => {
  const d = props.dish
  saved.note = form.note = d.note || ''
  saved.place = form.place = d.place || ''
}, { immediate: true })

watch(() => props.dish, d => {
  edit.name = d.name
  edit.cuisineId = props.cuisineId
  edit.regionId = d.region_id
  edit.emoji = d.emoji || ''
  edit.details = detailsFromDish(d)
  targetRegions.value = props.regions
}, { immediate: true })

// Local date for the date picker's max (toISOString would give the UTC date).
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Returns whether it worked. Text saves don't set busy: they run on blur, and disabling the buttons then
// would swallow the tap on "Tried" that caused the blur.
async function run(fn, { quiet = false } = {}) {
  error.value = ''
  if (!quiet) busy.value = true
  try {
    await fn()
    return true
  } catch (e) {
    error.value = e.message
    return false
  } finally {
    if (!quiet) busy.value = false
  }
}

const save = (patch, opts) => run(async () => {
  const { synced, ...u } = await api(`/dishes/${props.dish.id}/user`, { method: 'PATCH', body: patch })
  emit('change', { ...props.dish, ...u })
  if (synced.length) showToast(alsoIn(synced))
}, opts)

const setStatus = s => save({ status: props.dish.status === s ? null : s })

// Pending text saves are awaited before the sheet closes, so a note typed right before closing isn't lost.
// A failed one is tried again on the next blur or close.
const pending = new Set()
const unsaved = new Set()
function saveText(field) {
  const value = form[field].trim()
  if (value === saved[field]) return
  const before = saved[field]
  saved[field] = value
  const p = save({ [field]: value }, { quiet: true }).then(ok => {
    if (ok) unsaved.delete(field)
    else { saved[field] = before; unsaved.add(field) }
  }).finally(() => pending.delete(p))
  pending.add(p)
}

async function flush() {
  saveText('note')
  saveText('place')
  await Promise.all(pending)
}

// If a text couldn't be saved, the first close keeps the sheet open to show why; the next one discards it.
let warned = false
async function close() {
  await flush()
  if (unsaved.size && !warned) {
    warned = true
    error.value = `${error.value} Your text wasn’t saved; close again to discard it.`
    return
  }
  emit('close')
}

async function openTwin(t) {
  await flush()
  router.push(`/cuisine/${t.cuisine_id}?dish=${t.id}`)
}

// The illustration of a dish you added yourself.
const imageInput = ref(null)
const cuisineName = computed(() => allCuisines.value.find(c => c.id === props.cuisineId)?.name || '')
const onImage = e => run(async () => {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  const { image } = await uploadImage(props.dish.id, await resizeImage(file))
  emit('change', { ...props.dish, image })
})
const removeImage = () => run(async () => {
  const { image } = await api(`/dishes/${props.dish.id}/image`, { method: 'DELETE' })
  emit('change', { ...props.dish, image })
})

async function openEdit() {
  editing.value = !editing.value
  if (editing.value && !allCuisines.value.length) {
    allCuisines.value = (await api('/cuisines')).map(c => ({ id: c.id, name: c.name, emoji: c.emoji }))
  }
}

watch(() => edit.cuisineId, async (id, old) => {
  if (!editing.value || id === old) return
  if (id === props.cuisineId) {
    targetRegions.value = props.regions
    edit.regionId = props.dish.region_id
  } else {
    targetRegions.value = (await api(`/cuisines/${id}`)).regions
    edit.regionId = targetRegions.value[0]?.id ?? null
  }
})

// Your own dishes can also change emoji, description, type and ingredients; seeded ones get those from the seed.
const saveEdit = () => run(async () => {
  if (props.dish.is_custom && detailsError(edit.details)) throw new Error(detailsError(edit.details))
  const custom = props.dish.is_custom ? { emoji: edit.emoji, ...detailsBody(edit.details) } : {}
  const { ok, ...details } = await api(`/dishes/${props.dish.id}`, {
    method: 'PATCH',
    body: { name: edit.name, cuisine_id: edit.cuisineId, region_id: edit.regionId, ...custom },
  })
  if (edit.cuisineId !== props.cuisineId) emit('removed', { movedTo: edit.cuisineId })
  else emit('change', { ...props.dish, ...details, name: edit.name.trim(), region_id: edit.regionId })
  editing.value = false
})

const remove = () => run(async () => {
  if (!confirm(`Delete "${props.dish.name}"?`)) return
  await api(`/dishes/${props.dish.id}`, { method: 'DELETE' })
  emit('removed', {})
})

const onKey = e => e.key === 'Escape' && close()
onMounted(() => window.addEventListener('keydown', onKey))
// The back button closes the sheet without a blur, so save text that's still being typed.
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  saveText('note')
  saveText('place')
})
</script>

<template>
  <div class="overlay" @click.self="close">
    <div class="sheet card" role="dialog" aria-modal="true" :aria-label="dish.name">
      <button class="close link" aria-label="Close" @click="close">✕</button>

      <div class="hero" :class="dish.image ? 'illustration' : 'placeholder'">
        <img v-if="dish.image" :src="dish.image" :alt="dish.name" />
        <span v-else>{{ dish.emoji || '🍽️' }}</span>
      </div>

      <div class="stack body">
        <div>
          <h2 class="title">{{ dish.name }}</h2>
          <div class="chips">
            <span v-for="t in shownTags(dish.tags)" :key="t" class="tag">{{ TAGS[t] || t }}</span>
            <span v-if="dish.hidden" class="tag hidden-tag">Hidden</span>
            <span v-if="dish.is_custom" class="tag">Custom</span>
          </div>
        </div>

        <p v-if="dish.description || dish.wiki" class="desc">
          {{ dish.description }}
          <a v-if="dish.wiki" :href="wikiUrl(dish.wiki)" target="_blank" rel="noopener noreferrer" class="link-out">Wikipedia ↗</a>
        </p>

        <p v-if="dish.contains?.length" class="contains muted">
          Usually contains: {{ dish.contains.map(c => CONTAINS[c]?.replace(/^\S+\s/, '').toLowerCase() || c).join(', ') }}
        </p>

        <div v-if="dish.also?.length" class="also">
          <span class="muted">Also listed in</span>
          <button v-for="t in dish.also" :key="t.id" class="chip" @click="openTwin(t)">{{ t.cuisine_emoji }} {{ t.cuisine }}</button>
          <span class="muted">· ticking it here counts there too</span>
        </div>

        <div v-if="dish.status === 'tried'" class="row tried-row">
          <label class="field">
            Tried on
            <input type="date" :value="dish.tried_on" :max="today()"
              @change="e => e.target.value && save({ tried_on: e.target.value })" />
          </label>
          <div class="field rating">
            <span>Rating</span>
            <StarRating :model-value="dish.rating" @update:model-value="r => save({ rating: r })" />
          </div>
        </div>

        <label class="field">
          Note
          <textarea v-model="form.note" rows="2" maxlength="1000" placeholder="What did you think?" @blur="saveText('note')" />
        </label>

        <label class="field">
          Where to try it
          <input v-model="form.place" maxlength="200" placeholder="A restaurant, or a recipe link" @blur="saveText('place')" />
          <a v-if="isUrl(dish.place)" :href="dish.place" target="_blank" rel="noopener noreferrer" class="link-out">Open link ↗</a>
        </label>

        <p v-if="error" class="error">{{ error }}</p>

        <!-- Only admins edit the catalogue; everyone can hide a dish for themselves. -->
        <div v-if="!me.isAdmin" class="stack">
          <div><button class="btn small" :disabled="busy" @click="save({ hidden: !dish.hidden })">
            {{ dish.hidden ? '👁 Show again' : '🚫 Hide (can’t get it here)' }}
          </button></div>
          <span class="muted">Hidden dishes don’t count towards your progress.</span>
        </div>
        <div v-else class="edit">
          <button class="link muted toggle" @click="openEdit">{{ editing ? '▾' : '▸' }} Edit dish</button>
          <div v-if="editing" class="stack">
            <button class="btn small" :disabled="busy" @click="save({ hidden: !dish.hidden })">
              {{ dish.hidden ? '👁 Show again' : '🚫 Hide (can’t get it here)' }}
            </button>
            <span class="muted">Hidden dishes don’t count towards your progress.</span>

            <div class="row">
              <input v-if="dish.is_custom" v-model="edit.emoji" placeholder="🍽️" maxlength="8" class="emoji-in" aria-label="Emoji" />
              <label class="field grow">Name <input v-model="edit.name" maxlength="100" /></label>
            </div>
            <div class="row">
              <label class="field grow">
                Cuisine
                <select v-model="edit.cuisineId">
                  <option v-for="c in allCuisines" :key="c.id" :value="c.id">{{ c.emoji }} {{ c.name }}</option>
                </select>
              </label>
              <label class="field grow">
                Region
                <select v-model="edit.regionId">
                  <option :value="null">—</option>
                  <option v-for="r in targetRegions" :key="r.id" :value="r.id">{{ r.name }}</option>
                </select>
              </label>
            </div>
            <div v-if="dish.is_custom" class="row pic">
              <input ref="imageInput" type="file" accept="image/*" hidden @change="onImage" />
              <button class="btn small" :disabled="busy" @click="imageInput.click()">🖼️ {{ dish.image ? 'Change picture' : 'Add picture' }}</button>
              <button v-if="dish.image" class="btn small" :disabled="busy" @click="removeImage">Remove picture</button>
              <AiPromptHelp :name="dish.name" :cuisine="cuisineName" :description="dish.description || ''" />
            </div>
            <DishDetailsFields v-if="dish.is_custom" v-model="edit.details" />
            <div class="row">
              <button class="btn primary small" :disabled="busy || !edit.name.trim()" @click="saveEdit">Save changes</button>
              <button v-if="dish.is_custom" class="btn small danger" :disabled="busy" @click="remove">Delete dish</button>
            </div>
          </div>
        </div>
      </div>

      <div class="status">
        <button class="btn" :class="{ active: dish.status === 'tried' }" :disabled="busy" @click="setStatus('tried')">✓ Tried</button>
        <button class="btn" :class="{ wish: dish.status === 'wishlist' }" :disabled="busy" @click="setStatus('wishlist')">☆ Want to try</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; z-index: 50; background: var(--overlay);
  display: flex; align-items: center; justify-content: center;
}
/* Full screen on phones, a centred card from tablet width up. The status buttons are a footer that stays
   at the bottom, so a short dish doesn't leave an empty screen below them. */
.sheet {
  position: relative; width: 100%; height: 100%; overflow-y: auto; overscroll-behavior: contain;
  display: flex; flex-direction: column;
  padding: 0; border-radius: 0;
}
@media (max-width: 639px) { .sheet { border: 0; } }
@media (min-width: 640px) { .sheet { height: auto; max-width: 520px; max-height: 92vh; border-radius: 1.1rem; } }
.close {
  position: fixed; top: calc(.6rem + env(safe-area-inset-top)); right: .6rem; z-index: 2;
  width: 2rem; height: 2rem; border-radius: 50%; background: var(--close-bg); color: var(--text); font-size: 1rem;
}
@media (min-width: 640px) { .close { position: absolute; top: .6rem; } }
.hero { flex-shrink: 0; aspect-ratio: 16 / 9; background: var(--soft); overflow: hidden; display: grid; place-items: center; }
.hero img { width: 100%; height: 100%; object-fit: cover; }
.hero.illustration { aspect-ratio: 4 / 3; }
.hero.placeholder { font-size: 4.5rem; aspect-ratio: 16 / 6; }
.body { flex: 1 0 auto; padding: 1rem; }
.title { margin: 0 0 .4rem; }
.status {
  position: sticky; bottom: 0; z-index: 1; display: grid; grid-template-columns: 1fr 1fr; gap: .5rem;
  padding: .75rem 1rem calc(.75rem + env(safe-area-inset-bottom));
  background: var(--card); border-top: 1px solid var(--border);
}
.btn.wish { background: var(--amber); border-color: var(--amber); color: #1f2937; }
.tried-row { align-items: flex-end; gap: 1rem; }
.tried-row .field { flex: 1; min-width: 140px; }
.rating { display: flex; flex-direction: column; gap: .3rem; font-size: .85rem; color: var(--muted); }
.link-out { color: var(--green-dark); font-size: .85rem; }
.desc { margin: 0; line-height: 1.45; }
.contains { margin: 0; font-size: .85rem; }
.desc .link-out { white-space: nowrap; margin-left: .2rem; }
.also { display: flex; flex-wrap: wrap; gap: .4rem; align-items: center; font-size: .85rem; }
.also .chip { font-size: .8rem; padding: .2rem .6rem; }
.hidden-tag { background: var(--danger-soft); color: var(--danger); }
.toggle { padding: .3rem 0; }
.edit .stack { padding-top: .5rem; }
.pic { flex-wrap: wrap; }
.emoji-in { width: 4rem; text-align: center; align-self: flex-end; }
</style>
