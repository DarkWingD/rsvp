'use strict';
// Admin area — behind Cloudflare Access, restricted to ADMIN_EMAIL.
const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../auth');
const m = require('../models');
const { signupsPaused, setSetting } = require('../db');
const { notifyRequesterApproved } = require('../mail');

router.use(requireAdmin());

router.get('/', (req, res) => {
  res.render('admin/dashboard', {
    title: 'Admin',
    pending: m.listPendingOrganizers(),
    paused: signupsPaused(),
  });
});

// Approve a first-time organiser → their pending events go live; email them their link.
router.post('/organisers/:id/approve', async (req, res) => {
  const org = m.getOrganizer(parseInt(req.params.id, 10));
  if (org) {
    m.setOrganizerStatus(org.id, 'approved');
    m.activatePendingEvents(org.id);
    await notifyRequesterApproved(org);
  }
  res.redirect('/admin');
});

// Reject (silent — no email).
router.post('/organisers/:id/reject', (req, res) => {
  const org = m.getOrganizer(parseInt(req.params.id, 10));
  if (org) m.setOrganizerStatus(org.id, 'rejected');
  res.redirect('/admin');
});

// Revoke an existing organiser → their live/pending events are closed.
router.post('/organisers/:id/revoke', (req, res) => {
  const org = m.getOrganizer(parseInt(req.params.id, 10));
  if (org) {
    m.setOrganizerStatus(org.id, 'revoked');
    m.closeEventsForOrganizer(org.id);
  }
  res.redirect(req.get('referer') || '/admin/events');
});

router.get('/events', (req, res) => {
  res.render('admin/events', { title: 'All events', events: m.listAllEvents() });
});

router.post('/events/:id/close', (req, res) => {
  m.setEventStatus(parseInt(req.params.id, 10), 'closed');
  res.redirect('/admin/events');
});

router.post('/events/:id/delete', (req, res) => {
  m.deleteEvent(parseInt(req.params.id, 10));
  res.redirect('/admin/events');
});

// Kill switch: pause/resume new organiser signups.
router.post('/killswitch', (req, res) => {
  setSetting('signups_paused', signupsPaused() ? '0' : '1');
  res.redirect('/admin');
});

module.exports = router;
