<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api.js'
import { resetSession } from '../session.js'

// Opened from an invite link: /register?code=…
const route = useRoute()
const router = useRouter()
const code = String(route.query.code || '')
const valid = ref(null)
const username = ref('')
const password = ref('')
const confirm = ref('')
const error = ref('')
const busy = ref(false)

onMounted(async () => {
  valid.value = code ? (await api(`/auth/invite/${encodeURIComponent(code)}`).catch(() => ({ valid: false }))).valid : false
})

async function submit() {
  error.value = ''
  if (password.value !== confirm.value) {
    error.value = 'Passwords do not match'
    return
  }
  busy.value = true
  try {
    await api('/auth/register', { method: 'POST', body: { code, username: username.value, password: password.value } })
    resetSession()
    router.push({ path: '/', query: { welcome: 1 } })
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="card login" @submit.prevent="submit">
    <h1>🍽️ Foodio</h1>
    <template v-if="valid">
      <p class="muted">You’re invited! Choose a username and a password to start tracking the dishes you try.</p>
      <input v-model="username" placeholder="Username" autocomplete="username" autocapitalize="none" spellcheck="false"
        minlength="3" maxlength="30" pattern="[A-Za-z0-9_.\-]+" title="Letters, digits, dots, dashes or underscores" required />
      <input v-model="password" type="password" placeholder="Password (min. 12 characters)" autocomplete="new-password" minlength="12" required />
      <input v-model="confirm" type="password" placeholder="Repeat password" autocomplete="new-password" required />
      <p v-if="error" class="error">{{ error }}</p>
      <button class="btn primary" :disabled="busy">Create account</button>
    </template>
    <p v-else-if="valid === false" class="muted">This invite link is not valid (anymore). Ask the person who sent it for a new one.</p>
    <router-link to="/login" class="muted center">Already have an account? Log in</router-link>
  </form>
</template>

<style scoped>
.login { max-width: 360px; margin: 4rem auto; display: flex; flex-direction: column; gap: .75rem; }
h1 { margin: 0; text-align: center; }
p { margin: 0; }
.center { text-align: center; font-size: .85rem; }
</style>
