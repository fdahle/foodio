<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { api } from '../api.js'
import { me } from '../session.js'

// Asks for a dish to be added; it shows up in the admins' Users tab and is added to the seed by hand.
const props = defineProps({ cuisine: { type: Object, required: true } })
const emit = defineEmits(['close', 'sent'])

const name = ref('')
const note = ref('')
const error = ref('')
const busy = ref(false)

async function send() {
  error.value = ''
  busy.value = true
  try {
    await api('/suggestions', { method: 'POST', body: { cuisine_id: props.cuisine.id, name: name.value, note: note.value } })
    emit('sent', name.value.trim())
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

const onKey = e => e.key === 'Escape' && emit('close')
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <form class="sheet card stack" role="dialog" aria-modal="true" :aria-label="me.isAdmin ? 'Add a dish' : 'Suggest a dish'" @submit.prevent="send">
      <button type="button" class="close link" aria-label="Close" @click="emit('close')">✕</button>
      <template v-if="me.isAdmin">
        <h2>Add a dish to {{ cuisine.name }}</h2>
        <p class="muted">It goes on the to-add list in the Users tab, to be added to the catalogue with all its details.</p>
      </template>
      <template v-else>
        <h2>Suggest a dish for {{ cuisine.name }}</h2>
        <p class="muted">Missing a dish? Suggest it and it can be added for everyone.</p>
      </template>
      <input v-model="name" placeholder="Dish name" maxlength="100" required />
      <textarea v-model="note" rows="2" maxlength="300" placeholder="Anything to know? (optional, e.g. what it is or a link)" />
      <p v-if="error" class="error">{{ error }}</p>
      <div class="row">
        <button class="btn primary" :disabled="busy">{{ me.isAdmin ? 'Put on the list' : 'Send suggestion' }}</button>
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
.close {
  position: absolute; top: .6rem; right: .6rem;
  width: 2rem; height: 2rem; border-radius: 50%; background: var(--close-bg); color: var(--text); font-size: 1rem;
}
</style>
