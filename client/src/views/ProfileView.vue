<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '../api.js'
import { formatMonth } from '../util.js'
import LevelCard from '../components/LevelCard.vue'
import BadgeGrid from '../components/BadgeGrid.vue'
import DishRow from '../components/DishRow.vue'

const data = ref(null)
const activity = ref(null)
const favorites = ref([])
const error = ref('')
const hover = ref(null)

onMounted(async () => {
  try {
    const [s, a, f] = await Promise.all([api('/stats'), api('/activity'), api('/favorites')])
    data.value = s
    activity.value = a
    favorites.value = f
  } catch (e) {
    error.value = e.message
  }
})

// Every badge level counts, so a three-level badge is worth three.
const earned = computed(() => data.value?.badges.reduce((s, b) => s + b.tier, 0) ?? 0)
const levels = computed(() => data.value?.badges.reduce((s, b) => s + b.tiers, 0) ?? 0)

// Last 12 months including empty ones, so gaps show as gaps.
const months = computed(() => {
  const counts = Object.fromEntries((activity.value?.months ?? []).map(m => [m.month, m.n]))
  const now = new Date()
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    return { key, n: counts[key] || 0 }
  })
})
const maxMonth = computed(() => Math.max(1, ...months.value.map(m => m.n)))
</script>

<template>
  <p v-if="error" class="error">{{ error }}</p>
  <template v-if="data">
    <LevelCard :stats="data.stats">
      <p class="muted xp-help">
        XP: 10 per dish, 2 per rating, 50 per completed region, 100 per monthly challenge, 200 per completed cuisine.
      </p>
    </LevelCard>

    <section class="card block chart">
      <h3>Dishes tried per month</h3>
      <div class="readout muted">
        <template v-if="hover">{{ formatMonth(hover.key) }}: <b>{{ hover.n }}</b> dish{{ hover.n === 1 ? '' : 'es' }}</template>
        <template v-else>Last 12 months · {{ months.reduce((s, m) => s + m.n, 0) }} dishes</template>
      </div>
      <div class="bars" @mouseleave="hover = null">
        <div v-for="m in months" :key="m.key" class="col" :class="{ active: hover?.key === m.key }"
          tabindex="0" :aria-label="`${formatMonth(m.key)}: ${m.n}`"
          @mouseenter="hover = m" @focus="hover = m" @blur="hover = null">
          <div class="fill" :style="{ height: m.n ? `${(m.n / maxMonth) * 100}%` : '0' }" />
        </div>
      </div>
      <div class="labels">
        <span v-for="(m, i) in months" :key="m.key" class="muted">{{ i % 2 === 0 ? formatMonth(m.key) : '' }}</span>
      </div>
    </section>

    <div class="two">
      <section class="card block">
        <h3>Recently tried</h3>
        <div class="list scroll">
          <DishRow v-for="d in activity.recent" :key="d.id" :dish="d" />
          <p v-if="!activity.recent.length" class="empty">Nothing yet. Mark a dish as tried!</p>
        </div>
      </section>
      <section class="card block">
        <h3>Favorites</h3>
        <div class="list scroll">
          <DishRow v-for="d in favorites" :key="d.id" :dish="d" />
          <p v-if="!favorites.length" class="empty">Rate dishes 4★ or more to see them here.</p>
        </div>
      </section>
    </div>

    <section class="card block">
      <h3>Badges <span class="muted count">{{ earned }} / {{ levels }}</span></h3>
      <BadgeGrid :badges="data.badges" />
    </section>
  </template>
</template>

<style scoped>
.xp-help { margin: 0; font-size: .8rem; }
.block { margin-top: .75rem; display: flex; flex-direction: column; gap: .6rem; }
.block h3 { margin: 0; }
.count { font-weight: 400; font-size: .85rem; }
.readout { min-height: 1.2rem; }
.readout b { color: var(--text); }
.bars { display: grid; grid-template-columns: repeat(12, 1fr); gap: 2px; height: 140px; align-items: end; border-bottom: 1px solid var(--border); }
.col { height: 100%; display: flex; align-items: flex-end; justify-content: center; cursor: default; outline: none; border-radius: 4px 4px 0 0; }
.col.active { background: var(--soft); }
.fill { width: 60%; max-width: 28px; background: var(--green); border-radius: 4px 4px 0 0; min-height: 0; }
.labels { display: grid; grid-template-columns: repeat(12, 1fr); text-align: center; }
.labels span { font-size: .7rem; white-space: nowrap; }
.two { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0 .75rem; }
/* Long lists scroll inside their card instead of stretching the page. */
.scroll { max-height: 22rem; overflow-y: auto; overscroll-behavior: contain; }
</style>
