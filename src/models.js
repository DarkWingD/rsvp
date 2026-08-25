'use strict';
// Data-access layer. All SQL lives here; routes call these functions.
const { db } = require('./db');
const { adminEmail, purgeDays } = require('./config');
const { makeToken } = require('./token');

const now = () => new Date().toISOString();

function addDaysToDate(dateStr, days) {
  const [y, mo, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + days));
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

// ─── Organizers ──────────────────────────────────────────────
const _orgByEmail = db.prepare('SELECT * FROM organizers WHERE email = ?');
const _orgById = db.prepare('SELECT * FROM organizers WHERE id = ?');
const _orgInsert = db.prepare(
  'INSERT INTO organizers(email, display_name, status, created_at) VALUES(?, ?, ?, ?)'
);

function findOrganizerByEmail(email) {
  return _orgByEmail.get(String(email).toLowerCase());
}
function getOrganizer(id) {
  return _orgById.get(id);
}

// Create the organizer row if missing. Admin is always approved.
function ensureOrganizer(email, displayName = null) {
  email = String(email).toLowerCase();
  let org = findOrganizerByEmail(email);
  if (org) return org;
  const status = email === adminEmail ? 'approved' : 'pending';
  const created = now();
  const info = _orgInsert.run(email, displayName, status, created);
  if (status === 'approved') {
    db.prepare('UPDATE organizers SET approved_at = ? WHERE id = ?').run(created, info.lastInsertRowid);
  }
  return getOrganizer(info.lastInsertRowid);
}

function setOrganizerStatus(id, status) {
  const approvedAt = status === 'approved' ? now() : null;
  db.prepare('UPDATE organizers SET status = ?, approved_at = COALESCE(?, approved_at) WHERE id = ?')
    .run(status, approvedAt, id);
}

// On approval, any of their pending events go live.
function activatePendingEvents(organizerId) {
  db.prepare("UPDATE events SET status = 'live', approved_at = ? WHERE organizer_id = ? AND status = 'pending'")
    .run(now(), organizerId);
}

function listPendingOrganizers() {
  return db.prepare("SELECT * FROM organizers WHERE status = 'pending' ORDER BY created_at ASC").all();
}

function roleForEmail(email) {
  email = String(email || '').toLowerCase();
  if (!email) return 'anon';
  if (email === adminEmail) return 'admin';
  const org = findOrganizerByEmail(email);
  if (!org) return 'new';
  return org.status; // approved | pending | rejected | revoked
}

// ─── Events ──────────────────────────────────────────────────
function createEvent(data, organizer) {
  const isApproved = organizer.status === 'approved';
  const status = isApproved ? 'live' : 'pending';
  const created = now();
  const startDate = String(data.starts_at).split('T')[0];
  const purgeAfter = addDaysToDate(startDate, purgeDays);
  const accessMode = data.access_mode === 'open_link' ? 'open_link' : 'per_guest';
  const publicToken = accessMode === 'open_link' ? makeToken() : null;
  const info = db.prepare(`
    INSERT INTO events
      (organizer_id, title, description, location, starts_at, ends_at, rsvp_deadline,
       theme, has_food, ask_dietary, guests_see_each_other, notify_method,
       access_mode, ask_adults, ask_kids, public_visibility, public_token,
       status, created_at, approved_at, purge_after)
    VALUES (@organizer_id, @title, @description, @location, @starts_at, @ends_at, @rsvp_deadline,
       @theme, @has_food, @ask_dietary, @guests_see_each_other, @notify_method,
       @access_mode, @ask_adults, @ask_kids, @public_visibility, @public_token,
       @status, @created_at, @approved_at, @purge_after)
  `).run({
    organizer_id: organizer.id,
    title: data.title,
    description: data.description || null,
    location: data.location || null,
    starts_at: data.starts_at,
    ends_at: data.ends_at || null,
    rsvp_deadline: data.rsvp_deadline || null,
    theme: data.theme,
    has_food: data.has_food ? 1 : 0,
    ask_dietary: data.ask_dietary ? 1 : 0,
    guests_see_each_other: data.guests_see_each_other ? 1 : 0,
    notify_method: data.notify_method === 'email' ? 'email' : 'direct_link',
    access_mode: accessMode,
    ask_adults: data.ask_adults ? 1 : 0,
    ask_kids: data.ask_kids ? 1 : 0,
    public_visibility: ['none', 'total', 'list'].includes(data.public_visibility) ? data.public_visibility : 'none',
    public_token: publicToken,
    status,
    created_at: created,
    approved_at: isApproved ? created : null,
    purge_after: purgeAfter,
  });
  return getEvent(info.lastInsertRowid);
}

