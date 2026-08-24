'use strict';
// SQLite connection + schema migrations. Single-file DB (better-sqlite3, synchronous).
const Database = require('better-sqlite3');
const { dbPath } = require('./config');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS organizers (
  id            INTEGER PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  display_name  TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected | revoked
  created_at    TEXT NOT NULL,
  approved_at   TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id                     INTEGER PRIMARY KEY,
  organizer_id           INTEGER NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  title                  TEXT NOT NULL,
  description            TEXT,
  location               TEXT,
  starts_at              TEXT NOT NULL,            -- local wall-clock "YYYY-MM-DDTHH:mm"
  ends_at                TEXT,                     -- optional
  rsvp_deadline          TEXT,                     -- optional date "YYYY-MM-DD"
  theme                  TEXT NOT NULL DEFAULT 'modern',
  has_food               INTEGER NOT NULL DEFAULT 0,
  ask_dietary            INTEGER NOT NULL DEFAULT 0,
  guests_see_each_other  INTEGER NOT NULL DEFAULT 0,
  notify_method          TEXT NOT NULL DEFAULT 'direct_link',  -- direct_link | email
  status                 TEXT NOT NULL DEFAULT 'pending',  -- pending | live | cancelled | closed
  created_at             TEXT NOT NULL,
  approved_at            TEXT,
  updated_at             TEXT,
  purge_after            TEXT NOT NULL             -- date "YYYY-MM-DD"
);

CREATE TABLE IF NOT EXISTS guests (
  id            INTEGER PRIMARY KEY,
  event_id      INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  email         TEXT,
  token         TEXT UNIQUE NOT NULL,
  rsvp          TEXT NOT NULL DEFAULT 'pending',   -- pending | yes | no | maybe
  party_size    INTEGER NOT NULL DEFAULT 1,
  dietary       TEXT,
  notes         TEXT,
  responded_at  TEXT,
  invited_at    TEXT,
  reminded_at   TEXT,
  confirmed_notified_at TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key    TEXT PRIMARY KEY,
  value  TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_org    ON events(organizer_id);
CREATE INDEX IF NOT EXISTS idx_guests_event  ON guests(event_id);
`);

// Lightweight migrations: add columns to pre-existing databases if missing.
function ensureColumn(table, name, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}
ensureColumn('events', 'notify_method', "notify_method TEXT NOT NULL DEFAULT 'direct_link'");
ensureColumn('guests', 'email', 'email TEXT');
ensureColumn('guests', 'invited_at', 'invited_at TEXT');
ensureColumn('guests', 'reminded_at', 'reminded_at TEXT');
ensureColumn('guests', 'confirmed_notified_at', 'confirmed_notified_at TEXT');

// --- small settings helpers ---
const _getSetting = db.prepare('SELECT value FROM app_settings WHERE key = ?');
const _setSetting = db.prepare(
  'INSERT INTO app_settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);
function getSetting(key, fallback = null) {
  const row = _getSetting.get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  _setSetting.run(key, String(value));
}
function signupsPaused() {
  return getSetting('signups_paused', '0') === '1';
}

// Email quota block (monthly). We can't count usage locally because the Resend account
// is shared across projects, so we react to Resend's "limit reached" error and block for
// the current month; it auto-clears when the calendar month rolls over.
function currentMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function emailBlocked() {
  return getSetting('email_blocked_month', '') === currentMonth();
}
function blockEmailThisMonth() {
  setSetting('email_blocked_month', currentMonth());
}
function clearEmailBlock() {
  setSetting('email_blocked_month', '');
}

module.exports = {
  db, getSetting, setSetting, signupsPaused,
  emailBlocked, blockEmailThisMonth, clearEmailBlock, currentMonth,
};
