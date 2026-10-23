<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api.js'
import { TAGS, pct, medal, splitName, loadPref, savePref, blankFilters, activeTags, filtersLabel } from '../util.js'
import { showToast, alsoIn } from '../toast.js'
import ProgressBar from '../components/ProgressBar.vue'
import StarRating from '../components/StarRating.vue'
import DishSheet from '../components/DishSheet.vue'
import SuggestDishSheet from '../components/SuggestDishSheet.vue'
import { me } from '../session.js'
import TagFilter from '../components/TagFilter.vue'

const props = defineProps({ id: { type: String, required: true } })
const route = useRoute()
const router = useRouter()

const cuisine = ref(null)
const error = ref('')
const status = ref('all')
const filters = ref(blankFilters())
const region = ref(null)

// Regions and dish types fold away so the dishes start higher up on a phone.
const regionsOpen = ref(loadPref('regionsOpen', window.innerWidth > 600))
watch(regionsOpen, v => savePref('regionsOpen', v))
const tagsOpen = ref(false)

async function load() {
  error.value = ''
  try {
    cuisine.value = await api(`/cuisines/${props.id}`)
  } catch (e) {
    error.value = e.message
  }
}
watch(() => props.id, () => {
  cuisine.value = null
  status.value = 'all'
  filters.value = blankFilters()
  tagsOpen.value = false
  region.value = null
  load()
}, { immediate: true })

const visible = computed(() => cuisine.value?.dishes.filter(d => !d.hidden) ?? [])
const counts = computed(() => ({
  all: visible.value.length,
  todo: visible.value.filter(d => d.status !== 'tried').length,
  tried: visible.value.filter(d => d.status === 'tried').length,
  wishlist: visible.value.filter(d => d.status === 'wishlist').length,
  hidden: (cuisine.value?.dishes.length ?? 0) - visible.value.length,
}))
const percent = computed(() => pct(counts.value.tried, counts.value.all))

const regionStats = computed(() => (cuisine.value?.regions ?? []).map(r => {
  const ds = visible.value.filter(d => d.region_id === r.id)
  return { ...r, total: ds.length, tried: ds.filter(d => d.status === 'tried').length }
}).filter(r => r.total > 0 || r.is_custom))

// Filters
const STATUS = { all: 'All', todo: 'To try', tried: 'Tried', wishlist: '☆ Wishlist', hidden: 'Hidden' }
// Un-hiding the last hidden dish removes the Hidden chip, so don't leave its filter active.
watch(() => counts.value.hidden, n => { if (!n && status.value === 'hidden') status.value = 'all' })
const regionName = computed(() => cuisine.value?.regions.find(r => r.id === region.value)?.name)
const presentTags = computed(() => Object.keys(TAGS).filter(t => visible.value.some(d => d.tags.includes(t))))

const matches = d => {
  if (status.value === 'hidden') { if (!d.hidden) return false } else if (d.hidden) return false
  if (status.value === 'todo' && d.status === 'tried') return false
  if (status.value === 'tried' && d.status !== 'tried') return false
  if (status.value === 'wishlist' && d.status !== 'wishlist') return false
  if (!activeTags(filters.value).every(t => d.tags.includes(t))) return false
  if (region.value && d.region_id !== region.value) return false
  return true
}

const sections = computed(() => {
  if (!cuisine.value) return []
  const ds = cuisine.value.dishes.filter(matches)
  const out = cuisine.value.regions.map(r => ({ id: r.id, name: r.name, dishes: ds.filter(d => d.region_id === r.id) }))
  out.push({ id: null, name: 'Other', dishes: ds.filter(d => !d.region_id) })
  return out.filter(s => s.dishes.length)
})

// Dish sheet is driven by ?dish= so search results and links can open it directly. Opening one here adds a
// history entry, so the phone's back button closes it instead of leaving the cuisine. Closing goes back to
// where it was opened (this cuisine, or home, search, wishlist…); a dish opened by a link just closes.
const openDish = computed(() => cuisine.value?.dishes.find(d => d.id === Number(route.query.dish)) ?? null)
const open = d => router.push({ query: { dish: d.id } })
const close = () => (window.history.state?.back ? router.back() : router.replace({ query: {} }))

function replaceDish(next) {
  const i = cuisine.value.dishes.findIndex(d => d.id === next.id)
  if (i >= 0) cuisine.value.dishes[i] = next
}

async function setUser(d, body) {
  const { synced, ...u } = await api(`/dishes/${d.id}/user`, { method: 'PATCH', body })
  replaceDish({ ...d, ...u })
  return synced
}

// Tapping a card toggles tried; that's easy to do by accident on a phone, so it always offers undo.
async function quickTried(d) {
  const before = { status: d.status, tried_on: d.tried_on, rating: d.rating }
  const nowTried = d.status !== 'tried'
  let synced
  try {
    synced = await setUser(d, { status: nowTried ? 'tried' : null })
  } catch (e) {
    showToast(`Couldn’t save: ${e.message}`)
    return
  }
  const msg = `${nowTried ? 'Tried' : 'Unmarked'}: ${d.name}`
  showToast([msg, alsoIn(synced)].filter(Boolean).join(' · '), {
    label: 'Undo',
    run: () => {
      const now = cuisine.value?.dishes.find(x => x.id === d.id)
      if (now) setUser(now, before).catch(e => showToast(`Couldn’t undo: ${e.message}`))
    },
  })
}

