import db from './db.js'

// Catch-up mode: for an hour, dishes a user ticks get no date ("tried before Foodio"), so filling in everything
// they ate before joining doesn't earn the date-based badges (feast days, streaks, holidays…).
const HOUR = 3600000

export function catchUpUntil(uid) {
  const row = db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'catchUpUntil'").get(uid)
  return row && Number(row.value) > Date.now() ? Number(row.value) : null
}

export function setCatchUp(uid, on) {
  if (on) {
    db.prepare(`
      INSERT INTO user_settings (user_id, key, value) VALUES (?, 'catchUpUntil', ?)
      ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
    `).run(uid, String(Date.now() + HOUR))
  } else {
    db.prepare("DELETE FROM user_settings WHERE user_id = ? AND key = 'catchUpUntil'").run(uid)
  }
  return catchUpUntil(uid)
}
