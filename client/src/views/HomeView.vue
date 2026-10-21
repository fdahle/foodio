<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../api.js'
import { me, markWelcomed } from '../session.js'
import { TAG_PLURALS, loadPref, savePref, blankFilters, activeTags, filtersLabel, fold } from '../util.js'
import LevelCard from '../components/LevelCard.vue'
import ProgressBar from '../components/ProgressBar.vue'
import WorldMap from '../components/WorldMap.vue'
import DishRow from '../components/DishRow.vue'
import TagFilter from '../components/TagFilter.vue'
import WelcomeModal from '../components/WelcomeModal.vue'

const cuisines = ref([])
const stats = ref(null)

// New users (nothing tried yet) get a welcome, with the offer of a catch-up hour, once per account.
const route = useRoute()
const showWelcome = computed(() => !me.welcomed && (route.query.welcome || stats.value?.tried === 0))
const challenge = ref(null)
const error = ref('')

onMounted(async () => {
  try {
    const [c, s, ch] = await Promise.all([api('/cuisines'), api('/stats'), api('/challenge')])
    cuisines.value = c
    stats.value = s.stats
    challenge.value = ch
  } catch (e) {
    error.value = e.message
  }
  suggest()
})

// Search
const query = ref('')
const filters = ref(blankFilters())
const filtersOpen = ref(false)
const results = ref([])
const didYouMean = ref([])
let searchTimer
watch([query, filters], () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(async () => {
    const q = query.value.trim()
    const tags = activeTags(filters.value)
    if (q.length < 2 && !tags.length) {
      results.value = []
      didYouMean.value = []
      return
    }
    const found = await api(`/search?q=${encodeURIComponent(q)}&tags=${tags.join(',')}`)
    results.value = found.results
    didYouMean.value = found.didYouMean
  }, 200)
}, { deep: true })
const searching = computed(() => query.value.trim().length >= 2 || activeTags(filters.value).length > 0)
const cuisineMatches = computed(() => {
  const q = fold(query.value)
  return q.length < 2 ? [] : cuisines.value.filter(c => fold(c.name).includes(q)).slice(0, 6)
})

// Suggestions
const MODES = { random: '🎲 Anything', close: '🏁 Almost done', new: '🌱 New cuisine', wishlist: '☆ Wishlist' }
const mode = ref(loadPref('suggestMode', 'random'))
const suggestion = ref(undefined)
async function suggest() {
  savePref('suggestMode', mode.value)
  suggestion.value = await api(`/suggest?mode=${mode.value}`).catch(() => null)
}
watch(mode, suggest)

// Map
const selectedCountry = ref(null)
const mapRef = ref(null)
const countryCuisines = computed(() =>
  selectedCountry.value ? cuisines.value.filter(c => c.countries.includes(selectedCountry.value)) : [])
const toggleCountry = code => (selectedCountry.value = selectedCountry.value === code ? null : code)
</script>