async function onRemoved({ movedTo }) {
  await router.replace({ query: {} })
  if (movedTo) await router.push(`/cuisine/${movedTo}`)
  else await load()
}

// New dishes go into the seed by hand, so everyone (admins too) suggests them; they collect in the Users tab.
const suggesting = ref(false)
function onSuggested(name) {
  suggesting.value = false
  showToast(me.isAdmin ? `“${name}” is on the list to add.` : `Thanks! “${name}” was suggested.`)
}

// The back bar only gets its background and divider once the page scrolls under it.
const stuck = ref(false)
const onScroll = () => { stuck.value = window.scrollY > 0 }
onMounted(() => { onScroll(); window.addEventListener('scroll', onScroll, { passive: true }) })
onUnmounted(() => window.removeEventListener('scroll', onScroll))

async function deleteCuisine() {
  if (!confirm(`Delete ${cuisine.value.name} and all its dishes?`)) return
  await api(`/cuisines/${cuisine.value.id}`, { method: 'DELETE' })
  router.push('/cuisines')
}
</script>

<template>
  <p v-if="error" class="error">{{ error }}</p>
  <template v-if="cuisine">
    <Teleport defer to="#subbar">
      <div class="back" :class="{ stuck }"><router-link to="/cuisines" class="muted">← All cuisines</router-link></div>
    </Teleport>

    <header class="card head">
      <div class="row">
        <span class="flag">{{ cuisine.emoji }}</span>
        <div class="grow">
          <h1>{{ cuisine.name }} {{ medal(percent) }}</h1>
          <span class="muted">{{ cuisine.continent }}</span>
        </div>
        <div class="big">{{ percent }}%</div>
      </div>
      <ProgressBar :tried="counts.tried" :wishlist="counts.wishlist" :total="counts.all" />
      <span class="muted">
        {{ counts.tried }} of {{ counts.all }} tried<template v-if="counts.wishlist"> · {{ counts.wishlist }} on wishlist</template><template v-if="counts.hidden"> · {{ counts.hidden }} hidden</template>
      </span>

      <div v-if="regionStats.length > 1" class="row fold">
        <button class="link fold-toggle" :aria-expanded="regionsOpen" @click="regionsOpen = !regionsOpen">
          <span class="caret">{{ regionsOpen ? '▾' : '▸' }}</span> {{ regionStats.length }} regions<template v-if="!regionsOpen && regionName"> · <b>{{ regionName }}</b></template>
        </button>
        <button v-if="!regionsOpen && region" class="link muted" aria-label="Show all regions" @click="region = null">✕</button>
      </div>
      <div v-if="regionStats.length > 1 && regionsOpen" class="regions">
        <button v-for="r in regionStats" :key="r.id" class="region" :class="{ active: region === r.id }"
          @click="region = region === r.id ? null : r.id">
          <span class="row between"><span>{{ r.name }}</span><span class="muted">{{ r.tried }}/{{ r.total }} {{ r.total && r.tried === r.total ? '✓' : '' }}</span></span>
          <ProgressBar :tried="r.tried" :total="r.total" />
        </button>
      </div>
    </header>

    <div class="filters">
      <div class="chips">
        <template v-for="(label, key) in STATUS" :key="key">
          <button v-if="key !== 'hidden' || counts.hidden" class="chip" :class="{ active: status === key }" @click="status = key">
            {{ label }} <span class="count">{{ counts[key] }}</span>
          </button>
        </template>
        <button v-if="presentTags.length" class="chip" :class="{ active: activeTags(filters).length }" :aria-expanded="tagsOpen" @click="tagsOpen = !tagsOpen">
          {{ filtersLabel(filters) || '🏷️ Filter' }} <span class="count">{{ tagsOpen ? '▴' : '▾' }}</span>
        </button>
      </div>
      <div v-if="tagsOpen && presentTags.length" class="card tag-box">
        <TagFilter v-model="filters" :available="presentTags" />
        <div class="row">
          <button class="btn small primary" @click="tagsOpen = false">Done</button>
          <button v-if="activeTags(filters).length" class="btn small" @click="filters = blankFilters()">Clear</button>
        </div>
      </div>
    </div>

    <section v-for="s in sections" :key="s.id ?? 'other'">
      <h2 v-if="sections.length > 1 || cuisine.regions.length > 1">{{ s.name }}</h2>
      <div class="dishes">
        <div v-for="d in s.dishes" :key="d.id" class="card dish" :class="{ tried: d.status === 'tried', hidden: d.hidden }"
          role="button" tabindex="0" :aria-pressed="d.status === 'tried'" :aria-label="`${d.name}: ${d.status === 'tried' ? 'tried' : 'not tried'}`"
          @click="quickTried(d)" @keydown.enter.self="quickTried(d)">
          <div class="thumb" :class="{ placeholder: !d.image }">
            <img v-if="d.image" :src="d.image" :alt="d.name" loading="lazy" />
            <span v-else>{{ d.emoji || '🍽️' }}</span>
            <span v-if="d.status === 'wishlist'" class="wish">☆</span>
            <button class="info-btn" :aria-label="`About ${d.name}`" @click.stop="open(d)">i</button>
            <span v-if="d.status === 'tried'" class="check" aria-hidden="true">✓</span>
          </div>
          <div class="info">
            <span class="name">{{ splitName(d.name)[0] }}</span>
            <span v-if="splitName(d.name)[1]" class="alt muted">{{ splitName(d.name)[1] }}</span>
            <StarRating v-if="d.rating" :model-value="d.rating" readonly />
          </div>
        </div>
      </div>
    </section>
    <p v-if="!sections.length" class="empty">No dishes match these filters.</p>

    <div class="add-dish">
      <button class="btn" @click="suggesting = true">{{ me.isAdmin ? '+ Add a dish' : '💡 Suggest a dish' }}</button>
    </div>

    <p v-if="cuisine.is_custom && me.isAdmin" class="danger-zone">
      <button class="btn danger small" @click="deleteCuisine">Delete this cuisine</button>
    </p>

    <DishSheet v-if="openDish" :dish="openDish" :cuisine-id="cuisine.id" :regions="cuisine.regions"
      @change="replaceDish" @close="close" @removed="onRemoved" />
    <SuggestDishSheet v-if="suggesting" :cuisine="cuisine" @close="suggesting = false" @sent="onSuggested" />
  </template>
