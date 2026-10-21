<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { toast, runToastAction } from './toast.js'
import { me } from './session.js'
import CatchUpBar from './components/CatchUpBar.vue'

const route = useRoute()
// A single cuisine (/cuisine/:id) belongs to the Cuisines section.
const section = computed(() => route.path.startsWith('/cuisine') ? '/cuisines' : route.path)
</script>

<template>
  <!-- Views can teleport a bar into #subbar to stick with the top bar (one sticky block, so no seam between them). -->
  <div class="sticky-top">
    <header v-if="!route.meta.public && !route.meta.bare" class="topbar">
      <router-link to="/" class="brand">🍽️ <span class="brand-name">Foodio</span></router-link>
      <nav>
        <router-link to="/" :class="{ current: section === '/' }" data-text="Home">Home</router-link>
        <router-link to="/cuisines" :class="{ current: section === '/cuisines' }" data-text="Cuisines">Cuisines</router-link>
        <router-link to="/wishlist" :class="{ current: section === '/wishlist' }" data-text="Wishlist">Wishlist</router-link>
        <router-link to="/profile" :class="{ current: section === '/profile' }" data-text="Profile">Profile</router-link>
        <router-link to="/settings" :class="{ current: section === '/settings' }" data-text="Settings">Settings</router-link>
        <router-link v-if="me.isAdmin" to="/users" :class="{ current: section === '/users' }" aria-label="Users">
          <span class="icon">👥</span><span class="label" data-text="Users">Users</span>
        </router-link>
      </nav>
    </header>
    <header v-else-if="!['/login', '/register'].includes(route.path)" class="topbar">
      <span class="brand">🍽️ Foodio</span>
    </header>
    <CatchUpBar v-if="!route.meta.public && !route.meta.bare" />
    <div id="subbar"></div>
  </div>
  <main>
    <router-view />
  </main>
  <div v-if="toast" :key="toast.key" class="toast" role="status">
    <span class="grow">{{ toast.message }}</span>
    <button v-if="toast.action" class="link toast-action" @click="runToastAction">{{ toast.action.label }}</button>
  </div>
</template>

<style scoped>
nav { display: flex; gap: 1rem; align-items: center; font-size: .95rem; }
nav a { opacity: .85; }
nav a.current { opacity: 1; font-weight: 700; }
/* An invisible bold copy of the label reserves its width, so the bar doesn't shift when a link turns bold. */
nav [data-text] { display: inline-flex; flex-direction: column; }
nav [data-text]::after {
  content: attr(data-text); font-weight: 700; height: 0; overflow: hidden; visibility: hidden; pointer-events: none;
}
nav .icon { display: none; }
@media (max-width: 480px) {
  nav { gap: .8rem; font-size: .88rem; }
  .brand-name { display: none; }
  nav .icon { display: inline; }
  nav .label { display: none; }
}
.toast {
  position: fixed; z-index: 60; left: 50%; transform: translateX(-50%);
  bottom: calc(1rem + env(safe-area-inset-bottom)); width: min(92vw, 480px);
  display: flex; gap: .8rem; align-items: center;
  background: var(--toast-bg); color: var(--toast-text); padding: .75rem 1rem; border-radius: .8rem;
  box-shadow: 0 6px 24px rgb(0 0 0 / .25); font-size: .9rem;
  animation: up .18s ease-out;
}
.toast-action { color: var(--toast-action); font-weight: 700; opacity: 1; }
@keyframes up { from { transform: translate(-50%, 1rem); opacity: 0; } }
</style>
