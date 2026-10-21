import { ref, computed, watch } from 'vue'
import { loadPref, savePref } from './util.js'

// 'system' follows the device; 'light' and 'dark' override it through data-theme on <html> (see style.css).
// Per device, like the other UI preferences.
export const THEMES = { system: 'System', light: '☀️ Light', dark: '🌙 Dark' }
export const theme = ref(loadPref('theme', 'system'))

const scheme = window.matchMedia('(prefers-color-scheme: dark)')
const systemDark = ref(scheme.matches)
scheme.addEventListener('change', e => (systemDark.value = e.matches))

// Whether the page is dark right now, for code that reads colours from CSS (the map).
export const dark = computed(() => theme.value === 'dark' || (theme.value === 'system' && systemDark.value))

// Sync, so the CSS variables have changed before anything watching `dark` reads them.
watch(theme, t => {
  const root = document.documentElement
  if (t === 'system') delete root.dataset.theme
  else root.dataset.theme = t
  // index.html has one theme-color per scheme; an override switches on the matching one only.
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    m.dataset.media ??= m.media
    m.media = t === 'system' ? m.dataset.media : m.dataset.media.includes(t) ? 'all' : 'not all'
  }
  savePref('theme', t)
}, { immediate: true, flush: 'sync' })
