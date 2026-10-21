<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { api } from '../api.js'
import { CONTAINS } from '../util.js'
import { me, setCatchUp } from '../session.js'
import { installPrompt, installed, install } from '../pwa.js'
import DishRow from '../components/DishRow.vue'

// Catch-up hour (see WelcomeModal); the bar under the top bar shows the time left.
const catchUpOn = computed(() => me.catchUpUntil > Date.now())
const catchUpError = ref('')
async function toggleCatchUp(on) {
  catchUpError.value = ''
  try {
    await setCatchUp(on)
  } catch (e) {
    catchUpError.value = e.message
  }
}

// Your own account: everything goes, after confirming with the password.
const deleting = ref(false)
const deletePw = ref('')
const deleteMsg = ref('')
async function deleteAccount() {
  deleteMsg.value = ''
  if (!confirm('Delete your account with all your progress, ratings and notes? This can’t be undone.')) return
  try {
    await api('/auth/account', { method: 'DELETE', body: { password: deletePw.value } })
    window.dispatchEvent(new Event('foodio:unauthorized'))
  } catch (e) {
    deleteMsg.value = e.message
  }
}

async function logout() {
  await api('/auth/logout', { method: 'POST' })
  window.dispatchEvent(new Event('foodio:unauthorized'))
}
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)

// Backup
const importMsg = ref('')
const importInput = ref(null)
async function onImport(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  importMsg.value = ''
  try {
    const body = JSON.parse(await file.text())
    if (!confirm('Import this backup? Matching dishes will be overwritten with the backup’s status, ratings and notes.')) return
    await api('/import', { method: 'POST', body })
    importMsg.value = '✓ Backup imported.'
    loadHidden()
  } catch (err) {
    importMsg.value = err instanceof SyntaxError ? 'That file is not a valid backup.' : err.message
  }
}

