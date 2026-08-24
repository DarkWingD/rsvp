'use strict';
// Organiser area — behind Cloudflare Access. Role decides what they see:
//   admin/approved → dashboard + create/manage events
//   pending        → "awaiting approval" page
//   rejected/revoked → blocked page
//   new            → "request to host" form
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../auth');
const m = require('../models');
const config = require('../config');
const { signupsPaused, emailBlocked } = require('../db');
const { parseEventForm, parseGuestNames, parseGuestOne } = require('../validate');
const { verifyTurnstile } = require('../turnstile');
const { notifyAdminNewRequest, sendGuestInvite, sendGuestReminder } = require('../mail');

router.use(requireAuth());

function canOrganise(role) {
  return role === 'admin' || role === 'approved';
}
function currentOrganizer(req) {
  if (req.organizer) return req.organizer;
  if (req.role === 'admin') {
    req.organizer = m.ensureOrganizer(req.userEmail);
    return req.organizer;
  }
  return null;
}
function eventToFormValues(ev) {
  const [date, time] = String(ev.starts_at).split('T');
  return {
    title: ev.title, description: ev.description || '', location: ev.location || '',
    date, time, end_time: ev.ends_at ? String(ev.ends_at).split('T')[1] : '',
    rsvp_deadline: ev.rsvp_deadline || '', theme: ev.theme,
    has_food: ev.has_food, ask_dietary: ev.ask_dietary,
    guests_see_each_other: ev.guests_see_each_other,
    notify_method: ev.notify_method,
  };
}
function csvCell(v) {
  v = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

// ─── Dashboard / role routing ────────────────────────────────
router.get('/', (req, res) => {
  if (canOrganise(req.role)) {
    const org = currentOrganizer(req);
    const events = m.listEventsByOrganizer(org.id).map((e) => Object.assign({}, e, { stats: m.eventStats(e.id) }));
    return res.render('organizer/dashboard', { title: 'Your events', events, role: req.role });
  }
  if (req.role === 'pending') return res.render('organizer/pending', { title: 'Awaiting approval' });
  if (req.role === 'rejected' || req.role === 'revoked') {
    return res.render('organizer/blocked', { title: 'Not available', status: req.role });
  }
  return res.render('organizer/request', {
    title: 'Request to host an event',
    paused: signupsPaused(), values: {}, error: null,
    turnstile: config.turnstile.enabled,
  });
});

// ─── Request to host (role: new) ─────────────────────────────
router.post('/request', async (req, res) => {
  if (req.role !== 'new') return res.redirect('/organiser');
  const rerender = (status, error) => res.status(status).render('organizer/request', {
    title: 'Request to host an event', paused: signupsPaused(),
    values: req.body, error, turnstile: config.turnstile.enabled,
  });

  if (signupsPaused()) return rerender(403, 'New event requests are paused right now. Please check back later.');
  if (m.countSignupsToday() >= config.caps.signupsPerDay) {
    return rerender(429, 'We are receiving a lot of requests right now. Please try again later.');
  }
  const ok = await verifyTurnstile(req.body['cf-turnstile-response'], req.ip);
  if (!ok) return rerender(400, 'Captcha check failed. Please try again.');

  const { errors, data } = parseEventForm(req.body);
  if (errors.length) return rerender(400, errors.join(' '));
  if (data.notify_method === 'email' && emailBlocked()) {
    return rerender(400, 'Email invites are paused — the free email limit has been reached this month. Choose "I\'ll share links myself" for now.');
  }

  const displayName = (req.body.display_name || '').trim().slice(0, 120) || null;
  const org = m.ensureOrganizer(req.userEmail, displayName); // created as pending
  const event = m.createEvent(data, org); // pending (organiser not yet approved)
  await notifyAdminNewRequest(org, event);
  res.render('organizer/pending', { title: 'Request received' });
});

// ─── Create event (role: admin/approved) ─────────────────────
router.get('/events/new', (req, res) => {
  if (!canOrganise(req.role)) return res.redirect('/organiser');
  res.render('organizer/event_form', { title: 'New event', mode: 'new', event: null, values: { theme: 'modern' }, error: null });
});

router.post('/events', (req, res) => {
  if (!canOrganise(req.role)) return res.redirect('/organiser');
  const org = currentOrganizer(req);
  const fail = (status, error) => res.status(status).render('organizer/event_form', {
    title: 'New event', mode: 'new', event: null, values: req.body, error,
  });

  if (m.countActiveEventsByOrganizer(org.id) >= config.caps.activeEventsPerOrg) {
    return fail(429, `You've reached the maximum of ${config.caps.activeEventsPerOrg} active events. Close one first.`);
  }
  if (m.countEventsCreatedTodayByOrganizer(org.id) >= config.caps.eventsPerDay) {
    return fail(429, 'You have created a lot of events today. Please try again tomorrow.');
  }
  if (m.countGlobalActiveEvents() >= config.caps.globalActiveEvents) {
    return fail(503, 'The system is at capacity right now. Please try again later.');
  }
  const { errors, data } = parseEventForm(req.body);
  if (errors.length) return fail(400, errors.join(' '));
  if (data.notify_method === 'email' && emailBlocked()) {
    return fail(400, 'Email invites are paused — the free email limit has been reached this month. Choose "I\'ll share links myself", or try again next month.');
  }

  const event = m.createEvent(data, org);
  res.redirect(`/organiser/events/${event.id}`);
});

// ─── Manage a single event ───────────────────────────────────
function loadOwnedEvent(req, res, next) {
  if (!canOrganise(req.role)) return res.redirect('/organiser');
  const org = currentOrganizer(req);
  const ev = m.getEventForOrganizer(parseInt(req.params.id, 10), org ? org.id : -1, req.role === 'admin');
  if (!ev) return res.status(404).render('error', { title: 'Not found', message: 'Event not found.' });
  req.event = ev;
  next();
}

router.get('/events/:id', loadOwnedEvent, (req, res) => {
  const all = m.listGuests(req.event.id);
  const filter = req.query.filter || 'all';
  let guests = all;
  if (filter === 'noreply') guests = all.filter((g) => g.rsvp === 'pending');
  else if (['yes', 'no', 'maybe'].includes(filter)) guests = all.filter((g) => g.rsvp === filter);
  res.render('organizer/manage', {
    title: req.event.title, event: req.event, guests, allCount: all.length,
    filter, stats: m.eventStats(req.event.id), dietary: m.dietarySummary(req.event.id),
    caps: config.caps,
    notInvitedCount: all.filter((g) => g.email && !g.invited_at).length,
    nonResponderCount: all.filter((g) => g.email && g.rsvp === 'pending').length,
    mailEnabled: config.mail.enabled,
    emailCapped: emailBlocked(),
    msg: req.query.msg || null,
    error: req.query.err || null,
  });
});

const back = (req, extra) => `/organiser/events/${req.event.id}${extra || ''}`;

router.post('/events/:id/guests', loadOwnedEvent, (req, res) => {
  const room = config.caps.guestsPerEvent - m.countGuests(req.event.id);
  if (room <= 0) return res.redirect(back(req, '?err=' + encodeURIComponent('Guest limit reached for this event.')));

  if (req.event.notify_method === 'email') {
    const { errors, data } = parseGuestOne(req.body, true);
    if (errors.length) return res.redirect(back(req, '?err=' + encodeURIComponent(errors.join(' '))));
    m.addGuests(req.event.id, [{ label: data.label, email: data.email }]);
  } else {
    const names = parseGuestNames(req.body.names, config.caps.guestsPerRequest);
    const toAdd = names.slice(0, Math.max(0, room)).map((n) => ({ label: n, email: null }));
    if (toAdd.length) m.addGuests(req.event.id, toAdd);
  }
  res.redirect(back(req));
});

// Send invites to guests who have an email and haven't been invited yet.
router.post('/events/:id/invites/send', loadOwnedEvent, async (req, res) => {
  if (req.event.notify_method !== 'email') return res.redirect(back(req));
  if (emailBlocked()) return res.redirect(back(req, '?err=' + encodeURIComponent('The free email limit has been reached this month — email invites are paused.')));
  const pending = m.guestsToInvite(req.event.id);
  let sent = 0;
  let capped = false;
  for (const g of pending) {
    const r = await sendGuestInvite(req.event, g);
    if (r.ok) { m.markInvited(g.id); sent += 1; }
    if (r.limit || r.blocked) { capped = true; break; }
    await new Promise((s) => setTimeout(s, 550)); // stay under Resend's per-second rate limit
  }
  const note = capped
    ? `Sent ${sent} invite(s), then hit the free email limit — the rest are paused until next month.`
    : `Sent ${sent} invite(s).`;
  res.redirect(back(req, '?msg=' + encodeURIComponent(note)));
});

// Remind guests who have an email and haven't responded.
router.post('/events/:id/reminders/send', loadOwnedEvent, async (req, res) => {
  if (req.event.notify_method !== 'email') return res.redirect(back(req));
  if (emailBlocked()) return res.redirect(back(req, '?err=' + encodeURIComponent('The free email limit has been reached this month — reminders are paused.')));
  const pending = m.guestsToRemind(req.event.id);
  let sent = 0;
  let capped = false;
  for (const g of pending) {
    const r = await sendGuestReminder(req.event, g);
    if (r.ok) { m.markReminded(g.id); sent += 1; }
    if (r.limit || r.blocked) { capped = true; break; }
    await new Promise((s) => setTimeout(s, 550));
  }
  const note = capped
    ? `Sent ${sent} reminder(s), then hit the free email limit.`
    : `Sent ${sent} reminder(s).`;
  res.redirect(back(req, '?msg=' + encodeURIComponent(note)));
});

router.post('/events/:id/guests/:gid/regenerate', loadOwnedEvent, (req, res) => {
  const g = m.getGuest(parseInt(req.params.gid, 10));
  if (g && g.event_id === req.event.id) m.regenerateGuestToken(g.id);
  res.redirect(`/organiser/events/${req.event.id}`);
});

router.post('/events/:id/guests/:gid/delete', loadOwnedEvent, (req, res) => {
  const g = m.getGuest(parseInt(req.params.gid, 10));
  if (g && g.event_id === req.event.id) m.deleteGuest(g.id);
  res.redirect(`/organiser/events/${req.event.id}`);
});

router.get('/events/:id/edit', loadOwnedEvent, (req, res) => {
  res.render('organizer/event_form', {
    title: 'Edit event', mode: 'edit', event: req.event, values: eventToFormValues(req.event), error: null,
  });
});

router.post('/events/:id/edit', loadOwnedEvent, (req, res) => {
  const { errors, data } = parseEventForm(req.body);
  if (errors.length) {
    return res.status(400).render('organizer/event_form', {
      title: 'Edit event', mode: 'edit', event: req.event, values: req.body, error: errors.join(' '),
    });
  }
  m.updateEvent(req.event.id, data);
  res.redirect(`/organiser/events/${req.event.id}`);
});

router.post('/events/:id/cancel', loadOwnedEvent, (req, res) => {
  m.setEventStatus(req.event.id, 'cancelled');
  res.redirect(`/organiser/events/${req.event.id}`);
});

router.get('/events/:id/export.csv', loadOwnedEvent, (req, res) => {
  const rows = [['Name', 'Email', 'RSVP', 'Party size', 'Dietary', 'Notes', 'Invited at', 'Responded at']];
  for (const g of m.listGuests(req.event.id)) {
    rows.push([g.label, g.email || '', g.rsvp, g.party_size, g.dietary || '', g.notes || '', g.invited_at || '', g.responded_at || '']);
  }
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="guests.csv"');
  res.send(csv);
});

module.exports = router;
