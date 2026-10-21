<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { me, setCatchUp } from '../session.js'
import { showToast } from '../toast.js'

// Reminds that the catch-up hour is running (ticked dishes get no date) and lets it end early.
const now = ref(Date.now())
let timer
onMounted(() => { timer = setInterval(() => (now.value = Date.now()), 15000) })
onBeforeUnmount(() => clearInterval(timer))

const minutesLeft = computed(() => (me.catchUpUntil ? Math.ceil((me.catchUpUntil - now.value) / 60000) : 0))

const stop = () => setCatchUp(false).catch(e => showToast(`Couldn’t stop it: ${e.message}`))
</script>

<template>
  <div v-if="minutesLeft > 0" class="catch-up" role="status">
    <span class="grow">⏱️ <b>Catch-up hour:</b> dishes you tick now get no date · {{ minutesLeft }} min left</span>
    <button class="link stop" @click="stop">Stop</button>
  </div>
</template>

<style scoped>
.catch-up {
  display: flex; gap: .8rem; align-items: center; padding: .45rem 1rem; font-size: .85rem;
  background: var(--soft); border-bottom: 1px solid var(--border);
}
.stop { color: var(--green-dark); font-weight: 700; }
</style>
