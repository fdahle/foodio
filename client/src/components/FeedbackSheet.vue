<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { api } from '../api.js'
import { FEEDBACK, DISH_FEEDBACK, GENERAL_FEEDBACK } from '../util.js'

// "Report a problem" on a dish (with dish), or the Feedback button for ideas and bugs (without).
// It shows up in the admins' Users tab.
const props = defineProps({ dish: { type: Object, default: null } })
const emit = defineEmits(['close', 'sent'])

const kinds = computed(() => (props.dish ? DISH_FEEDBACK : GENERAL_FEEDBACK))
const kind = ref('')
const note = ref('')
const error = ref('')
const busy = ref(false)
// A dish report says enough by its kind; anything else needs a few words (as checked by the API).
const noteRequired = computed(() => !props.dish || kind.value === 'other')

async function send() {
  error.value = ''
  if (!kind.value) return (error.value = 'Pick what it’s about.')
  busy.value = true
  try {
    await api('/feedback', { method: 'POST', body: { kind: kind.value, note: note.value, dish_id: props.dish?.id } })
    emit('sent')
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

// Capturing, so Escape closes only this form and not the dish sheet underneath.
const onKey = e => {
  if (e.key !== 'Escape') return
  e.stopImmediatePropagation()
  emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <form class="sheet card stack" role="dialog" aria-modal="true" :aria-label="dish ? 'Report a problem' : 'Feedback'" @submit.prevent="send">
      <button type="button" class="close link" aria-label="Close" @click="emit('close')">✕</button>
      <template v-if="dish">
        <h2>Report a problem with {{ dish.name }}</h2>
        <p class="muted">Something wrong with this dish? Tell us and it gets fixed for everyone.</p>
      </template>
      <template v-else>
        <h2>Feedback</h2>
        <p class="muted">An idea, something that doesn’t work, or anything else: it all helps.</p>
      </template>
      <div class="kinds" role="radiogroup" aria-label="What is it about?">
        <button v-for="k in kinds" :key="k" type="button" class="chip" :class="{ active: kind === k }"
          role="radio" :aria-checked="kind === k" @click="kind = k">{{ FEEDBACK[k] }}</button>
      </div>
      <textarea v-model="note" rows="3" maxlength="1000" :required="noteRequired"
        :placeholder="noteRequired ? 'What’s on your mind?' : 'Anything to add? (optional, e.g. what’s right)'" />
      <p v-if="error" class="error">{{ error }}</p>
      <div class="row">
        <button class="btn primary" :disabled="busy">Send</button>
        <button type="button" class="btn" @click="emit('close')">Cancel</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; z-index: 50; background: var(--overlay);
  display: flex; align-items: center; justify-content: center; padding: 1rem;
}
.sheet { position: relative; width: 100%; max-width: 480px; border-radius: 1.1rem; padding: 1rem; }
h2 { margin: 0; padding-right: 2.4rem; font-size: 1.15rem; }
p { margin: 0; }
.kinds { display: flex; flex-wrap: wrap; gap: .4rem; }
.close {
  position: absolute; top: .6rem; right: .6rem;
  width: 2rem; height: 2rem; border-radius: 50%; background: var(--close-bg); color: var(--text); font-size: 1rem;
}
</style>
