<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { toast, runToastAction } from './toast.js'
import { me } from './session.js'
import CatchUpBar from './components/CatchUpBar.vue'
import NavIcon from './components/NavIcon.vue'

const route = useRoute()
// A single cuisine (/cuisine/:id) belongs to the Cuisines section.
const section = computed(() => route.path.startsWith('/cuisine') ? '/cuisines' : route.path)
const withNav = computed(() => !route.meta.public && !route.meta.bare)

// On a computer all of these are text links in the top bar. On a phone the main ones are a tab bar at the
// bottom (icon over label), and settings and users are icon buttons in the top bar's corner.
const TABS = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/cuisines', label: 'Cuisines', icon: 'cuisines' },
  { to: '/wishlist', label: 'Wishlist', icon: 'wishlist' },
  { to: '/stats', label: 'Stats', icon: 'stats' },
  { to: '/profile', label: 'Profile', icon: 'profile' },
]
const EXTRA = computed(() => [
  { to: '/settings', label: 'Settings', icon: 'settings' },
  ...(me.isAdmin ? [{ to: '/users', label: 'Users', icon: 'users' }] : []),
])
</script>

<template>
  <!-- Views can teleport a bar into #subbar to stick with the top bar (one sticky block, so no seam between them). -->
  <div class="sticky-top">
    <header v-if="withNav" class="topbar">
      <router-link to="/" class="brand">🍽️ Foodio</router-link>
      <nav class="top-nav">
        <router-link v-for="t in [...TABS, ...EXTRA]" :key="t.to" :to="t.to" :class="{ current: section === t.to }"
          :data-text="t.label">{{ t.label }}</router-link>
      </nav>
      <nav class="corner">
        <router-link v-for="t in EXTRA" :key="t.to" :to="t.to" :class="{ current: section === t.to }" :aria-label="t.label">
          <NavIcon :name="t.icon" />
        </router-link>
      </nav>
    </header>
    <header v-else-if="!['/login', '/register'].includes(route.path)" class="topbar">
      <span class="brand">🍽️ Foodio</span>
    </header>
    <CatchUpBar v-if="withNav" />
    <div id="subbar"></div>
  </div>
  <main :class="{ 'with-tabs': withNav }">
    <router-view />
  </main>
  <nav v-if="withNav" class="tabbar">
    <router-link v-for="t in TABS" :key="t.to" :to="t.to" :class="{ current: section === t.to }">
      <span class="pill"><NavIcon :name="t.icon" /></span>
      {{ t.label }}
    </router-link>
  </nav>
  <div v-if="toast" :key="toast.key" class="toast" :class="{ 'with-tabs': withNav }" role="status">
    <span class="grow">{{ toast.message }}</span>
    <button v-if="toast.action" class="link toast-action" @click="runToastAction">{{ toast.action.label }}</button>
  </div>
</template>

<style scoped>
.top-nav { display: flex; gap: 1rem; align-items: center; font-size: .95rem; }
.top-nav a { opacity: .85; }
.top-nav a.current { opacity: 1; font-weight: 700; }
/* An invisible bold copy of the label reserves its width, so the bar doesn't shift when a link turns bold. */
.top-nav [data-text] { display: inline-flex; flex-direction: column; }
.top-nav [data-text]::after {
  content: attr(data-text); font-weight: 700; height: 0; overflow: hidden; visibility: hidden; pointer-events: none;
}
.corner, .tabbar { display: none; }
.corner { gap: .25rem; margin: -.4rem -.5rem -.4rem 0; }
.corner a { display: grid; place-items: center; width: 2.4rem; height: 2.4rem; border-radius: 50%; opacity: .85; }
.corner a.current { opacity: 1; background: rgb(255 255 255 / .2); }
@media (max-width: 600px) {
  .top-nav { display: none; }
  .corner { display: flex; }
  /* Below the overlays (z-index 50), so dish sheets and dialogs cover it. */
  .tabbar {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 40;
    display: grid; grid-template-columns: repeat(5, 1fr);
    background: var(--card); border-top: 1px solid var(--border);
    padding-bottom: env(safe-area-inset-bottom);
  }
  /* Chrome on Android re-pins the bar a moment late while its address bar slides in or out, which shows a
     strip of background below it. The bar's background reaches further down, so that strip is the bar. */
  .tabbar::after { content: ''; position: absolute; top: 100%; left: 0; right: 0; height: 8rem; background: var(--card); }
  .tabbar a {
    display: flex; flex-direction: column; align-items: center; gap: .15rem;
    padding: .4rem 0 .45rem; font-size: .72rem; color: var(--muted);
  }
  .tabbar a.current { color: var(--green-dark); font-weight: 700; }
  .pill { padding: .2rem 1.1rem; border-radius: 99px; }
  .current .pill { background: var(--soft); }
  main.with-tabs { padding-bottom: calc(5.5rem + env(safe-area-inset-bottom)); }
  .toast.with-tabs { bottom: calc(4.8rem + env(safe-area-inset-bottom)); }
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
