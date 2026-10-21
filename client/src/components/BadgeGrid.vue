<script setup>
import { ref, computed } from 'vue'
import { loadPref, savePref } from '../util.js'

const props = defineProps({ badges: { type: Array, required: true }, earnedOnly: Boolean })

const GROUPS = ['Milestones', 'Exploring', 'Food types', 'Ingredients', 'Habits', 'Secrets']

// Only Milestones starts open; the full list is long on a phone. The public page shows only earned badges, all open.
const collapsed = ref(new Set(props.earnedOnly ? [] : loadPref('badgesCollapsed', GROUPS.slice(1))))
function toggle(name) {
  const s = new Set(collapsed.value)
  s.has(name) ? s.delete(name) : s.add(name)
  collapsed.value = s
  if (!props.earnedOnly) savePref('badgesCollapsed', [...s])
}

// Locked secrets would all look the same, so they're folded into one card per section.
const sections = computed(() => GROUPS.map(name => {
  const all = props.badges.filter(b => (b.group || 'Milestones') === name)
  const list = all.filter(b => (props.earnedOnly ? b.earned : !(b.secret && !b.earned)))
  return {
    name,
    badges: [...list].sort((a, b) => b.earned - a.earned || b.progress / b.target - a.progress / a.target),
    hiddenSecrets: props.earnedOnly ? 0 : all.filter(b => b.secret && !b.earned).length,
    earned: all.filter(b => b.earned).length,
    count: all.length,
  }
}).filter(s => s.badges.length || s.hiddenSecrets))
</script>

<template>
  <template v-if="sections.length">
    <section v-for="s in sections" :key="s.name" class="section">
      <button class="head" :aria-expanded="!collapsed.has(s.name)" @click="toggle(s.name)">
        <span class="caret">{{ collapsed.has(s.name) ? '▸' : '▾' }}</span>
        <b class="grow">{{ s.name }}</b>
        <span class="muted">{{ s.earned }} / {{ s.count }}</span>
      </button>
      <div v-if="!collapsed.has(s.name)" class="badges">
        <div v-for="b in s.badges" :key="b.id" class="b" :class="{ locked: !b.earned }" :title="b.desc">
          <span class="emoji">{{ b.emoji }}</span>
          <strong>{{ b.name }}</strong>
          <span v-if="b.tiers > 1" class="pips" :aria-label="`Level ${b.tier} of ${b.tiers}`">
            <span v-for="i in b.tiers" :key="i" :class="{ on: i <= b.tier }" />
          </span>
          <span class="muted">{{ b.tier === b.tiers ? '✓ ' : b.tier ? 'Next: ' : '' }}{{ b.desc }}</span>
          <template v-if="b.tier < b.tiers && !b.secret">
            <div class="bar"><div class="tried" :style="{ width: `${(b.progress / b.target) * 100}%` }" /></div>
            <span class="muted">{{ b.progress }} / {{ b.target }}</span>
          </template>
        </div>
        <div v-if="s.hiddenSecrets" class="b locked">
          <span class="emoji">❓</span>
          <strong>{{ s.hiddenSecrets }} secret{{ s.hiddenSecrets === 1 ? '' : 's' }} left</strong>
          <span class="muted">Keep eating to find out</span>
        </div>
      </div>
    </section>
  </template>
  <p v-else class="empty">No badges yet.</p>
</template>

<style scoped>
/* Sits inside a card: sections are divided rows rather than boxes. */
.section + .section { border-top: 1px solid var(--border); }
.head {
  width: 100%; display: flex; gap: .5rem; align-items: center; text-align: left;
  background: none; border: 0; padding: .7rem .1rem; color: var(--text);
}
.caret { width: 1rem; color: var(--muted); }
.badges { padding: .1rem 0 .8rem; display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: .6rem; }
.b {
  display: flex; flex-direction: column; align-items: center; gap: .25rem; text-align: center;
  background: var(--card); border: 1px solid var(--border); border-radius: .9rem; padding: .8rem .6rem;
}
.b .emoji { font-size: 2rem; }
.b .muted { font-size: .75rem; }
.b .bar { width: 100%; height: .35rem; }
.pips { display: flex; gap: 3px; }
.pips span { width: .45rem; height: .45rem; border-radius: 50%; background: var(--border); }
.pips .on { background: var(--amber); }
.locked .emoji { filter: grayscale(1); opacity: .45; }
.locked strong { opacity: .7; }
</style>
