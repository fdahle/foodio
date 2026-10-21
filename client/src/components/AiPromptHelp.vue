<script setup>
import { ref, computed } from 'vue'

// A "?" that explains how to make a picture in the app's style with an AI image tool, with a ready prompt.
const props = defineProps({ name: { type: String, default: '' }, cuisine: { type: String, default: '' }, description: { type: String, default: '' } })

const open = ref(false)
const copied = ref(false)
const prompt = computed(() => {
  const dish = props.name.trim() || 'the dish'
  const from = props.cuisine && !dish.includes(props.cuisine) ? ` (${props.cuisine})` : ''
  const what = props.description.trim() ? `: ${props.description.trim()}` : ''
  return `A 4:3 landscape illustration of ${dish}${from}${what}

Style: cute hand-drawn food illustration, warm colours, soft shading, clean dark-brown outlines. The dish is centred with generous empty space around it. Plain warm cream background (#FAF0E4), no borders, no frames. No text, no labels, no faces on the food, no sparkles, no steam lines, no decorations. Show the dish as it is typically served.`
})

async function copy() {
  try {
    await navigator.clipboard.writeText(prompt.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch { /* clipboard blocked: the text can still be selected */ }
}
</script>

<template>
  <button type="button" class="help" :aria-expanded="open" aria-label="How to make a picture in this style" @click="open = !open">?</button>
  <div v-if="open" class="box">
    <p>To match the other dishes, ask an AI image tool (e.g. ChatGPT or Gemini) with this prompt, save the picture and upload it here.</p>
    <textarea :value="prompt" readonly rows="6" @focus="e => e.target.select()" />
    <div><button type="button" class="btn small" @click="copy">{{ copied ? 'Copied!' : 'Copy prompt' }}</button></div>
  </div>
</template>

<style scoped>
.help {
  width: 1.6rem; height: 1.6rem; border-radius: 50%; flex: none; padding: 0;
  border: 1px solid var(--border); background: var(--card); color: var(--muted); font-weight: 700;
}
.box {
  flex-basis: 100%; display: flex; flex-direction: column; gap: .4rem;
  background: var(--soft); border-radius: .6rem; padding: .6rem; font-size: .85rem;
}
.box p { margin: 0; }
.box textarea { font-size: .8rem; }
</style>
