<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api.js'
import { me } from '../session.js'
import { formatDate } from '../util.js'

// Admins only (router meta.admin): friends' dish suggestions, invites and the user list.
const router = useRouter()
const users = ref([])
const invites = ref([])
const suggestions = ref([])
const error = ref('')

async function load() {
  error.value = ''
  try {
    ;[users.value, invites.value, suggestions.value] = await Promise.all([
      api('/admin/users'), api('/admin/invites'), api('/admin/suggestions'),
    ])
  } catch (e) {
    error.value = e.message
  }
}
onMounted(load)

// SQLite's datetime('now') is UTC without a zone.
const parse = s => (s ? new Date(`${s.replace(' ', 'T')}Z`) : null)
function ago(s) {
  const d = parse(s)
  if (!d) return 'never'
  const days = Math.floor((Date.now() - d) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return formatDate(s.slice(0, 10))
}
const daysLeft = s => Math.max(0, Math.ceil((parse(s) - Date.now()) / 86400000))

async function run(fn) {
  error.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = e.message
  }
}

const copied = ref('')
async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = what
    setTimeout(() => (copied.value = ''), 1500)
  } catch {
    prompt('Copy this:', text)
  }
}

// Suggestions: "Add" opens the cuisine with the add-dish form filled in; it's marked done once added.
const addSuggestion = s => router.push({ path: `/cuisine/${s.cuisine_id}`, query: { add: s.name, suggestion: s.id } })
const dismiss = s => run(async () => {
  await api(`/admin/suggestions/${s.id}`, { method: 'PATCH', body: { status: 'dismissed' } })
  suggestions.value = suggestions.value.filter(x => x.id !== s.id)
})

// Invites: the code is only shown right after creating it (the server keeps just a hash).
const note = ref('')
const created = ref(null)
const inviteLink = code => `${location.origin}/register?code=${code}`
const inviteMessage = (code, name) =>
  `${name ? `Hi ${name}! ` : ''}Join me on Foodio to keep track of the dishes you try around the world: ${inviteLink(code)}\n(The link works once and for 7 days.)`
const createInvite = () => run(async () => {
  const { code } = await api('/admin/invites', { method: 'POST', body: { note: note.value } })
  created.value = { code, note: note.value.trim() }
  note.value = ''
  invites.value = await api('/admin/invites')
})
const withdraw = i => run(async () => {
  if (!confirm('Withdraw this invite? The link stops working.')) return
  await api(`/admin/invites/${i.id}`, { method: 'DELETE' })
  invites.value = invites.value.filter(x => x.id !== i.id)
})

// Users
const renaming = ref(null)
const newName = ref('')
const startRename = u => { renaming.value = u.id; newName.value = u.username }
const saveRename = u => run(async () => {
  await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { username: newName.value } })
  renaming.value = null
  if (u.id === me.id) me.username = newName.value.trim()
  await load()
})
const tempPassword = ref(null)
const resetPassword = u => run(async () => {
  if (!confirm(`Reset the password of ${u.username}? They get logged out everywhere and need the temporary password you get now.`)) return
  const { password } = await api(`/admin/users/${u.id}/reset-password`, { method: 'POST' })
  tempPassword.value = { user: u.username, password }
  await load()
})
const toggleAdmin = u => run(async () => {
  if (!confirm(u.is_admin ? `Remove admin rights from ${u.username}?` : `Make ${u.username} an admin? Admins can add and edit dishes and manage users.`)) return
  await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { isAdmin: !u.is_admin } })
  await load()
})
const removeUser = u => run(async () => {
  if (!confirm(`Delete ${u.username} and all their progress, ratings and notes? This can’t be undone.`)) return
  await api(`/admin/users/${u.id}`, { method: 'DELETE' })
  await load()
})
</script>

