import { Router } from 'express'
import db from '../db.js'
import { cuisineProgress, computeStats, computeBadges } from '../stats.js'

const router = Router()

// A share link shows one user's map, stats and earned badges. Tokens are long random strings with a unique
// index, so looking one up doesn't reveal anything about other tokens.
router.get('/profile/:token', (req, res) => {
  const token = String(req.params.token)
  const row = /^[0-9a-f]{48}$/.test(token) && db.prepare(`
    SELECT s.user_id, u.username FROM shares s JOIN users u ON u.id = s.user_id WHERE s.token = ?
  `).get(token)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const cuisines = cuisineProgress(row.user_id)
  const stats = computeStats(row.user_id, cuisines)
  res.json({ name: row.username, stats, badges: computeBadges(stats, row.user_id), cuisines })
})

export default router
