<script setup>
import { computed } from 'vue'
import { pct } from '../util.js'

const props = defineProps({ stats: { type: Object, required: true }, compact: Boolean })

const levelPct = computed(() => pct(props.stats.points - props.stats.levelFloor, props.stats.levelCeil - props.stats.levelFloor))
</script>

<template>
  <div class="card level">
    <div class="row">
      <div class="badge">{{ stats.level }}</div>
      <div class="grow">
        <div class="row between">
          <strong>Level {{ stats.level }} · {{ stats.title }}</strong>
          <span class="muted">{{ stats.points }} / {{ stats.levelCeil }} XP</span>
        </div>
        <div class="bar xp"><div class="tried" :style="{ width: `${levelPct}%` }" /></div>
      </div>
    </div>
    <div v-if="!compact" class="tiles">
      <div class="tile"><b>{{ stats.tried }}</b><span class="muted">dishes tried</span></div>
      <div class="tile"><b>{{ stats.pct }}%</b><span class="muted">of {{ stats.total }}</span></div>
      <div class="tile"><b>{{ stats.cuisinesStarted }}</b><span class="muted">of {{ stats.cuisinesTotal }} cuisines</span></div>
      <div class="tile"><b>{{ stats.cuisinesCompleted }}</b><span class="muted">cuisines completed</span></div>
      <div class="tile"><b>{{ stats.regionsCompleted }}</b><span class="muted">regions completed</span></div>
      <div class="tile"><b>{{ stats.areas }}</b><span class="muted">world areas</span></div>
    </div>
    <p v-else class="muted summary">
      {{ stats.tried }} of {{ stats.total }} dishes ({{ stats.pct }}%) · {{ stats.cuisinesStarted }} of {{ stats.cuisinesTotal }} cuisines started
    </p>
    <slot />
  </div>
</template>

<style scoped>
.level { display: flex; flex-direction: column; gap: .8rem; }
.between { justify-content: space-between; }
.badge {
  width: 2.6rem; height: 2.6rem; border-radius: 50%; flex: none;
  display: grid; place-items: center; font-weight: 800; font-size: 1.1rem;
  background: var(--green); color: var(--on-green);
}
.xp { margin-top: .35rem; height: .6rem; }
.summary { margin: 0; }
</style>