const _eventById = db.prepare('SELECT * FROM events WHERE id = ?');
function getEvent(id) { return _eventById.get(id); }

function getEventForOrganizer(id, organizerId, isAdmin = false) {
  const ev = getEvent(id);
  if (!ev) return null;
  if (!isAdmin && ev.organizer_id !== organizerId) return null;
  return ev;
}

function listEventsByOrganizer(organizerId) {
  return db.prepare('SELECT * FROM events WHERE organizer_id = ? ORDER BY starts_at DESC').all(organizerId);
}

function listAllEvents() {
  return db.prepare(`
    SELECT e.*, o.email AS organizer_email
    FROM events e JOIN organizers o ON o.id = e.organizer_id
    ORDER BY e.created_at DESC
  `).all();
}

function updateEvent(id, data) {
  const accessMode = data.access_mode === 'open_link' ? 'open_link' : 'per_guest';
  db.prepare(`
    UPDATE events SET
      title = @title, description = @description, location = @location,
      starts_at = @starts_at, ends_at = @ends_at, rsvp_deadline = @rsvp_deadline,
      theme = @theme, has_food = @has_food, ask_dietary = @ask_dietary,
      guests_see_each_other = @guests_see_each_other, notify_method = @notify_method,
      access_mode = @access_mode, ask_adults = @ask_adults, ask_kids = @ask_kids, public_visibility = @public_visibility,
      purge_after = @purge_after, updated_at = @updated_at
    WHERE id = @id
  `).run({
    id,
    title: data.title,
    description: data.description || null,
    location: data.location || null,
    starts_at: data.starts_at,
    ends_at: data.ends_at || null,
    rsvp_deadline: data.rsvp_deadline || null,
    theme: data.theme,
    has_food: data.has_food ? 1 : 0,
    ask_dietary: data.ask_dietary ? 1 : 0,
    guests_see_each_other: data.guests_see_each_other ? 1 : 0,
    notify_method: data.notify_method === 'email' ? 'email' : 'direct_link',
    access_mode: accessMode,
    ask_adults: data.ask_adults ? 1 : 0,
    ask_kids: data.ask_kids ? 1 : 0,
    public_visibility: ['none', 'total', 'list'].includes(data.public_visibility) ? data.public_visibility : 'none',
    purge_after: addDaysToDate(String(data.starts_at).split('T')[0], purgeDays),
    updated_at: now(),
  });
  // Ensure an open-link event has a shareable token.
  const ev = getEvent(id);
  if (ev.access_mode === 'open_link' && !ev.public_token) {
    db.prepare('UPDATE events SET public_token = ? WHERE id = ?').run(makeToken(), id);
  }
  return getEvent(id);
}
function getEventByPublicToken(token) {
  return db.prepare('SELECT * FROM events WHERE public_token = ?').get(token);
}

function setEventStatus(id, status) {
  db.prepare('UPDATE events SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
}
function deleteEvent(id) {
  db.prepare('DELETE FROM events WHERE id = ?').run(id);
}
function closeEventsForOrganizer(organizerId) {
  db.prepare("UPDATE events SET status = 'closed', updated_at = ? WHERE organizer_id = ? AND status IN ('pending','live')")
    .run(now(), organizerId);
}

function countActiveEventsByOrganizer(organizerId) {
  return db.prepare("SELECT COUNT(*) n FROM events WHERE organizer_id = ? AND status IN ('pending','live')")
    .get(organizerId).n;
}
function countGlobalActiveEvents() {
  return db.prepare("SELECT COUNT(*) n FROM events WHERE status IN ('pending','live')").get().n;
}
function countEventsCreatedTodayByOrganizer(organizerId) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  return db.prepare('SELECT COUNT(*) n FROM events WHERE organizer_id = ? AND created_at > ?')
    .get(organizerId, since).n;
}
function countSignupsToday() {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  return db.prepare('SELECT COUNT(*) n FROM organizers WHERE created_at > ?').get(since).n;
}

