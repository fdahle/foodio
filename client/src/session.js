import { reactive } from 'vue'
import { api } from './api.js'

// Who is logged in: { id, username, isAdmin, mustChangePassword }, or null fields when nobody is.
// welcomed: they've seen the welcome. catchUpUntil: end of their catch-up hour (ms), while ticked dishes get no date.
const LOGGED_OUT = { id: null, username: '', isAdmin: false, mustChangePassword: false, welcomed: false, catchUpUntil: null }
export const me = reactive({ ...LOGGED_OUT })

export async function loadMe() {
  Object.assign(me, await api('/auth/me'))
  return me
}

export const clearMe = () => Object.assign(me, LOGGED_OUT)

export function markWelcomed() {
  me.welcomed = true
  api('/auth/welcomed', { method: 'POST' }).catch(() => {})
}

export async function setCatchUp(on) {
  me.catchUpUntil = (await api('/catch-up', { method: 'POST', body: { on } })).catchUpUntil
}

// The router looks the session up once per page load; after logging in, registering or changing the password
// it changed, so it's looked up again on the next navigation.
export const session = { checked: false }
export const resetSession = () => { session.checked = false }
