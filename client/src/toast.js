import { ref } from 'vue'

// One toast at a time; a new one replaces the old. `action` is { label, run }.
export const toast = ref(null)
let timer

export function showToast(message, action = null, ms = 5000) {
  clearTimeout(timer)
  toast.value = { message, action, key: Date.now() }
  timer = setTimeout(() => (toast.value = null), ms)
}

export async function runToastAction() {
  const action = toast.value?.action
  toast.value = null
  await action?.run()
}

export const alsoIn = synced =>
  synced?.length ? `Also updated in ${synced.map(t => `${t.cuisine_emoji} ${t.cuisine}`).join(', ')}` : ''