function eventStats(eventId) {
  const rows = db.prepare('SELECT rsvp, COUNT(*) c, SUM(party_size) ps, SUM(kids) ks FROM guests WHERE event_id = ? GROUP BY rsvp')
    .all(eventId);
  const stats = { yes: 0, no: 0, maybe: 0, pending: 0, headcount: 0, adults: 0, kids: 0, total: 0 };
  for (const r of rows) {
    if (stats[r.rsvp] != null) stats[r.rsvp] = r.c;
    stats.total += r.c;
    if (r.rsvp === 'yes') { stats.adults += r.ps || 0; stats.kids += r.ks || 0; stats.headcount += (r.ps || 0) + (r.ks || 0); }
  }
  return stats;
}
// A self-serve sign-up on an open-link event.
function addSignup(eventId, { label, email, rsvp, party_size, kids }) {
  const info = db.prepare(`
    INSERT INTO guests(event_id, label, email, token, rsvp, party_size, kids, responded_at, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(eventId, label, email || null, makeToken(), rsvp, party_size, kids, now(), now());
  return getGuest(info.lastInsertRowid);
}
// Attendees for the public list/total visibility (coming or maybe).
function publicAttendees(eventId) {
  return db.prepare("SELECT label, rsvp, party_size, kids FROM guests WHERE event_id = ? AND rsvp IN ('yes','maybe') ORDER BY created_at").all(eventId);
}

// ─── Guests ──────────────────────────────────────────────────
function getGuestWithEventByToken(token) {
  return db.prepare('SELECT * FROM guests WHERE token = ?').get(token);
}
function getGuest(id) { return db.prepare('SELECT * FROM guests WHERE id = ?').get(id); }
function listGuests(eventId) {
  return db.prepare('SELECT * FROM guests WHERE event_id = ? ORDER BY created_at ASC, id ASC').all(eventId);
}
function countGuests(eventId) {
  return db.prepare('SELECT COUNT(*) n FROM guests WHERE event_id = ?').get(eventId).n;
}

const _insertGuest = db.prepare(
  'INSERT INTO guests(event_id, label, email, token, created_at) VALUES(?, ?, ?, ?, ?)'
);
// guests: array of { label, email? }
function addGuests(eventId, guests) {
  const created = now();
  const insertMany = db.transaction((rows) => {
    for (const g of rows) {
      _insertGuest.run(eventId, g.label, g.email || null, makeToken(), created);
    }
  });
  insertMany(guests);
}

// Guests with an email who haven't been sent an invite yet.
function guestsToInvite(eventId) {
  return db.prepare("SELECT * FROM guests WHERE event_id = ? AND email IS NOT NULL AND invited_at IS NULL ORDER BY created_at").all(eventId);
}
// Guests with an email who haven't responded.
function guestsToRemind(eventId) {
  return db.prepare("SELECT * FROM guests WHERE event_id = ? AND email IS NOT NULL AND rsvp = 'pending' ORDER BY created_at").all(eventId);
}
function markInvited(id) { db.prepare('UPDATE guests SET invited_at = ? WHERE id = ?').run(now(), id); }
function markReminded(id) { db.prepare('UPDATE guests SET reminded_at = ? WHERE id = ?').run(now(), id); }
function markConfirmationSent(id) { db.prepare('UPDATE guests SET confirmed_notified_at = ? WHERE id = ?').run(now(), id); }

function updateGuestRsvp(id, { rsvp, party_size, dietary, notes }) {
  db.prepare(`
    UPDATE guests SET rsvp = ?, party_size = ?, dietary = ?, notes = ?, responded_at = ?
    WHERE id = ?
  `).run(rsvp, party_size, dietary || null, notes || null, now(), id);
}

function regenerateGuestToken(id) {
  const token = makeToken();
  db.prepare('UPDATE guests SET token = ? WHERE id = ?').run(token, id);
  return token;
}
function updateGuestEmail(id, email) {
  db.prepare('UPDATE guests SET email = ? WHERE id = ?').run(email || null, id);
}
function deleteGuest(id) {
  db.prepare('DELETE FROM guests WHERE id = ?').run(id);
}

function attendees(eventId) {
  return db.prepare("SELECT label, party_size FROM guests WHERE event_id = ? AND rsvp = 'yes' ORDER BY label")
    .all(eventId);
}

function dietarySummary(eventId) {
  return db.prepare(`
    SELECT label, party_size, dietary FROM guests
    WHERE event_id = ? AND rsvp = 'yes' AND dietary IS NOT NULL AND TRIM(dietary) <> ''
    ORDER BY label
  `).all(eventId);
}

module.exports = {
  addDaysToDate,
  // organizers
  findOrganizerByEmail, getOrganizer, ensureOrganizer, setOrganizerStatus,
  activatePendingEvents, listPendingOrganizers, roleForEmail,
  // events
  createEvent, getEvent, getEventForOrganizer, listEventsByOrganizer, listAllEvents,
  updateEvent, setEventStatus, deleteEvent, closeEventsForOrganizer,
  countActiveEventsByOrganizer, countGlobalActiveEvents,
  countEventsCreatedTodayByOrganizer, countSignupsToday, eventStats,
  getEventByPublicToken, addSignup, publicAttendees,
  // guests
  getGuestWithEventByToken, getGuest, listGuests, countGuests, addGuests,
  updateGuestRsvp, regenerateGuestToken, updateGuestEmail, deleteGuest, attendees, dietarySummary,
  guestsToInvite, guestsToRemind, markInvited, markReminded, markConfirmationSent,
};
