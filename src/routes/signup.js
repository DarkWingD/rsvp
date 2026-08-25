'use strict';
// Public open sign-up page — a single shared link (/e/:token). No login.
const express = require('express');
const router = express.Router();
const m = require('../models');
const config = require('../config');
const { parseSignup } = require('../validate');
const { isPastDate, isPastLocal } = require('../time');

function loadEvent(req, res, next) {
  const event = m.getEventByPublicToken(req.params.token);
  if (!event || event.access_mode !== 'open_link') {
    return res.status(404).render('guest/notfound', { title: 'Not found' });
  }
  req.event = event;
  next();
}

function readonlyReason(ev) {
  if (ev.status === 'cancelled') return 'cancelled';
  if (ev.status !== 'live') return 'unavailable';
  if (ev.rsvp_deadline && isPastDate(ev.rsvp_deadline)) return 'closed';
  if (isPastLocal(ev.ends_at || ev.starts_at)) return 'past';
  return null;
}

function render(req, res, extra) {
  const ev = req.event;
  const visible = ev.public_visibility;
  const stats = (visible === 'total' || visible === 'list') ? m.eventStats(ev.id) : null;
  const list = visible === 'list' ? m.publicAttendees(ev.id) : [];
  res.render('event/signup', Object.assign({
    title: ev.title, theme: ev.theme, event: ev,
    readonly: readonlyReason(ev), stats, list, done: false, error: null, values: {},
  }, extra));
}

router.get('/:token', loadEvent, (req, res) => render(req, res, { done: req.query.done === '1' }));

router.post('/:token', loadEvent, (req, res) => {
  const reason = readonlyReason(req.event);
  if (reason) return res.status(409).render('event/signup', {
    title: req.event.title, theme: req.event.theme, event: req.event,
    readonly: reason, stats: null, list: [], done: false, values: {},
    error: 'This event is no longer accepting responses.',
  });
  if (m.countGuests(req.event.id) >= config.caps.guestsPerEvent) {
    return render(req, res, { error: 'This event is full.', values: req.body });
  }
  const { errors, data } = parseSignup(req.body, req.event);
  if (errors.length) return render(req, res, { error: errors.join(' '), values: req.body });
  m.addSignup(req.event.id, data);
  res.redirect(`/e/${req.params.token}?done=1`);
});

module.exports = router;
