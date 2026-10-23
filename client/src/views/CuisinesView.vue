<script>
// Kept while the app is open: coming back from a cuisine shows the list straight away (so the scroll
// position can be restored) and keeps what you typed. It's refreshed in the background.
const last = { cuisines: [], filter: '' }
window.addEventListener('foodio:unauthorized', () => Object.assign(last, { cuisines: [], filter: '' }))
</script>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { api } from '../api.js'
import { CONTINENTS, pct, medal, loadPref, savePref, fold } from '../util.js'
import ProgressBar from '../components/ProgressBar.vue'

const cuisines = ref(last.cuisines)
const error = ref('')

onMounted(async () => {
  try {
    cuisines.value = last.cuisines = await api('/cuisines')
  } catch (e) {
    error.value = e.message
  }
})

const filter = ref(last.filter)
watch(filter, v => { last.filter = v })
const startedOnly = ref(loadPref('startedOnly', false))
const sort = ref(loadPref('sort', 'name'))
const collapsed = ref(new Set(loadPref('collapsed', CONTINENTS)))
watch(startedOnly, v => savePref('startedOnly', v))
watch(sort, v => savePref('sort', v))

const SORTS = {
  name: (a, b) => a.name.localeCompare(b.name),
  progress: (a, b) => pct(b.tried, b.total) - pct(a.tried, a.total) || a.name.localeCompare(b.name),
  size: (a, b) => b.total - a.total,
}

const groups = computed(() => {
  const f = fold(filter.value)
  const visible = cuisines.value
    .filter(c => !startedOnly.value || c.tried > 0)
    .filter(c => !f || fold(c.name).includes(f))
    .sort(SORTS[sort.value])
  return CONTINENTS.map(name => {
    const all = cuisines.value.filter(c => c.continent === name)
    return {
      name,
      items: visible.filter(c => c.continent === name),
      tried: all.reduce((s, c) => s + c.tried, 0),
      total: all.reduce((s, c) => s + c.total, 0),
      started: all.filter(c => c.tried > 0).length,
      count: all.length,
    }
  }).filter(g => g.items.length)
})

// Filtering by name opens every group so matches are visible.
const isOpen = g => !!filter.value.trim() || !collapsed.value.has(g.name)
function toggleGroup(name) {
  const s = new Set(collapsed.value)
  s.has(name) ? s.delete(name) : s.add(name)
  collapsed.value = s
  savePref('collapsed', [...s])
}
function setAll(open) {
  collapsed.value = new Set(open ? [] : CONTINENTS)
  savePref('collapsed', [...collapsed.value])
}
</script>

<template>
  <p v-if="error" class="error">{{ error }}</p>

  <h1>Cuisines</h1>
  <div class="row controls">
    <input v-model="filter" type="search" placeholder="Filter cuisines…" class="grow" />
    <select v-model="sort">
      <option value="name">A–Z</option>
      <option value="progress">Progress</option>
      <option value="size">Most dishes</option>
    </select>
  </div>
  <div class="row controls">
    <button class="chip" :class="{ active: startedOnly }" @click="startedOnly = !startedOnly">Started only</button>
    <button class="chip" @click="setAll(true)">Expand all</button>
    <button class="chip" @click="setAll(false)">Collapse all</button>
  </div>

  <section v-for="g in groups" :key="g.name" class="group">
    <button class="group-head" :aria-expanded="isOpen(g)" @click="toggleGroup(g.name)">
      <span class="caret">{{ isOpen(g) ? '▾' : '▸' }}</span>
      <span class="grow">
        <b>{{ g.name }}</b>
        <span class="muted"> · {{ g.started }}/{{ g.count }} started</span>
      </span>
      <span class="muted">{{ pct(g.tried, g.total) }}%</span>
    </button>
    <div v-if="isOpen(g)" class="grid">
      <router-link v-for="c in g.items" :key="c.id" :to="`/cuisine/${c.id}`" class="card cuisine">
        <div class="row between">
          <span class="emoji">{{ c.emoji }}</span>
          <span>{{ medal(pct(c.tried, c.total)) }}</span>
        </div>
        <strong>{{ c.name }}</strong>
        <ProgressBar :tried="c.tried" :wishlist="c.wishlist" :total="c.total" />
        <span class="muted">{{ c.tried }}/{{ c.total }} tried<template v-if="c.wishlist"> · {{ c.wishlist }} ☆</template></span>
      </router-link>
    </div>
  </section>
  <p v-if="cuisines.length && !groups.length" class="empty">No cuisines match.</p>
</template>

<style scoped>
h1 { margin: 0 0 .8rem; font-size: 1.4rem; }
.between { justify-content: space-between; }
.controls { margin-bottom: .5rem; }
.controls select { width: auto; }
.group { margin-bottom: .5rem; }
.group-head {
  width: 100%; display: flex; gap: .5rem; align-items: center; text-align: left;
  background: var(--card); border: 1px solid var(--border); border-radius: .7rem; padding: .7rem .8rem; color: var(--text);
}
.caret { width: 1rem; color: var(--muted); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: .6rem; padding: .6rem 0 .4rem; }
.cuisine { display: flex; flex-direction: column; gap: .4rem; }
.cuisine .emoji { font-size: 1.6rem; }
</style>
