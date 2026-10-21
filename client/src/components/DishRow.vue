<script setup>
import StarRating from './StarRating.vue'
import { formatDate } from '../util.js'

defineProps({ dish: { type: Object, required: true }, link: { type: Boolean, default: true }, desc: Boolean, mark: { type: Boolean, default: true } })
</script>

<template>
  <component :is="link ? 'router-link' : 'div'" :to="link ? `/cuisine/${dish.cuisine_id}?dish=${dish.id}` : undefined" class="list-item">
    <span class="thumb">
      <img v-if="dish.image" :src="dish.image" alt="" loading="lazy" />
      <template v-else>{{ dish.emoji || '🍽️' }}</template>
    </span>
    <span class="grow">
      <span class="name">{{ dish.name }}</span>
      <span class="muted"> · {{ dish.cuisine_emoji }} {{ dish.cuisine }}</span>
      <span v-if="dish.tried_on" class="muted"> · {{ formatDate(dish.tried_on) }}</span>
      <span v-if="desc && dish.description" class="muted desc">{{ dish.description }}</span>
      <span v-if="desc && dish.place" class="muted desc">📍 {{ dish.place }}</span>
    </span>
    <template v-if="mark">
      <StarRating v-if="dish.rating" :model-value="dish.rating" readonly />
      <span v-else-if="dish.status === 'tried'" class="mark tried">✓</span>
      <span v-else-if="dish.status === 'wishlist'" class="mark wish">☆</span>
    </template>
    <slot />
  </component>
</template>

<style scoped>
/* 4:3 like the illustrations, so nothing is cropped off the sides. */
.thumb {
  flex: none; width: 3.6rem; aspect-ratio: 4 / 3; border-radius: .5rem; overflow: hidden;
  background: var(--soft); display: grid; place-items: center; font-size: 1.4rem;
}
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.name { font-weight: 600; }
.desc { display: block; margin-top: .15rem; }
.mark { font-weight: 700; }
.mark.tried { color: var(--green); }
.mark.wish { color: var(--amber); }
</style>
