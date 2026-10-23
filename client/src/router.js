import { createRouter, createWebHistory } from 'vue-router'
import LoginView from './views/LoginView.vue'
import HomeView from './views/HomeView.vue'
import CuisinesView from './views/CuisinesView.vue'
import CuisineView from './views/CuisineView.vue'
import ProfileView from './views/ProfileView.vue'
import SettingsView from './views/SettingsView.vue'
import PublicView from './views/PublicView.vue'
import WishlistView from './views/WishlistView.vue'
import RegisterView from './views/RegisterView.vue'
import NewPasswordView from './views/NewPasswordView.vue'
import AdminView from './views/AdminView.vue'
import StatsView from './views/StatsView.vue'
import { me, loadMe, clearMe, session } from './session.js'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginView, meta: { public: true } },
    { path: '/p/:token', component: PublicView, props: true, meta: { public: true } },
    { path: '/register', component: RegisterView, meta: { public: true } },
    { path: '/new-password', component: NewPasswordView, meta: { bare: true } },
    { path: '/users', component: AdminView, meta: { admin: true } },
    { path: '/', component: HomeView },
    { path: '/cuisines', component: CuisinesView },
    { path: '/cuisine/:id', component: CuisineView, props: true },
    { path: '/wishlist', component: WishlistView },
    { path: '/profile', component: ProfileView },
    { path: '/stats', component: StatsView },
    { path: '/me', redirect: '/profile' },
    { path: '/settings', component: SettingsView },
  ],
  scrollBehavior(to, from, saved) {
    if (saved) return tallEnough(saved.top).then(() => saved)
    if (to.hash) return { el: to.hash, top: 70 }
    return to.path === from.path ? false : { top: 0 }
  },
})

// Going back, a page that loads its content first is still too short to scroll to where you were:
// wait (up to a second) until it has grown.
function tallEnough(top) {
  const start = performance.now()
  return new Promise(resolve => {
    const check = () => {
      if (document.documentElement.scrollHeight - window.innerHeight >= top || performance.now() - start > 1000) resolve()
      else requestAnimationFrame(check)
    }
    check()
  })
}

// Checked once per page load; after that an expired session shows up as a 401 from any API call.
// Only a 401 means logged out: a hiccup (server restarting, offline) shouldn't send you to the login page.
router.beforeEach(async to => {
  if (to.meta.public) return true
  if (!session.checked) {
    try {
      await loadMe()
      session.checked = true
    } catch (err) {
      return err.status === 401 ? '/login' : true
    }
  }
  if (me.mustChangePassword && to.path !== '/new-password') return '/new-password'
  if (to.meta.admin && !me.isAdmin) return '/'
  return true
})

window.addEventListener('foodio:unauthorized', () => {
  session.checked = false
  clearMe()
  router.push('/login')
})

window.addEventListener('foodio:must-change-password', () => {
  me.mustChangePassword = true
  router.push('/new-password')
})

export default router
