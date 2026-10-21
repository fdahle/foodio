<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api.js'
import { resetSession } from '../session.js'

const router = useRouter()
const setupRequired = ref(false)
const username = ref('')
const password = ref('')
const confirm = ref('')
const error = ref('')
const busy = ref(false)

onMounted(async () => {
  setupRequired.value = (await api('/auth/config')).setupRequired
})

async function submit() {
  error.value = ''
  if (setupRequired.value && password.value !== confirm.value) {
    error.value = 'Passwords do not match'
    return
  }
  busy.value = true
  try {
    await api(setupRequired.value ? '/auth/setup' : '/auth/login', {
      method: 'POST',
      body: { username: username.value, password: password.value },
    })
    resetSession()
    router.push('/')
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
    <p v-if="setupRequired" class="muted">First start: create the admin account (password min. 12 characters).</p>
    <input v-model="username" placeholder="Username" autocomplete="username" autocapitalize="none" spellcheck="false" required />
    <input v-model="password" type="password" placeholder="Password" :autocomplete="setupRequired ? 'new-password' : 'current-password'" required />
    <input v-if="setupRequired" v-model="confirm" type="password" placeholder="Repeat password" autocomplete="new-password" required />
    <p v-if="error" class="error">{{ error }}</p>
    <button class="btn primary" :disabled="busy">{{ setupRequired ? 'Create account' : 'Log in' }}</button>
    <p v-if="!setupRequired" class="muted hint">New here? You need an invite link from whoever runs this app.</p>
  </form>
</template>

<style scoped>
.login { max-width: 360px; margin: 4rem auto; display: flex; flex-direction: column; gap: .75rem; }
h1 { margin: 0; text-align: center; }
.hint { margin: 0; font-size: .8rem; text-align: center; }
</style>
