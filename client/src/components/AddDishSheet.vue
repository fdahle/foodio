<script setup>
import { ref, reactive, watch, onMounted, onBeforeUnmount } from 'vue'
import { api, uploadImage } from '../api.js'
import { resizeImage } from '../util.js'
import { blankDetails, detailsError, detailsBody } from '../dishDetails.js'
import DishDetailsFields from './DishDetailsFields.vue'
import AiPromptHelp from './AiPromptHelp.vue'

const props = defineProps({ cuisine: { type: Object, required: true }, initialName: { type: String, default: '' } })
const emit = defineEmits(['close', 'added'])

const form = reactive({ name: props.initialName, emoji: '', regionId: '', newRegion: '', details: blankDetails() })
const error = ref('')
const busy = ref(false)
const nameInput = ref(null)

// Once a check has failed, it updates as you pick, so the message goes away when it's fixed.
watch(() => form.details, d => { if (error.value) error.value = detailsError(d) }, { deep: true })

// Optional picture, uploaded once the dish exists.
const fileInput = ref(null)
const picture = ref(null)
const preview = ref('')
function setPicture(file) {
  if (preview.value) URL.revokeObjectURL(preview.value)
  picture.value = file
  preview.value = file ? URL.createObjectURL(file) : ''
}
const onPick = e => {
  setPicture(e.target.files?.[0] || null)
  e.target.value = ''
}

async function add() {
  error.value = detailsError(form.details)
  if (error.value) return
  busy.value = true
  try {
    let regionId = form.regionId
    if (regionId === 'new') {
      regionId = (await api('/regions', { method: 'POST', body: { cuisine_id: props.cuisine.id, name: form.newRegion } })).id
    }
    const { id } = await api('/dishes', {
      method: 'POST',
      body: { cuisine_id: props.cuisine.id, region_id: regionId, name: form.name, emoji: form.emoji, ...detailsBody(form.details) },
    })
    let note = ''
    if (picture.value) {
      try {
        await uploadImage(id, await resizeImage(picture.value))
      } catch (e) {
        note = ` (picture not saved: ${e.message})`
      }
    }
    emit('added', { id, name: form.name.trim(), note })
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

const onKey = e => e.key === 'Escape' && emit('close')
onMounted(() => {
  window.addEventListener('keydown', onKey)
  // Only with a mouse: on a phone the keyboard would pop up over the form straight away.
  if (window.matchMedia('(pointer: fine)').matches) nameInput.value?.focus()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  setPicture(null)
})
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <form class="sheet card stack" role="dialog" aria-modal="true" aria-label="Add a dish" @submit.prevent="add">
      <button type="button" class="close link" aria-label="Close" @click="emit('close')">✕</button>
      <h2>Add a dish to {{ cuisine.name }}</h2>
      <div class="row">
        <input v-model="form.emoji" placeholder="🍽️" maxlength="8" class="emoji-in" aria-label="Emoji" />
        <input ref="nameInput" v-model="form.name" placeholder="Dish name" maxlength="100" required class="grow" />
      </div>
      <label class="field">
        Region
        <select v-model="form.regionId" required>
          <option value="" disabled>Choose a region…</option>
          <option v-for="r in cuisine.regions" :key="r.id" :value="r.id">{{ r.name }}</option>
          <option value="new">+ New region…</option>
        </select>
      </label>
      <input v-if="form.regionId === 'new'" v-model="form.newRegion" placeholder="Region name" maxlength="100" required />
      <div class="field">
        <span>Picture <span class="muted">(optional)</span></span>
        <div class="row pic">
          <div class="preview">
            <img v-if="preview" :src="preview" alt="" />
            <span v-else>{{ form.emoji || '🍽️' }}</span>
          </div>
          <input ref="fileInput" type="file" accept="image/*" hidden @change="onPick" />
          <button type="button" class="btn small" @click="fileInput.click()">{{ picture ? 'Change' : 'Choose picture' }}</button>
          <button v-if="picture" type="button" class="btn small" @click="setPicture(null)">Remove</button>
          <AiPromptHelp :name="form.name" :cuisine="cuisine.name" :description="form.details.description" />
        </div>
      </div>
      <DishDetailsFields v-model="form.details" />
      <p v-if="error" class="error">{{ error }}</p>
      <div class="row">
        <button class="btn primary" :disabled="busy">Add dish</button>
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
.sheet {
  position: relative; width: 100%; max-width: 520px; max-height: calc(100dvh - 2rem); overflow-y: auto;
  border-radius: 1.1rem; padding: 1rem;
}
h2 { margin: 0; padding-right: 2.4rem; font-size: 1.15rem; }
.close {
  position: absolute; top: .6rem; right: .6rem;
  width: 2rem; height: 2rem; border-radius: 50%; background: var(--close-bg); color: var(--text); font-size: 1rem;
}
.emoji-in { width: 4rem; text-align: center; }
.field:not(label) { display: flex; flex-direction: column; gap: .3rem; font-size: .85rem; color: var(--muted); }
.pic { flex-wrap: wrap; color: var(--text); }
.preview {
  width: 4rem; aspect-ratio: 4 / 3; border-radius: .5rem; overflow: hidden; flex: none;
  background: var(--soft); display: grid; place-items: center; font-size: 1.5rem;
}
.preview img { width: 100%; height: 100%; object-fit: cover; }
</style>
