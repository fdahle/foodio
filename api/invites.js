import { randomBytes, createHash } from 'crypto'
import db from './db.js'

// Invite codes are random, single-use and valid for a week. Only their hash is stored, so the database
// alone can't be used to register.
const DAYS = 7
const hash = code => createHash('sha256').update(String(code)).digest('hex')

export function createInvite(createdBy, note) {
  const code = randomBytes(16).toString('base64url')
  const r = db.prepare(`
    INSERT INTO invites (code_hash, note, created_by, created_at, expires_at)
    VALUES (?, ?, ?, datetime('now'), datetime('now', '+${DAYS} days'))
  `).run(hash(code), note || null, createdBy)
  return { id: Number(r.lastInsertRowid), code }
}

export const findInvite = code =>
  typeof code === 'string' && code.length >= 16
    // used_at, not used_by: deleting the user who registered with it must not make the code valid again.
    ? db.prepare("SELECT * FROM invites WHERE code_hash = ? AND used_at IS NULL AND expires_at > datetime('now')").get(hash(code))
    : null
