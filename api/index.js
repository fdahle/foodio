import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') })

const SESSION_SECRET = process.env.SESSION_SECRET
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set and at least 32 characters long')
}

import express from 'express'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'

import db, { DATA_DIR } from './db.js'
import { seed } from './seed.js'
import bcrypt from 'bcryptjs'
import { applyDietAll } from './diet.js'

// Locked out as admin: start once with RESET_PASSWORD=<temporary password> (12+ characters). It becomes the
// password of the first admin, who has to choose a new one after logging in. Remove the variable afterwards.
if (process.env.RESET_PASSWORD) {
  const admin = db.prepare('SELECT id, username FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1').get()
  if (admin && process.env.RESET_PASSWORD.length >= 12) {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, token_version = token_version + 1 WHERE id = ?')
      .run(bcrypt.hashSync(process.env.RESET_PASSWORD, 12), admin.id)
    console.log(`RESET_PASSWORD set — "${admin.username}" can now log in with it. Remove the variable again.`)
  } else {
    console.log('RESET_PASSWORD ignored: no admin yet, or shorter than 12 characters.')
  }
}

seed()
applyDietAll()
syncAllTwins()

import authRoutes from './routes/auth.js'
import foodRoutes, { syncAllTwins } from './routes/food.js'
import publicRoutes from './routes/public.js'
import adminRoutes from './routes/admin.js'
import { requireAuth } from './middleware/auth.js'

const app = express()
const PORT = process.env.PORT || 3000

app.set('trust proxy', 1)

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc:    ["'self'", 'data:'],
      objectSrc:  ["'none'"],
      frameAncestors: ["'self'"],
    },
  },
}))
app.use(express.json({ limit: '5mb' }))
app.use(cookieParser())

// Only failed password attempts count: the client checks /auth/me on every page change, so limiting all of
// /api/auth logged people out (and then blocked the login) after a few minutes of browsing.
app.use(['/api/auth/login', '/api/auth/setup', '/api/auth/change-password', '/api/auth/account'],
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20, skipSuccessfulRequests: true }))
// Guessing invite codes is hopeless (128 bits), but there's no reason to allow trying many.
app.use(['/api/auth/register', '/api/auth/invite'], rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }))

const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600 })
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const applyWriteLimiter = (req, res, next) =>
  WRITE_METHODS.has(req.method) ? writeLimiter(req, res, next) : next()

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.use('/api/auth', authRoutes)
app.use('/api/public', rateLimit({ windowMs: 15 * 60 * 1000, max: 120 }), publicRoutes)
app.use('/api/admin', applyWriteLimiter, adminRoutes)
app.use('/api', applyWriteLimiter, foodRoutes)

// Dish images: data/images/<cuisine-slug>/<dish-slug>.webp, auth required.
app.use('/images', requireAuth, express.static(join(DATA_DIR, 'images'), { maxAge: '7d' }), (_req, res) => res.sendStatus(404))
// The same on white for list rows (npm --prefix api run whiten).
app.use('/images-white', requireAuth, express.static(join(DATA_DIR, 'images-white'), { maxAge: '7d' }), (_req, res) => res.sendStatus(404))
const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'dist')
app.use(express.static(DIST))
app.get('*', (_req, res) => res.sendFile(join(DIST, 'index.html')))

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(process.env.NODE_ENV === 'production' ? err.message : err)
  res.status(500).json({ error: 'Internal server error' })
})

app.listen(PORT, () => console.log(`Foodio API listening on :${PORT}`))