<template>
  <p v-if="error" class="error">{{ error }}</p>

  <WelcomeModal v-if="showWelcome" @close="markWelcomed" />

  <LevelCard v-if="stats" :stats="stats" compact />

  <div class="two">
    <section class="card">
      <h3>What to try next?</h3>
      <div class="chips">
        <button v-for="(label, key) in MODES" :key="key" class="chip" :class="{ active: mode === key }" @click="mode = key">{{ label }}</button>
      </div>
      <div v-if="suggestion" class="list">
        <DishRow :dish="suggestion" desc />
      </div>
      <p v-else-if="suggestion === null" class="empty">Nothing to suggest here.</p>
      <button class="btn small" @click="suggest">Another one</button>
    </section>

    <section v-if="challenge" class="card">
      <h3>🎯 {{ new Date(`${challenge.month}-15`).toLocaleDateString(undefined, { month: 'long' }) }} challenge</h3>
      <p class="muted">Try {{ challenge.dishes.length }} {{ TAG_PLURALS[challenge.tag] || `${challenge.tag} dishes` }} from different parts of the world.</p>
      <div class="list">
        <DishRow v-for="d in challenge.dishes" :key="d.id" :dish="d" desc />
      </div>
      <p v-if="challenge.done" class="done">🎉 Challenge complete! +100 XP</p>
    </section>
  </div>

  <WorldMap v-if="cuisines.length" ref="mapRef" :cuisines="cuisines" :selected="selectedCountry" class="home-map" @country="toggleCountry">
    <div v-if="countryCuisines.length" class="country">
      <div class="row between">
        <strong>{{ mapRef?.countryName(selectedCountry) }}</strong>
        <button class="link muted" @click="selectedCountry = null">✕</button>
      </div>
      <div v-for="c in countryCuisines" :key="c.id" class="stack country-cuisine">
        <router-link :to="`/cuisine/${c.id}`" class="row between">
          <span>{{ c.emoji }} <b>{{ c.name }}</b></span>
          <span class="muted">{{ c.tried }}/{{ c.total }} →</span>
        </router-link>
        <div v-for="r in c.regions" :key="r.id" class="region">
          <span class="muted">{{ r.name }}</span>
          <ProgressBar :tried="r.tried" :total="r.total" />
          <span class="muted">{{ r.tried }}/{{ r.total }}</span>
        </div>
      </div>
    </div>
  </WorldMap>

  <section class="card search">
    <h3>Search</h3>
    <input v-model="query" type="search" placeholder="🔍 Search all dishes…" />
    <div class="chips">
      <button class="chip" :class="{ active: activeTags(filters).length }" :aria-expanded="filtersOpen" @click="filtersOpen = !filtersOpen">
        {{ filtersLabel(filters) || '🏷️ Filter by type, diet…' }} {{ filtersOpen ? '▴' : '▾' }}
      </button>
      <button v-if="activeTags(filters).length" class="chip" @click="filters = blankFilters()">✕ Clear</button>
    </div>
    <TagFilter v-if="filtersOpen" v-model="filters" class="filter-box" />
    <div v-if="searching" class="list results">
      <div v-if="cuisineMatches.length" class="chips cuisine-hits">
        <router-link v-for="c in cuisineMatches" :key="c.id" :to="`/cuisine/${c.id}`" class="chip">
          {{ c.emoji }} {{ c.name }} <span class="muted">{{ c.tried }}/{{ c.total }}</span>
        </router-link>
      </div>
      <p v-if="didYouMean.length" class="did-you-mean">
        Did you mean
        <button v-for="name in didYouMean" :key="name" class="chip" @click="query = name">{{ name }}</button>
      </p>
      <DishRow v-for="d in results" :key="d.id" :dish="d" />
      <p v-if="!results.length && !cuisineMatches.length && !didYouMean.length" class="empty">No dishes found.</p>
    </div>
  </section>
</template>

<style scoped>
.search { margin: .75rem 0 1rem; display: flex; flex-direction: column; gap: .6rem; }
.search h3 { margin: 0; }
.did-you-mean { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; }
.filter-box { background: var(--bg); border-radius: .6rem; padding: .6rem; }
.results { max-height: 50vh; overflow-y: auto; border-top: 1px solid var(--border); }
.two { margin-top: 1rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: .75rem; }
.two .card { display: flex; flex-direction: column; gap: .6rem; }
.two h3, .two p { margin: 0; }
.done { color: var(--green-dark); font-weight: 600; }
.between { justify-content: space-between; }
.home-map { margin-top: .75rem; }
.country { border-top: 1px solid var(--border); padding-top: .8rem; display: flex; flex-direction: column; gap: .8rem; }
.country-cuisine { gap: .35rem; }
.region { display: grid; grid-template-columns: minmax(90px, 35%) 1fr auto; gap: .6rem; align-items: center; font-size: .85rem; }
.cuisine-hits { padding: .6rem 0 .3rem; border-bottom: 1px solid var(--border); }
</style>
