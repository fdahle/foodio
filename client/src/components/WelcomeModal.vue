<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { me, setCatchUp } from '../session.js'

// Shown once to new users. Most start by ticking everything they ate before, so they're offered a catch-up hour
// in which ticked dishes get no date and don't count for the date-based badges.
const emit = defineEmits(['close'])
const error = ref('')
const busy = ref(false)

async function startCatchUp() {
  error.value = ''
  busy.value = true
  try {
    await setCatchUp(true)
    emit('close')
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

const onKey = e => e.key === 'Escape' && emit('close')
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="sheet card stack" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <button class="close link" aria-label="Close" @click="emit('close')">✕</button>
      <h2 id="welcome-title">Welcome to Foodio, {{ me.username }}! 👋</h2>
      <p>Foodio keeps track of the dishes you try from cuisines all over the world. To get started:</p>
      <ol>
        <li>Eat vegetarian, vegan or avoid something? Set it in <router-link to="/settings" @click="emit('close')">Settings</router-link>,
          and dishes that don’t fit disappear.</li>
        <li>Browse the cuisines and tick the dishes you’ve already tried (the ✓ on each picture).</li>
        <li>Then let “What to try next?” and the monthly challenge give you ideas.</li>
      </ol>

      <div class="catch-up stack">
        <h3>⏱️ Already eaten lots of dishes?</h3>
        <p class="muted">Start with a catch-up hour: dishes you tick in the next hour count as tried, just without a date.
          They don’t count for the date-based achievements (like five dishes in one day, or a dish every month),
          which would otherwise be won by filling in your past.</p>
        <p v-if="error" class="error">{{ error }}</p>
        <div class="row">
          <button class="btn primary" :disabled="busy" @click="startCatchUp">Start catch-up hour</button>
          <button class="btn" @click="emit('close')">No thanks</button>
        </div>
        <p class="muted small">You can also start it later in Settings.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; z-index: 50; background: var(--overlay);
  display: flex; align-items: center; justify-content: center; padding: 1rem;
}
.sheet { position: relative; width: 100%; max-width: 520px; max-height: calc(100dvh - 2rem); overflow-y: auto; border-radius: 1.1rem; padding: 1.2rem; }
h2 { margin: 0; padding-right: 2.4rem; font-size: 1.2rem; }
h3 { margin: 0; font-size: 1rem; }
p, ol { margin: 0; }
ol { padding-left: 1.2rem; display: flex; flex-direction: column; gap: .35rem; }
.catch-up { background: var(--soft); border-radius: .8rem; padding: .9rem; }
.small { font-size: .8rem; }
a { color: var(--green-dark); font-weight: 600; }
.close {
  position: absolute; top: .6rem; right: .6rem;
  width: 2rem; height: 2rem; border-radius: 50%; background: var(--close-bg); color: var(--text); font-size: 1rem;
}
</style>
