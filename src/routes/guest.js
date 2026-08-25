'use strict';
// Public guest RSVP pages — no login. The unguessable :token IS the capability.
const express = require('express');
const router = express.Router();
const m = require('../models');
const config = require('../config');
const { parseRsvpForm } = require('../validate');
const { buildIcs, isPastDate, isPastLocal } = require('../time');
const { sendGuestConfirmation } = require('../mail');

// In-memory throttle: token -> array of edit timestamps (last hour).
const editHits = new Map();
function rateLimited(token, max) {
  const now = Date.now();
  const arr = (editHits.get(token) || []).filter((t) => now - t < 3600 * 1000);
  if (arr.length >= max) return true;
  arr.push(now);
  editHits.set(token, arr);
  return false;
}
// Entries for tokens that stop editing were never removed, so the map grew for
// the life of the process. Sweep hourly.
setInterval(() => {
  const cutoff = Date.now() - 3600 * 1000;
  for (const [token, arr] of editHits) {
    if (!arr.some((t) => t > cutoff)) editHits.delete(token);
  }
}, 3600 * 1000).unref();

function loadGuest(req, res, next) {
  // Personal details behind a capability URL: keep them out of shared caches
  // and the browser's back/forward cache on shared devices.
  res.set('Cache-Control', 'no-store');
  const guest = m.getGuestWithEventByToken(req.params.token);
  if (!guest) return res.status(404).render('guest/notfound', { title: 'Not found' });
  req.guest = guest;
  req.event = m.getEvent(guest.event_id);
  next();
}

// Returns a reason string if the event can't accept responses, else null.
function readonlyReason(ev) {
  if (!ev) return 'unavailable';
  if (ev.status === 'cancelled') return 'cancelled';
  if (ev.status !== 'live') return 'unavailable';
  if (ev.rsvp_deadline && isPastDate(ev.rsvp_deadline)) return 'closed';
  if (isPastLocal(ev.ends_at || ev.starts_at)) return 'past';
  return null;
}

router.get('/:token', loadGuest, (req, res) => {
  res.render('guest/rsvp', {
    title: req.event.title,
    theme: req.event.theme,
    event: req.event,
    guest: req.guest,
    readonly: readonlyReason(req.event),
    saved: req.query.saved === '1',
    error: null,
    attendees: req.event.guests_see_each_other ? m.attendees(req.event.id) : [],
  });
});

router.post('/:token', loadGuest, (req, res) => {
  const reason = readonlyReason(req.event);
  const view = (status, extra) => res.status(status).render('guest/rsvp', Object.assign({
    title: req.event.title, theme: req.event.theme, event: req.event,
    guest: req.guest, readonly: null, saved: false, error: null, attendees: [],
  }, extra));

  if (reason) return view(409, { readonly: reason, error: 'This event is no longer accepting responses.' });

  if (rateLimited(req.params.token, config.caps.rsvpEditsPerHour)) {
    return view(429, { error: 'Too many changes just now — please try again later.' });
  }

  const { errors, data } = parseRsvpForm(req.body, req.event.ask_dietary);
  if (errors.length) {
    req.guest = Object.assign({}, req.guest, data); // reflect entered values back
    return view(400, { error: errors.join(' ') });
  }

  m.updateGuestRsvp(req.guest.id, data);

  // Email confirmation for email-mode events (once, on a Yes/Maybe).
  if (req.event.notify_method === 'email' && req.guest.email && data.rsvp !== 'no' && !req.guest.confirmed_notified_at) {
    const g = Object.assign({}, req.guest, data);
    sendGuestConfirmation(req.event, g)
      .then((r) => { if (r && r.ok) m.markConfirmationSent(req.guest.id); })
      .catch((e) => console.error('[confirm]', e.message));
  }

  res.redirect(`/r/${req.params.token}?saved=1`);
});

router.get('/:token/calendar.ics', loadGuest, (req, res) => {
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="event.ics"');
  res.send(buildIcs(req.event, `guest-${req.guest.id}`));
});

module.exports = router;
