import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { fold, compact } from './search.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data')

mkdirSync(DATA_DIR, { recursive: true })

const db = new DatabaseSync(join(DATA_DIR, 'foodio.db'))

db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')
// For accent-insensitive search (see search.js).
db.function('fold', { deterministic: true }, fold)
db.function('compact', { deterministic: true }, compact)

db.exec(`
  -- AUTOINCREMENT: ids are never reused, so a deleted user's old login can't match a new account.
  CREATE TABLE IF NOT EXISTS users (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    username             TEXT,
    password_hash        TEXT NOT NULL,
    is_admin             INTEGER NOT NULL DEFAULT 0,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    token_version        INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT,
    last_seen            TEXT
  );

  CREATE TABLE IF NOT EXISTS cuisines (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    slug      TEXT NOT NULL UNIQUE,
    name      TEXT NOT NULL,
    emoji     TEXT NOT NULL DEFAULT '🍽️',
    countries TEXT NOT NULL DEFAULT '[]',
    continent TEXT NOT NULL DEFAULT 'Other',
    is_custom INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS regions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    cuisine_id INTEGER NOT NULL REFERENCES cuisines(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    sort       INTEGER NOT NULL DEFAULT 0,
    is_custom  INTEGER NOT NULL DEFAULT 0,
    UNIQUE (cuisine_id, name)
  );

  CREATE TABLE IF NOT EXISTS dishes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key        TEXT UNIQUE,
    cuisine_id INTEGER NOT NULL REFERENCES cuisines(id) ON DELETE CASCADE,
    region_id  INTEGER REFERENCES regions(id) ON DELETE SET NULL,
    slug       TEXT NOT NULL,
    name       TEXT NOT NULL,
    emoji      TEXT,
    tags       TEXT NOT NULL DEFAULT '[]',
    sort       INTEGER NOT NULL DEFAULT 0,
    is_custom  INTEGER NOT NULL DEFAULT 0,
    moved      INTEGER NOT NULL DEFAULT 0,
    UNIQUE (cuisine_id, slug)
  );

  -- Everything below is per user and goes when the user is deleted.
  CREATE TABLE IF NOT EXISTS user_dishes (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dish_id    INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
    status     TEXT CHECK (status IN ('tried', 'wishlist')),
    hidden     INTEGER NOT NULL DEFAULT 0,
    tried_on   TEXT,
    rating     INTEGER CHECK (rating BETWEEN 1 AND 5),
    note       TEXT,
    place      TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, dish_id)
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key     TEXT NOT NULL,
    value   TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
  );

  -- Dishes that don't fit the user's diet (diet.js).
  CREATE TABLE IF NOT EXISTS user_excluded (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dish_id INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, dish_id)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS user_challenges (
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month    TEXT NOT NULL,
    tag      TEXT NOT NULL,
    dish_ids TEXT NOT NULL,
    PRIMARY KEY (user_id, month)
  );

  CREATE TABLE IF NOT EXISTS shares (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS suggestions (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    cuisine_id INTEGER REFERENCES cuisines(id) ON DELETE SET NULL,
    name       TEXT NOT NULL,
    note       TEXT,
    status     TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL
  );

  -- Only a hash of the code is stored (invites.js).
  CREATE TABLE IF NOT EXISTS invites (
    id         INTEGER PRIMARY KEY,
    code_hash  TEXT NOT NULL UNIQUE,
    note       TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    used_at    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_dishes_cuisine ON dishes(cuisine_id);
`)

