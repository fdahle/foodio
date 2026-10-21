<script setup>
import { watch } from 'vue'
import { TAGS, TAG_GROUPS, CONTAINS } from '../util.js'
import { DIET_CHOICES, allowedContains } from '../dishDetails.js'

// Details of a dish you add yourself (see dishDetails.js for the shape and the checks).
const details = defineModel({ type: Object, required: true })

const toggle = (field, key) => {
  const list = details.value[field]
  details.value[field] = list.includes(key) ? list.filter(x => x !== key) : [...list, key]
}

// Switching diet drops ingredients that don't fit it (e.g. dairy when switching to vegan).
watch(() => details.value.diet, diet => {
  details.value.contains = details.value.contains.filter(c => allowedContains(diet).includes(c))
})
</script>

<template>
  <div class="field">
    <span>Type</span>
    <div class="chips">
      <button v-for="t in TAG_GROUPS.type.tags" :key="t" type="button" class="chip small" :class="{ active: details.type === t }"
        @click="details.type = t">{{ TAGS[t] }}</button>
    </div>
  </div>
  <div class="field">
    <span>Diet</span>
    <div class="chips">
      <button v-for="(d, key) in DIET_CHOICES" :key="key" type="button" class="chip small" :class="{ active: details.diet === key }"
        @click="details.diet = key">{{ d.label }}</button>
    </div>
  </div>
  <template v-if="details.diet">
    <div v-if="DIET_CHOICES[details.diet].which.length" class="field">
      <span>{{ DIET_CHOICES[details.diet].ask }}</span>
      <div class="chips">
        <button v-for="c in DIET_CHOICES[details.diet].which" :key="c" type="button" class="chip small"
          :class="{ active: details.contains.includes(c) }" @click="toggle('contains', c)">{{ CONTAINS[c] }}</button>
      </div>
    </div>
    <div class="field">
      <span>Also contains <span class="muted">(optional, for allergy filters)</span></span>
      <div class="chips">
        <button v-for="c in DIET_CHOICES[details.diet].also" :key="c" type="button" class="chip small"
          :class="{ active: details.contains.includes(c) }" @click="toggle('contains', c)">{{ CONTAINS[c] }}</button>
      </div>
    </div>
  </template>
  <div class="field">
    <span>Extras <span class="muted">(optional)</span></span>
    <div class="chips">
      <button v-for="t in TAG_GROUPS.extra.tags" :key="t" type="button" class="chip small" :class="{ active: details.extras.includes(t) }"
        @click="toggle('extras', t)">{{ TAGS[t] }}</button>
    </div>
  </div>
  <label class="field">
    <span>Description <span class="muted">(optional)</span></span>
    <textarea v-model="details.description" rows="2" maxlength="500" placeholder="What is it?" />
  </label>
</template>

<style scoped>
.field:not(label) { display: flex; flex-direction: column; font-size: .85rem; color: var(--muted); }
.chips { margin-top: .3rem; }
.chip { color: var(--text); }
.chip.active { color: var(--on-green); }
.chip.small { font-size: .8rem; padding: .2rem .55rem; }
</style>
