<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '../api.js'
import { pct, medal } from '../util.js'
import LevelCard from '../components/LevelCard.vue'
import BadgeGrid from '../components/BadgeGrid.vue'
import ProgressBar from '../components/ProgressBar.vue'
import WorldMap from '../components/WorldMap.vue'

const props = defineProps({ token: { type: String, required: true } })

const data = ref(null)
const error = ref('')
const selected = ref(null)

onMounted(async () => {
  try {
    data.value = await api(`/public/profile/${encodeURIComponent(props.token)}`)
  } catch (e) {
    error.value = e.status === 404 ? 'This profile link is not valid anymore.' : e.message
  }
})

const started = computed(() => (data.value?.cuisines ?? [])
  .filter(c => c.tried > 0 && (!selected.value || c.countries.includes(selected.value)))
  .sort((a, b) => pct(b.tried, b.total) - pct(a.tried, a.total) || b.tried - a.tried))
</script>

<template>
  <p v-if="error" class="empty">{{ error }}</p>
  <template v-if="data">
    <h1>{{ data.name ? `${data.name}’s food journey` : 'Food journey' }}</h1>
    <LevelCard :stats="data.stats" />

    <WorldMap class="public-map" :cuisines="data.cuisines" :selected="selected" @country="code => (selected = selected === code ? null : code)" />

    <h2>Cuisines <span class="muted">{{ selected ? 'in selected country' : `${started.length} started` }}</span></h2>
    <div class="grid">
      <div v-for="c in started" :key="c.id" class="card cuisine">
        <div class="row"><span class="emoji">{{ c.emoji }}</span><strong class="grow">{{ c.name }}</strong>{{ medal(pct(c.tried, c.total)) }}</div>
        <ProgressBar :tried="c.tried" :total="c.total" />
        <span class="muted">{{ c.tried }}/{{ c.total }} dishes</span>
      </div>
    </div>
    <p v-if="!started.length" class="empty">No dishes tried here yet.</p>

    <section class="card badges">
      <h3>Badges</h3>
      <BadgeGrid :badges="data.badges" earned-only />
    </section>
  </template>
</template>

<style scoped>
h1 { font-size: 1.4rem; }
.public-map { margin-top: .75rem; }
.badges { margin-top: .75rem; }
.badges h3 { margin: 0 0 .3rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: .6rem; }
.cuisine { display: flex; flex-direction: column; gap: .4rem; }
.emoji { font-size: 1.4rem; }
</style>
