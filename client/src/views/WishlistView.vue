<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '../api.js'
import { showToast, alsoIn } from '../toast.js'
import DishRow from '../components/DishRow.vue'

const dishes = ref(null)
const error = ref('')

onMounted(async () => {
  try {
    dishes.value = await api('/wishlist')
  } catch (e) {
    error.value = e.message
  }
})

const groups = computed(() => {
  const out = new Map()
  for (const d of dishes.value ?? []) {
    if (!out.has(d.cuisine_id)) out.set(d.cuisine_id, { id: d.cuisine_id, name: d.cuisine, emoji: d.cuisine_emoji, dishes: [] })
    out.get(d.cuisine_id).dishes.push(d)
  }
  return [...out.values()]
})

async function setStatus(d, status) {
  const { synced } = await api(`/dishes/${d.id}/user`, { method: 'PATCH', body: { status } })
  dishes.value = dishes.value.filter(x => x.id !== d.id)
  showToast([status === 'tried' ? `Tried: ${d.name} 🎉` : `Removed ${d.name} from wishlist`, alsoIn(synced)].filter(Boolean).join(' · '), {
    label: 'Undo',
    run: async () => {
      await api(`/dishes/${d.id}/user`, { method: 'PATCH', body: { status: 'wishlist' } })
      dishes.value = await api('/wishlist')
    },
  })
}
</script>

<template>
  <h1>Wishlist <span v-if="dishes" class="muted">{{ dishes.length }}</span></h1>
  <p v-if="error" class="error">{{ error }}</p>
  <p v-if="dishes && !dishes.length" class="empty">
    Nothing here yet. Tap “☆ Want to try” on a dish to save it for later.
  </p>
  <section v-for="g in groups" :key="g.id">
    <h2><router-link :to="`/cuisine/${g.id}`">{{ g.emoji }} {{ g.name }}</router-link></h2>
    <div class="card list">
      <DishRow v-for="d in g.dishes" :key="d.id" :dish="d" desc :mark="false">
        <div class="actions">
          <button class="btn small primary" title="Mark as tried" @click.prevent.stop="setStatus(d, 'tried')">✓ Tried</button>
          <button class="btn small" title="Remove from wishlist" aria-label="Remove from wishlist" @click.prevent.stop="setStatus(d, null)">✕</button>
        </div>
      </DishRow>
    </div>
  </section>
</template>

<style scoped>
h1 { font-size: 1.4rem; }
.list { padding: .2rem .8rem; }
.actions { display: flex; gap: .35rem; flex: none; }
@media (max-width: 520px) {
  .list-item { flex-wrap: wrap; }
  .actions { width: 100%; padding-left: 2.4rem; }
}
</style>
