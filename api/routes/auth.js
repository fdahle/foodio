import { Router } from 'express'
import bcrypt from 'bcryptjs'
import db from '../db.js'
import { requireLogin, setAuthCookie, clearAuthCookie } from '../middleware/auth.js'
import { findInvite } from '../invites.js'
import { applyDiet } from '../diet.js'
import { catchUpUntil } from '../catchup.js'

const router = Router()

const USERNAME = /^[a-zA-Z0-9_.-]{3,30}$/
const usernameError = name => (USERNAME.test(name) ? '' : 'Username: 3–30 letters, digits, dots, dashes or underscores')
// bcrypt ignores everything after 72 bytes, so longer passwords are refused rather than silently cut.
const passwordError = pw => (typeof pw !== 'string' || pw.length < 12 ? 'Password must be at least 12 characters'
  : Buffer.byteLength(pw) > 72 ? 'Password can be at most 72 characters' : '')
const byName = name => db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(name)

// Compared against when the username doesn't exist, so a wrong name takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12)

function createUser(username, password, { isAdmin = false } = {}) {
  const hash = bcrypt.hashSync(password, 12)
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, ?, datetime('now'))
  `).run(username, hash, isAdmin ? 1 : 0)
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(lastInsertRowid))
}

router.get('/config', (_req, res) => {
  const user = db.prepare('SELECT id FROM users LIMIT 1').get()
  res.json({ setupRequired: !user })
})

// First start: the first account is the admin.
router.post('/setup', (req, res) => {
  if (db.prepare('SELECT id FROM users LIMIT 1').get()) return res.status(409).json({ error: 'Already set up' })
  const username = String(req.body.username || '').trim()
  const err = usernameError(username) || passwordError(req.body.password)
  if (err) return res.status(400).json({ error: err })
  const user = createUser(username, req.body.password, { isAdmin: true })
  setAuthCookie(res, user)
  res.json({ ok: true })
})

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({ error: 'Username and password required' })
    }
    const user = byName(username.trim())
    const valid = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH)
    if (!user || !valid) return res.status(401).json({ error: 'Wrong username or password' })
    setAuthCookie(res, user)
    res.json({ ok: true, mustChangePassword: !!user.must_change_password })
  } catch (err) { next(err) }
})

// Lets the register page say straight away whether a link still works.
router.get('/invite/:code', (req, res) => {
  res.json({ valid: !!findInvite(req.params.code) })
})

router.post('/register', (req, res) => {
  const invite = findInvite(req.body.code)
  if (!invite) return res.status(400).json({ error: 'This invite link is not valid (anymore). Ask for a new one.' })
  const username = String(req.body.username || '').trim()
  const err = usernameError(username) || passwordError(req.body.password)
  if (err) return res.status(400).json({ error: err })
  if (byName(username)) return res.status(409).json({ error: 'That username is taken' })

  db.exec('BEGIN')
  let user
  try {
    user = createUser(username, req.body.password)
    // Only one registration per invite, even if two arrive at the same time.
    const used = db.prepare("UPDATE invites SET used_by = ?, used_at = datetime('now') WHERE id = ? AND used_at IS NULL").run(user.id, invite.id)
    if (!used.changes) throw new Error('invite used')
    db.exec('COMMIT')
  } catch {
    db.exec('ROLLBACK')
    return res.status(400).json({ error: 'This invite link is not valid (anymore). Ask for a new one.' })
  }
  applyDiet(user.id)
  setAuthCookie(res, user)
  res.json({ ok: true })
})

router.post('/logout', (_req, res) => {
  clearAuthCookie(res)
  res.json({ ok: true })
})

router.get('/me', requireLogin, (req, res) => {
  const { id, username, isAdmin, mustChangePassword } = req.user
  const welcomed = !!db.prepare("SELECT 1 FROM user_settings WHERE user_id = ? AND key = 'welcomed'").get(id)
  res.json({ loggedIn: true, id, username, isAdmin, mustChangePassword, welcomed, catchUpUntil: catchUpUntil(id) })
})

// The welcome is shown once per account, on whichever device they log in first.
router.post('/welcomed', requireLogin, (req, res) => {
  db.prepare("INSERT OR IGNORE INTO user_settings (user_id, key, value) VALUES (?, 'welcomed', '1')").run(req.user.id)
  res.json({ ok: true })
})

// Ends every other session; this device stays logged in. After a reset (temporary password) the current
// password isn't asked again, since it was just typed to log in.
router.post('/change-password', requireLogin, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body
    const err = passwordError(newPassword)
    if (err) return res.status(400).json({ error: err })
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
    if (!user.must_change_password) {
      if (typeof currentPassword !== 'string' || !(await bcrypt.compare(currentPassword, user.password_hash))) {
        return res.status(401).json({ error: 'Current password is incorrect' })
      }
    }
    if (await bcrypt.compare(newPassword, user.password_hash)) return res.status(400).json({ error: 'Choose a password different from the current one' })
    const hash = await bcrypt.hash(newPassword, 12)
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, token_version = token_version + 1 WHERE id = ?')
      .run(hash, user.id)
    setAuthCookie(res, db.prepare('SELECT * FROM users WHERE id = ?').get(user.id))
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// Deletes your own account and everything in it. The last admin can't, so the app always has one.
router.delete('/account', requireLogin, async (req, res, next) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
    if (typeof req.body?.password !== 'string' || !(await bcrypt.compare(req.body.password, user.password_hash))) {
      return res.status(401).json({ error: 'Password is incorrect' })
    }
    if (user.is_admin && db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get().n === 1) {
      return res.status(400).json({ error: 'You are the only admin, so this account can’t be deleted' })
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id)
    clearAuthCookie(res)
    res.json({ ok: true })
  } catch (err) { next(err) }
})

export default router
