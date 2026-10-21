<script setup>
import { computed } from 'vue'
import { TAGS, TAG_GROUPS } from '../util.js'

// One pick per group (type, diet, extras); tapping the picked chip clears it.
const filters = defineModel({ type: Object, required: true })
const props = defineProps({ available: { type: Array, default: null } })
const emit = defineEmits(['pick'])

const groups = computed(() => Object.entries(TAG_GROUPS)
  .map(([key, g]) => ({ key, label: g.label, tags: g.tags.filter(t => !props.available || props.available.includes(t)) }))
  .filter(g => g.tags.length))

function pick(group, tag) {
  filters.value[group] = filters.value[group] === tag ? '' : tag
  emit('pick')
}
</script>

<template>
  <div class="tag-filter">
    <div v-for="g in groups" :key="g.key" class="group">
      <span class="label muted">{{ g.label }}</span>
      <div class="chips">
        <button v-for="t in g.tags" :key="t" type="button" class="chip" :class="{ active: filters[g.key] === t }"
          @click="pick(g.key, t)">{{ TAGS[t] }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tag-filter { display: flex; flex-direction: column; gap: .5rem; }
.group { display: flex; flex-direction: column; gap: .25rem; }
.label { font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; }
</style>
