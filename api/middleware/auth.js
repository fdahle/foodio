import jwt from 'jsonwebtoken'
import db from '../db.js'

const SECURE = process.env.NODE_ENV === 'production' ? '; Secure' : ''

// The token carries the user's token_version: bumping it (password change or reset, removal) ends every session.
export function setAuthCookie(res, user) {
  const token = jwt.sign({ sub: user.id, v: user.token_version }, process.env.SESSION_SECRET, { expiresIn: '30d' })
  res.setHeader('Set-Cookie', `foodio_token=${token}; HttpOnly; SameSite=Strict; Max-Age=2592000${SECURE}; Path=/`)
}

export function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `foodio_token=; HttpOnly; SameSite=Strict; Max-Age=0${SECURE}; Path=/`)
}

const seen = new Map()
function touch(id) {
  const now = Date.now()
  if (now - (seen.get(id) || 0) < 5 * 60 * 1000) return
  seen.set(id, now)
  db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").run(id)
}

function loadSession(req) {
  const token = req.cookies?.foodio_token
  if (!token) return null
  try {
    const { sub, v } = jwt.verify(token, process.env.SESSION_SECRET, { algorithms: ['HS256'] })
    const u = db.prepare('SELECT id, username, is_admin, token_version, must_change_password FROM users WHERE id = ?').get(sub)
    if (!u || u.token_version !== v) return null
    touch(u.id)
    return { id: u.id, username: u.username, isAdmin: !!u.is_admin, mustChangePassword: !!u.must_change_password, token_version: u.token_version }
  } catch {
    return null
  }
}

// Logged in, also while a new password is still due (for /auth/me, changing the password and logging out).
export function requireLogin(req, res, next) {
  req.user = loadSession(req)
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

// Everything else: someone who logged in with a temporary password has to choose their own first.
export function requireAuth(req, res, next) {
  requireLogin(req, res, () => {
    if (req.user.mustChangePassword) return res.status(403).json({ error: 'Please choose a new password first', code: 'must_change_password' })
    next()
  })
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => (req.user.isAdmin ? next() : res.status(403).json({ error: 'Admins only' })))
}