<template>
  <h1>Users</h1>
  <p v-if="error" class="error">{{ error }}</p>

  <section v-if="suggestions.length" class="card block">
    <h3>Dish suggestions <span class="muted count">{{ suggestions.length }}</span></h3>
    <div class="list">
      <div v-for="s in suggestions" :key="s.id" class="list-item">
        <div class="grow">
          <b>{{ s.name }}</b>
          <span class="muted"> · {{ s.cuisine ? `${s.cuisine_emoji} ${s.cuisine}` : 'no cuisine' }}</span>
          <span class="muted small-line">from {{ s.username || 'a removed user' }}, {{ ago(s.created_at) }}<template v-if="s.note"> · “{{ s.note }}”</template></span>
        </div>
        <button v-if="s.cuisine_id" class="btn small primary" @click="addSuggestion(s)">Add</button>
        <button class="btn small" @click="dismiss(s)">Dismiss</button>
      </div>
    </div>
  </section>

  <section class="card block">
    <h3>Invite a friend</h3>
    <p class="muted">Creates a link for one person. It works once and for 7 days.</p>
    <form class="row" @submit.prevent="createInvite">
      <input v-model="note" class="grow" maxlength="100" placeholder="Who is it for? (only for you, e.g. Anna)" />
      <button class="btn primary">Create link</button>
    </form>
    <div v-if="created" class="created stack">
      <span>Invite for <b>{{ created.note || 'a friend' }}</b> — send it now, it won’t be shown again:</span>
      <input :value="inviteLink(created.code)" readonly @focus="e => e.target.select()" />
      <div class="row">
        <button class="btn small primary" @click="copy(inviteMessage(created.code, created.note), 'message')">{{ copied === 'message' ? 'Copied!' : 'Copy message' }}</button>
        <button class="btn small" @click="copy(inviteLink(created.code), 'link')">{{ copied === 'link' ? 'Copied!' : 'Copy link only' }}</button>
      </div>
    </div>
    <div v-if="invites.length" class="list">
      <div v-for="i in invites" :key="i.id" class="list-item">
        <div class="grow">
          {{ i.note || 'Invite' }}
          <span class="muted small-line">
            <template v-if="i.used_at">used by {{ i.used_by || 'a removed user' }}, {{ ago(i.used_at) }}</template>
            <template v-else-if="i.open">open, {{ daysLeft(i.expires_at) }} day{{ daysLeft(i.expires_at) === 1 ? '' : 's' }} left</template>
            <template v-else>expired</template>
          </span>
        </div>
        <button v-if="i.open" class="btn small" @click="withdraw(i)">Withdraw</button>
      </div>
    </div>
  </section>

  <section class="card block">
    <h3>Users <span class="muted count">{{ users.length }}</span></h3>
    <div v-if="tempPassword" class="created stack">
      <span>Temporary password for <b>{{ tempPassword.user }}</b> — pass it on now, it won’t be shown again. They choose their own after logging in.</span>
      <div class="row">
        <code class="grow">{{ tempPassword.password }}</code>
        <button class="btn small primary" @click="copy(tempPassword.password, 'password')">{{ copied === 'password' ? 'Copied!' : 'Copy' }}</button>
        <button class="btn small" @click="tempPassword = null">Done</button>
      </div>
    </div>
    <div class="list">
      <div v-for="u in users" :key="u.id" class="user">
        <div class="row between">
          <form v-if="renaming === u.id" class="row grow" @submit.prevent="saveRename(u)">
            <input v-model="newName" class="grow" maxlength="30" />
            <button class="btn small primary">Save</button>
            <button type="button" class="btn small" @click="renaming = null">Cancel</button>
          </form>
          <span v-else class="grow">
            <b>{{ u.username }}</b>
            <span v-if="u.is_admin" class="tag">admin</span>
            <span v-if="u.id === me.id" class="muted"> (you)</span>
          </span>
          <span class="muted">{{ u.tried }} tried</span>
        </div>
        <span class="muted small-line">
          joined {{ ago(u.created_at) }} · last active {{ ago(u.last_seen) }}<template v-if="u.must_change_password"> · waiting for new password</template>
        </span>
        <div v-if="renaming !== u.id" class="row actions">
          <button class="link" @click="startRename(u)">Rename</button>
          <template v-if="u.id !== me.id">
            <button class="link" @click="resetPassword(u)">Reset password</button>
            <button class="link" @click="toggleAdmin(u)">{{ u.is_admin ? 'Remove admin' : 'Make admin' }}</button>
            <button class="link danger-link" @click="removeUser(u)">Delete</button>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
h1 { font-size: 1.4rem; margin-bottom: .4rem; }
.block { margin-top: .75rem; display: flex; flex-direction: column; gap: .6rem; }
.block h3, .block p { margin: 0; }
.count { font-weight: 400; font-size: .85rem; }
.small-line { display: block; font-size: .8rem; margin-top: .1rem; }
.between { justify-content: space-between; }
.created { background: var(--soft); border-radius: .6rem; padding: .7rem; font-size: .9rem; }
.created code { font-size: 1.05rem; font-weight: 700; letter-spacing: .03em; white-space: nowrap; }
.user { padding: .7rem 0; border-bottom: 1px solid var(--border); }
.user:last-child { border-bottom: 0; }
.actions { gap: 1rem; margin-top: .3rem; font-size: .85rem; }
.actions .link { padding: 0; }
.danger-link { color: var(--red, #dc2626); }
</style>