// Columns added after the first release; CREATE TABLE IF NOT EXISTS does not add them to existing databases.
const MIGRATIONS = {
  dishes: { description: 'TEXT', wiki: 'TEXT', same_group: 'TEXT', contains: 'TEXT', aka: 'TEXT' },
  users: {
    username: 'TEXT', is_admin: 'INTEGER NOT NULL DEFAULT 0', must_change_password: 'INTEGER NOT NULL DEFAULT 0',
    token_version: 'INTEGER NOT NULL DEFAULT 0', created_at: 'TEXT', last_seen: 'TEXT',
  },
}
for (const [table, cols] of Object.entries(MIGRATIONS)) {
  const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name))
  for (const [col, type] of Object.entries(cols)) {
    if (!have.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`)
  }
}
db.exec('CREATE INDEX IF NOT EXISTS idx_dishes_same ON dishes(same_group)')

// From one user to several: the data from before belongs to the first account, which becomes the admin
// (username "admin" until renamed). Tables that had no user column are rebuilt with one.
function migrateToUsers() {
  const cols = t => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name))
  const exists = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)
  const reusesIds = !db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get().sql.includes('AUTOINCREMENT')
  const needed = reusesIds || !cols('user_dishes').has('user_id') || cols('shares').has('id') || exists('challenges') || exists('settings')
    || cols('dishes').has('excluded') || !db.prepare('SELECT 1 FROM users WHERE is_admin = 1').get()
  if (!needed) return

  db.exec('PRAGMA foreign_keys = OFF')
  db.exec('BEGIN')
  try {
    if (reusesIds) {
      db.exec(`
        CREATE TABLE users_new (
          id                   INTEGER PRIMARY KEY AUTOINCREMENT,
          username             TEXT,
          password_hash        TEXT NOT NULL,
          is_admin             INTEGER NOT NULL DEFAULT 0,
          must_change_password INTEGER NOT NULL DEFAULT 0,
          token_version        INTEGER NOT NULL DEFAULT 0,
          created_at           TEXT,
          last_seen            TEXT
        );
        INSERT INTO users_new (id, username, password_hash, is_admin, must_change_password, token_version, created_at, last_seen)
          SELECT id, username, password_hash, is_admin, must_change_password, token_version, created_at, last_seen FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
      `)
    }
    const first = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get()
    if (first && !db.prepare('SELECT 1 FROM users WHERE is_admin = 1').get()) {
      db.prepare("UPDATE users SET is_admin = 1, username = COALESCE(username, 'admin'), created_at = COALESCE(created_at, datetime('now')) WHERE id = ?")
        .run(first.id)
    }
    // Without any account yet (e.g. after an old reset) the data waits for the first one, which gets id 1.
    const owner = first?.id ?? 1

    if (!cols('user_dishes').has('user_id')) {
      db.exec(`
        ALTER TABLE user_dishes RENAME TO user_dishes_old;
        CREATE TABLE user_dishes (
          user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          dish_id    INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
          status     TEXT CHECK (status IN ('tried', 'wishlist')),
          hidden     INTEGER NOT NULL DEFAULT 0,
          tried_on   TEXT,
          rating     INTEGER CHECK (rating BETWEEN 1 AND 5),
          note       TEXT,
          place      TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (user_id, dish_id)
        );
      `)
      db.prepare(`
        INSERT INTO user_dishes (user_id, dish_id, status, hidden, tried_on, rating, note, place, updated_at)
        SELECT ?, dish_id, status, hidden, tried_on, rating, note, place, updated_at FROM user_dishes_old
      `).run(owner)
      db.exec('DROP TABLE user_dishes_old')
    }
    if (cols('shares').has('id')) {
      const old = db.prepare('SELECT token, created_at FROM shares').get()
      db.exec(`
        DROP TABLE shares;
        CREATE TABLE shares (
          user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          token      TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `)
      if (old) db.prepare('INSERT INTO shares (user_id, token, created_at) VALUES (?, ?, ?)').run(owner, old.token, old.created_at)
    }
    if (exists('challenges')) {
      db.prepare('INSERT OR IGNORE INTO user_challenges (user_id, month, tag, dish_ids) SELECT ?, month, tag, dish_ids FROM challenges').run(owner)
      db.exec('DROP TABLE challenges')
    }
    if (exists('settings')) {
      db.prepare('INSERT OR IGNORE INTO user_settings (user_id, key, value) SELECT ?, key, value FROM settings').run(owner)
      db.exec('DROP TABLE settings')
    }
    if (cols('dishes').has('excluded')) db.exec('ALTER TABLE dishes DROP COLUMN excluded')
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}
migrateToUsers()
// Users' own photos of dishes were removed; the files lived in data/photos.
if (db.prepare('PRAGMA table_info(user_dishes)').all().some(c => c.name === 'photo')) db.exec('ALTER TABLE user_dishes DROP COLUMN photo')
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_user_dishes_dish ON user_dishes(dish_id);
`)

export default db