// Share link
const shareToken = ref(null)
const copied = ref(false)
const shareUrl = computed(() => (shareToken.value ? `${location.origin}/p/${shareToken.value}` : ''))
async function createShare() {
  if (shareToken.value && !confirm('Create a new link? The old link will stop working.')) return
  shareToken.value = (await api('/share', { method: 'POST' })).token
}
async function revokeShare() {
  if (!confirm('Turn off sharing? The link will stop working.')) return
  await api('/share', { method: 'DELETE' })
  shareToken.value = null
}
async function copyShare() {
  await navigator.clipboard.writeText(shareUrl.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

// Diet & allergies: dishes that don't fit are hidden everywhere (server side).
const DIETS = { all: 'Everything', pescatarian: '🐟 Pescatarian', vegetarian: '🥗 Vegetarian', vegan: '🌱 Vegan' }
const AVOID = ['gluten', 'dairy', 'egg', 'nuts', 'peanuts', 'soy', 'sesame', 'fish', 'shellfish', 'pork', 'alcohol', 'honey']
const diet = ref(null)
async function saveDiet(change) {
  diet.value = await api('/diet', { method: 'PUT', body: { diet: diet.value.diet, avoid: diet.value.avoid, ...change } })
}
const toggleAvoid = a =>
  saveDiet({ avoid: diet.value.avoid.includes(a) ? diet.value.avoid.filter(x => x !== a) : [...diet.value.avoid, a] })

// Hidden dishes
const hidden = ref([])
const loadHidden = async () => (hidden.value = await api('/hidden'))
async function unhide(d) {
  await api(`/dishes/${d.id}/user`, { method: 'PATCH', body: { hidden: false } })
  hidden.value = hidden.value.filter(h => h.id !== d.id)
}

// Password
const pw = reactive({ current: '', next: '', repeat: '' })
const pwMsg = ref('')
const pwOpen = ref(false)
async function changePassword() {
  pwMsg.value = ''
  if (pw.next !== pw.repeat) {
    pwMsg.value = 'New passwords do not match'
    return
  }
  try {
    await api('/auth/change-password', { method: 'POST', body: { currentPassword: pw.current, newPassword: pw.next } })
    Object.assign(pw, { current: '', next: '', repeat: '' })
    pwMsg.value = '✓ Password changed.'
    pwOpen.value = false
  } catch (e) {
    pwMsg.value = e.message
  }
}

onMounted(async () => {
  shareToken.value = (await api('/share')).token
  diet.value = await api('/diet')
  loadHidden()
})
</script>

<template>
  <h1>Settings</h1>

  <h2 class="group">Food</h2>
  <section v-if="diet" class="card stack">
    <h3>Diet & allergies</h3>
    <p class="muted">Dishes that don’t fit are hidden everywhere and don’t count towards your progress. Dishes you’ve already tried stay.</p>
    <div class="chips">
      <button v-for="(label, key) in DIETS" :key="key" class="chip" :class="{ active: diet.diet === key }"
        @click="saveDiet({ diet: key })">{{ label }}</button>
    </div>
    <span class="label muted">Avoid</span>
    <div class="chips">
      <button v-for="a in AVOID" :key="a" class="chip" :class="{ active: diet.avoid.includes(a) }"
        @click="toggleAvoid(a)">{{ CONTAINS[a] }}</button>
    </div>
    <p class="muted"><b>{{ diet.excluded }}</b> dish{{ diet.excluded === 1 ? '' : 'es' }} hidden by these settings.</p>
    <p class="muted small">Based on how a dish is typically made. Recipes vary, so with an allergy always check before eating.</p>
  </section>

  <section class="card stack">
    <h3>Catch-up hour</h3>
    <p class="muted">Filling in dishes you ate before? For an hour, dishes you tick get no date, so they don’t count
      for the date-based achievements (like five dishes in one day, or a dish every month).</p>
    <div class="row">
      <button v-if="catchUpOn" class="btn" @click="toggleCatchUp(false)">Stop catch-up hour</button>
      <button v-else class="btn primary" @click="toggleCatchUp(true)">Start catch-up hour</button>
    </div>
    <p v-if="catchUpError" class="error">{{ catchUpError }}</p>
  </section>

  <section class="card stack">
    <h3>Hidden dishes <span v-if="hidden.length" class="muted count">{{ hidden.length }}</span></h3>
    <p class="muted">Dishes you hid, for example because you can’t get them here. They don’t count towards your progress.</p>
    <div v-if="hidden.length" class="list scroll">
      <DishRow v-for="d in hidden" :key="d.id" :dish="d">
        <button class="btn small" @click.prevent.stop="unhide(d)">Show</button>
      </DishRow>
    </div>
    <p v-else class="muted">None yet. You can hide a dish from its detail view.</p>
  </section>

  <h2 class="group">Sharing & data</h2>
  <section class="card stack">
    <h3>Share your profile</h3>
    <p class="muted">Anyone with the link can see your map, stats and badges, read-only. Notes stay private.</p>
    <template v-if="shareToken">
      <div class="row">
        <input :value="shareUrl" readonly class="grow" @focus="e => e.target.select()" />
        <button class="btn" @click="copyShare">{{ copied ? 'Copied!' : 'Copy' }}</button>
      </div>
      <div class="row">
        <a :href="shareUrl" target="_blank" rel="noopener" class="btn small">Preview</a>
        <button class="btn small" @click="createShare">New link</button>
        <button class="btn small danger" @click="revokeShare">Turn off</button>
      </div>
    </template>
    <div v-else><button class="btn primary" @click="createShare">Create share link</button></div>
  </section>

  <section class="card stack">
    <h3>Backup</h3>
    <p class="muted">Your progress, ratings, notes and diet settings as one file<template v-if="me.isAdmin">, plus the dishes you added or edited</template>.</p>
    <div class="row">
      <a class="btn" href="/api/export" download="foodio-backup.json">Export backup</a>
      <input ref="importInput" type="file" accept="application/json,.json" hidden @change="onImport" />
      <button class="btn" @click="importInput.click()">Import backup…</button>
    </div>
    <p v-if="importMsg" :class="importMsg.startsWith('✓') ? 'ok' : 'error'">{{ importMsg }}</p>
  </section>

  <h2 class="group">App & account</h2>
  <section class="card account">
    <div v-if="!installed" class="item stack">
      <h3>Install the app</h3>
      <template v-if="installPrompt">
        <p class="muted">Add Foodio to your home screen for quick access.</p>
        <div><button class="btn primary small" @click="install">Install</button></div>
      </template>
      <p v-else-if="isIos" class="muted">In Safari, tap the Share button, then “Add to Home Screen”.</p>
      <p v-else class="muted">Open your browser menu and choose “Install app” or “Add to Home screen”.</p>
    </div>

    <div class="item stack">
      <div class="row between">
        <h3>Password</h3>
        <button v-if="!pwOpen" class="btn small" @click="pwOpen = true; pwMsg = ''">Change</button>
      </div>
      <form v-if="pwOpen" class="stack" @submit.prevent="changePassword">
        <input v-model="pw.current" type="password" placeholder="Current password" autocomplete="current-password" required />
        <input v-model="pw.next" type="password" placeholder="New password (min. 12 characters)" autocomplete="new-password" minlength="12" required />
        <input v-model="pw.repeat" type="password" placeholder="Repeat new password" autocomplete="new-password" required />
        <div class="row">
          <button class="btn primary small">Save password</button>
          <button type="button" class="btn small" @click="pwOpen = false">Cancel</button>
        </div>
      </form>
      <p v-if="pwMsg" :class="pwMsg.startsWith('✓') ? 'ok' : 'error'">{{ pwMsg }}</p>
    </div>

    <div class="item row between">
      <span class="muted">Logged in as <b>{{ me.username }}</b><template v-if="me.isAdmin"> (admin)</template>.</span>
      <button class="btn small" @click="logout">Log out</button>
    </div>

    <div class="item stack">
      <div class="row between">
        <h3>Delete account</h3>
        <button v-if="!deleting" class="btn small" @click="deleting = true">Delete…</button>
      </div>
      <form v-if="deleting" class="stack" @submit.prevent="deleteAccount">
        <p class="muted">Removes your account with all your progress, ratings, notes and settings.</p>
        <input :value="me.username" autocomplete="username" hidden readonly />
        <input v-model="deletePw" type="password" placeholder="Your password" autocomplete="current-password" required />
        <div class="row">
          <button class="btn small danger">Delete my account</button>
          <button type="button" class="btn small" @click="deleting = false">Cancel</button>
        </div>
      </form>
      <p v-if="deleteMsg" class="error">{{ deleteMsg }}</p>
    </div>
  </section>
</template>

<style scoped>
h1 { font-size: 1.4rem; margin-bottom: .4rem; }
.group { font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: 1.4rem 0 .5rem; }
section { margin-bottom: .75rem; }
h3, section p { margin: 0; }
.count { font-weight: 400; font-size: .85rem; }
.label { font-size: .85rem; }
.between { justify-content: space-between; }
.scroll { max-height: 20rem; overflow-y: auto; }
.account { padding: 0; }
.account .item { padding: .9rem 1rem; }
.account .item + .item { border-top: 1px solid var(--border); }
.ok { color: var(--green-dark); }
.small { font-size: .8rem; }
a.btn { display: inline-block; }
</style>
