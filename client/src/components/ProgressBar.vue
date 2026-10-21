<script setup>
import { pct } from '../util.js'

defineProps({
  tried: { type: Number, default: 0 },
  wishlist: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
})
</script>

<template>
  <div class="bar" role="progressbar" :aria-valuenow="pct(tried, total)" aria-valuemin="0" aria-valuemax="100">
    <div class="tried" :style="{ width: `${pct(tried, total)}%` }" />
    <div class="wish" :style="{ width: `${pct(wishlist, total)}%` }" />
  </div>
</template>
