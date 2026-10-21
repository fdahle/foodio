<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api.js'
import { me, resetSession } from '../session.js'

// After logging in with a temporary password (an admin reset it): choose your own before going on.
const router = useRouter()
const password = ref('')
const confirm = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  error.value = ''
  if (password.value !== confirm.value) {
    error.value = 'Passwords do not match'
    return
  }
  busy.value = true
  try {
    await api('/auth/change-password', { method: 'POST', body: { newPassword: password.value } })
    me.mustChangePassword = false
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
    <h1>Choose a new password</h1>
    <p class="muted">Hi {{ me.username }}! You logged in with a temporary password. Choose your own to continue.</p>
    <input :value="me.username" autocomplete="username" hidden readonly />
    <input v-model="password" type="password" placeholder="New password (min. 12 characters)" autocomplete="new-password" minlength="12" required />
    <input v-model="confirm" type="password" placeholder="Repeat new password" autocomplete="new-password" required />
    <p v-if="error" class="error">{{ error }}</p>
    <button class="btn primary" :disabled="busy">Save password</button>
  </form>
</template>

<style scoped>
.login { max-width: 360px; margin: 4rem auto; display: flex; flex-direction: column; gap: .75rem; }
h1 { margin: 0; font-size: 1.3rem; }
p { margin: 0; }
</style>
