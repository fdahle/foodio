<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import jsVectorMap from '../map.js'
import { dark } from '../theme.js'

const props = defineProps({
  cuisines: { type: Array, required: true },
  selected: { type: String, default: null },
  title: { type: String, default: 'World map' },
})
const emit = defineEmits(['country'])

const el = ref(null)
let map = null

const TOKENS = { none: '--map-0', p1: '--map-1', p2: '--map-2', p3: '--map-3', p4: '--map-4', done: '--map-done' }
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const scale = () => Object.fromEntries(Object.entries(TOKENS).map(([k, v]) => [k, css(v)]))
const SCALE = ref(scale())

// A country can host several cuisines (e.g. Cyprus), so progress is summed per country.
const byCountry = computed(() => {
  const out = {}
  for (const c of props.cuisines) {
    for (const code of c.countries) {
      const e = (out[code] ||= { tried: 0, total: 0, cuisines: [] })
      e.tried += c.tried
      e.total += c.total
      e.cuisines.push(c)
    }
  }
  return out
})

function bucket({ tried, total }) {
  if (!total || !tried) return 'none'
  if (tried >= total) return 'done'
  return `p${Math.min(4, Math.ceil((tried / total) * 4))}`
}

// jsvectormap 1.7 registers one touch handler for two events, so on touch devices destroy() throws halfway
// through removing its listeners, before it removes the tooltip. Left uncaught, that breaks page navigation.
function destroyMap() {
  if (!map) return
  try {
    map.destroy()
  } catch {
    try { map._tooltip?.dispose() } catch { /* already gone */ }
  }
  map = null
}

function render() {
  if (map) {
    destroyMap()
    el.value.innerHTML = ''
  }
  SCALE.value = scale()
  const values = {}
  for (const [code, e] of Object.entries(byCountry.value)) values[code] = bucket(e)

  map = new jsVectorMap({
    selector: el.value,
    map: 'world',
    zoomButtons: true,
    zoomOnScroll: false,
    regionsSelectable: false,
    selectedRegions: props.selected ? [props.selected] : [],
    regionStyle: {
      initial: { fill: css('--map-empty') },
      hover: { fillOpacity: 0.75, cursor: 'pointer' },
      selected: { fill: css('--map-selected') },
    },
    series: { regions: [{ attribute: 'fill', scale: SCALE.value, values }] },
    onRegionTooltipShow(event, tooltip, code) {
      const e = byCountry.value[code]
      const name = tooltip.text()
      tooltip.text(e ? `${name} · ${e.tried}/${e.total} dishes` : `${name} · no cuisine yet`)
    },
    onRegionClick(_event, code) {
      if (byCountry.value[code]) emit('country', code)
    },
  })
}

onMounted(render)
watch(() => props.cuisines, render)
watch(dark, render)
watch(() => props.selected, code => map?.setSelectedRegions(code ? [code] : []))
onBeforeUnmount(destroyMap)

defineExpose({ byCountry, countryName: code => map?._mapData?.paths[code]?.name || code })
</script>

<template>
  <section class="card map-card">
    <h3>{{ title }}</h3>
    <div ref="el" class="map" />
    <div class="legend muted">
      <span><i :style="{ background: SCALE.none }" />not started</span>
      <span><i :style="{ background: SCALE.p2 }" />in progress</span>
      <span><i :style="{ background: SCALE.done }" />complete</span>
    </div>
    <!-- e.g. details of the tapped country -->
    <slot />
  </section>
</template>

<style scoped>
.map-card { display: flex; flex-direction: column; gap: .6rem; }
.map-card h3 { margin: 0; }
.map { height: 320px; }
@media (max-width: 600px) { .map { height: 220px; } }
.legend { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
.legend i { display: inline-block; width: .8rem; height: .8rem; border-radius: 3px; margin-right: .3rem; vertical-align: -1px; }
</style>
