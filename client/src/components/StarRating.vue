<script setup>
const props = defineProps({
  modelValue: { type: Number, default: null },
  readonly: Boolean,
})
const emit = defineEmits(['update:modelValue'])

// Clicking the current rating again clears it.
const pick = n => emit('update:modelValue', props.modelValue === n ? null : n)
</script>

<template>
  <span class="stars" :class="{ readonly }">
    <template v-if="readonly">
      <span v-for="n in 5" :key="n" :class="{ on: n <= (modelValue || 0) }">★</span>
    </template>
    <template v-else>
      <button v-for="n in 5" :key="n" type="button" :class="{ on: n <= (modelValue || 0) }"
        :aria-label="`${n} star${n > 1 ? 's' : ''}`" @click="pick(n)">★</button>
    </template>
  </span>
</template>

<style scoped>
.stars { display: inline-flex; gap: .1rem; color: var(--star-off); }
.stars button { background: none; border: 0; padding: 0 .1rem; font-size: 1.6rem; color: inherit; line-height: 1; }
.stars.readonly { font-size: .85rem; }
.stars .on { color: var(--amber); }
</style>
