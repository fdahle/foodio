import { Router } from 'express'
import bcrypt from 'bcryptjs'
import db from '../db.js'
import { requireAdmin } from '../middleware/auth.js'
import { createInvite } from '../invites.js'
import { temporaryPassword } from '../users.js'

const router = Router()
router.use(requireAdmin)

const toId = v => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null)
const adminCount = () => db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get().n

router.get('/users', (_req, res) => {
  res.json(db.prepare(`
    SELECT u.id, u.username, u.is_admin, u.created_at, u.last_seen, u.must_change_password,
      (SELECT COUNT(*) FROM user_dishes x WHERE x.user_id = u.id AND x.status = 'tried') AS tried
    FROM users u ORDER BY u.is_admin DESC, u.username COLLATE NOCASE
  `).all())
})

// Rename, or make/unmake admin (never the last admin).
router.patch('/users/:id', (req, res) => {
  const id = toId(req.params.id)
  const user = id && db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  if (!user) return res.status(404).json({ error: 'Not found' })
  if ('username' in req.body) {
    const name = String(req.body.username || '').trim()
    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(name)) return res.status(400).json({ error: 'Username: 3–30 letters, digits, dots, dashes or underscores' })
    if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE AND id != ?').get(name, id)) {
      return res.status(409).json({ error: 'That username is taken' })
    }
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(name, id)
  }
  if ('isAdmin' in req.body) {
    if (!req.body.isAdmin && user.is_admin && adminCount() === 1) return res.status(400).json({ error: 'There has to be at least one admin' })
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(req.body.isAdmin ? 1 : 0, id)
  }
  res.json({ ok: true })
})

// A temporary password, shown once to the admin to pass on. After logging in with it the user can do nothing
// but choose their own, which replaces it; all their sessions end now.
router.post('/users/:id/reset-password', (req, res) => {
  const id = toId(req.params.id)
  if (!id || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) return res.status(404).json({ error: 'Not found' })
  if (id === req.user.id) return res.status(400).json({ error: 'Change your own password in Settings' })
  const password = temporaryPassword()
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, token_version = token_version + 1 WHERE id = ?')
    .run(bcrypt.hashSync(password, 12), id)
  res.json({ password })
})

router.delete('/users/:id', (req, res) => {
  const id = toId(req.params.id)
  if (!id || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) return res.status(404).json({ error: 'Not found' })
  if (id === req.user.id) return res.status(400).json({ error: 'You can’t delete your own account here' })
  db.prepare('DELETE FROM users WHERE id = ?').run(id)
  res.json({ ok: true })
})

// Open invites, plus the ones used or expired in the last month for reference.
router.get('/invites', (_req, res) => {
  res.json(db.prepare(`
    SELECT i.id, i.note, i.created_at, i.expires_at, i.used_at, u.username AS used_by,
      (i.used_at IS NULL AND i.expires_at > datetime('now')) AS open
    FROM invites i LEFT JOIN users u ON u.id = i.used_by
    WHERE i.created_at > datetime('now', '-30 days') OR (i.used_at IS NULL AND i.expires_at > datetime('now'))
    ORDER BY i.created_at DESC
  `).all())
})

router.post('/invites', (req, res) => {
  const note = String(req.body?.note || '').trim().slice(0, 100)
  res.status(201).json(createInvite(req.user.id, note))
})

router.delete('/invites/:id', (req, res) => {
  db.prepare('DELETE FROM invites WHERE id = ? AND used_at IS NULL').run(toId(req.params.id))
  res.json({ ok: true })
})

router.get('/suggestions', (_req, res) => {
  res.json(db.prepare(`
    SELECT s.id, s.name, s.note, s.created_at, s.cuisine_id, c.name AS cuisine, c.emoji AS cuisine_emoji, u.username
    FROM suggestions s LEFT JOIN cuisines c ON c.id = s.cuisine_id LEFT JOIN users u ON u.id = s.user_id
    WHERE s.status = 'open' ORDER BY s.created_at
  `).all())
})

// Done (added) or dismissed.
router.patch('/suggestions/:id', (req, res) => {
  const status = ['done', 'dismissed'].includes(req.body?.status) ? req.body.status : null
  if (!status) return res.status(400).json({ error: 'Invalid status' })
  db.prepare('UPDATE suggestions SET status = ? WHERE id = ?').run(status, toId(req.params.id))
  res.json({ ok: true })
})

router.get('/feedback', (_req, res) => {
  res.json(db.prepare(`
    SELECT f.id, f.kind, f.note, f.created_at, f.dish_id, d.name AS dish, d.key AS dish_key, d.cuisine_id,
      c.emoji AS cuisine_emoji, u.username
    FROM feedback f LEFT JOIN dishes d ON d.id = f.dish_id LEFT JOIN cuisines c ON c.id = d.cuisine_id
      LEFT JOIN users u ON u.id = f.user_id
    WHERE f.status = 'open' ORDER BY f.created_at
  `).all())
})

// Done (fixed or answered) or dismissed.
router.patch('/feedback/:id', (req, res) => {
  const status = ['done', 'dismissed'].includes(req.body?.status) ? req.body.status : null
  if (!status) return res.status(400).json({ error: 'Invalid status' })
  db.prepare('UPDATE feedback SET status = ? WHERE id = ?').run(status, toId(req.params.id))
  res.json({ ok: true })
})

export default router