</template>

<style scoped>
/* Sticks under the top bar (teleported into it), full width, with the link lined up with main's content. */
/* Background only once stuck: at rest nothing is underneath, and an opaque bar there renders a green seam on phones. */
.back { padding: .65rem max(1rem, calc(50% - 500px + 1rem)); }
.back.stuck { background: var(--bg); box-shadow: 0 1px 0 var(--border); }
/* margin-top: main's top padding now sits below the back bar, so cancel it. */
.head { display: flex; flex-direction: column; gap: .6rem; margin-top: -1rem; }
.head h1 { margin: 0; font-size: 1.4rem; }
.flag { font-size: 2.4rem; }
.big { font-size: 1.6rem; font-weight: 800; color: var(--green-dark); }
.between { justify-content: space-between; }
.fold { gap: .3rem; }
.tag-box { display: flex; flex-direction: column; gap: .7rem; }
.fold-toggle { padding: 0; color: var(--text); opacity: 1; font-size: .9rem; text-align: left; }
.caret { display: inline-block; width: 1rem; color: var(--muted); }
.regions { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: .5rem; margin-top: .3rem; }
.region {
  display: flex; flex-direction: column; gap: .35rem; text-align: left; font-size: .85rem;
  background: var(--bg); border: 1px solid var(--border); border-radius: .6rem; padding: .5rem .6rem; color: var(--text);
}
.region.active { border-color: var(--green); box-shadow: 0 0 0 1px var(--green); }
.filters { display: flex; flex-direction: column; gap: .5rem; margin: 1rem 0 .5rem; }
.count { opacity: .7; font-size: .75rem; }
.dishes { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: .6rem; }
.dish { position: relative; padding: 0; overflow: hidden; cursor: pointer; display: flex; flex-direction: column; }
.dish.tried { border-color: var(--tried-border); }
.dish.hidden { opacity: .55; }
.thumb { position: relative; aspect-ratio: 4 / 3; background: var(--soft); display: grid; place-items: center; font-size: 2.6rem; }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.thumb .wish { position: absolute; top: .3rem; left: .4rem; font-size: 1rem; color: var(--amber); }
.info { padding: .5rem .6rem .6rem; display: flex; flex-direction: column; gap: .2rem; }
/* Break between words; only split a word that's wider than the card on its own. */
.name { font-weight: 600; font-size: .9rem; line-height: 1.25; overflow-wrap: break-word; text-wrap: balance; }
.alt { font-size: .78rem; line-height: 1.2; overflow-wrap: break-word; text-wrap: balance; }
/* Both sit on the image corners so long names get the card's full width. */
.check, .info-btn {
  position: absolute; width: 1.9rem; height: 1.9rem; border-radius: 50%; padding: 0;
  display: grid; place-items: center; font-size: 1rem; font-weight: 800;
  border: 2px solid #fff; box-shadow: 0 1px 3px rgb(0 0 0 / .3);
}
.check { right: .4rem; bottom: .4rem; background: var(--green); color: var(--on-green); pointer-events: none; }
.info-btn { right: .4rem; top: .4rem; background: rgb(0 0 0 / .35); color: #fff; font-family: Georgia, serif; font-style: italic; }
/* A bigger invisible hit area than the visible circle, so it's easy to tap without toggling the card. */
.info-btn::after { content: ''; position: absolute; inset: -.6rem; }
.add-dish { margin-top: 1.2rem; }
.danger-zone { margin-top: 2rem; }
</style>
