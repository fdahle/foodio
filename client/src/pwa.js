import { ref } from 'vue'

// Chrome/Android hand us an install prompt; Safari never does, so the UI shows instructions instead.
export const installPrompt = ref(null)
export const installed = ref(window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true)

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault()
  installPrompt.value = e
})
window.addEventListener('appinstalled', () => {
  installed.value = true
  installPrompt.value = null
})

export async function install() {
  const p = installPrompt.value
  if (!p) return
  p.prompt()
  await p.userChoice
  installPrompt.value = null
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
