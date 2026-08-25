'use strict';
// Transactional email (admin alerts + approval notices) via Resend.
// If RESEND_API_KEY is blank, email is disabled and messages are logged instead.
const { mail, baseUrl, adminEmail } = require('./config');
const { formatDateTime, buildIcs } = require('./time');
const { emailBlocked, blockEmailThisMonth } = require('./db');

let resend = null;
if (mail.enabled) {
  const { Resend } = require('resend');
  resend = new Resend(mail.resendKey);
}

// Distinguish the monthly/plan cap from a transient per-second rate limit.
function isMonthlyLimit(err) {
  if (!err) return false;
  const code = err.statusCode || err.status || 0;
  const s = `${err.name || ''} ${err.message || ''}`.toLowerCase();
  if (/rate/.test(s)) return false; // short-term rate limit, not the monthly cap
  return code === 402 || /limit|quota|exceeded|maximum reached|reached your/.test(s);
}

// Returns { ok, id?, error?, limit?, blocked?, disabled? }.
async function send({ to, subject, html, text, attachments }) {
  if (!resend) {
    console.log(`[mail:disabled] to=${to} subject="${subject}"`);
    return { ok: false, disabled: true };
  }
  if (emailBlocked()) return { ok: false, blocked: true };
  const payload = { from: mail.from, to, subject, html, text };
  if (attachments) payload.attachments = attachments;
  try {
    const res = await resend.emails.send(payload);
    if (res && res.error) {
      const limit = isMonthlyLimit(res.error);
      if (limit) blockEmailThisMonth();
      console.error('[mail:error]', res.error.message || res.error);
      return { ok: false, error: res.error.message || 'send failed', limit };
    }
    return { ok: true, id: res && res.data ? res.data.id : null };
  } catch (err) {
    const limit = isMonthlyLimit(err);
    if (limit) blockEmailThisMonth();
    console.error('[mail:error]', err && err.message ? err.message : err);
    return { ok: false, error: (err && err.message) || 'send failed', limit };
  }
}

function esc(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// New event request → notify the admin.
async function notifyAdminNewRequest(org, event) {
  const link = `${baseUrl}/admin`;
  const subject = `RSVP: new event request from ${org.email}`;
  const text = `${org.email} requested to host "${event.title}".\n\nReview: ${link}`;
  const html = `<p><strong>${esc(org.email)}</strong> requested to host "<strong>${esc(event.title)}</strong>".</p>
<p><a href="${link}">Review in the admin queue</a></p>`;
  return send({ to: adminEmail, subject, text, html });
}

// Organiser approved → send them their dashboard link (approve-only; rejections are silent).
async function notifyRequesterApproved(org) {
  const link = `${baseUrl}/organiser`;
  const subject = 'You can now host events on RSVP';
  const text = `Good news — you're approved to host events.\n\nManage your events: ${link}`;
  const html = `<p>Good news — you're approved to host events.</p>
<p><a href="${link}">Open your organiser dashboard</a></p>`;
  return send({ to: org.email, subject, text, html });
}

// Event detail lines shared by guest emails.
function eventDetails(event) {
  const when = esc(formatDateTime(event.starts_at));
  const where = event.location ? `<br>📍 ${esc(event.location)}` : '';
  return `<p style="color:#555">📅 ${when}${where}</p>`;
}

// Guest invite with their unique RSVP link.
async function sendGuestInvite(event, guest) {
  const link = `${baseUrl}/r/${guest.token}`;
  const subject = `You're invited: ${event.title}`;
  const text = `Hi ${guest.label},\n\nYou're invited to ${event.title}.\nWhen: ${formatDateTime(event.starts_at)}`
    + `${event.location ? `\nWhere: ${event.location}` : ''}\n\nRSVP here: ${link}`;
  const html = `<p>Hi ${esc(guest.label)},</p><p>You're invited to <strong>${esc(event.title)}</strong>.</p>`
    + eventDetails(event)
    + `<p><a href="${link}">Tap here to RSVP</a></p>`;
  return send({ to: guest.email, subject, text, html });
}

// Confirmation after a guest responds Yes/Maybe, with an .ics attachment.
async function sendGuestConfirmation(event, guest) {
  const link = `${baseUrl}/r/${guest.token}`;
  const subject = `You're in: ${event.title}`;
  const text = `Thanks ${guest.label}! You're confirmed for ${event.title} on ${formatDateTime(event.starts_at)}.`
    + `\n\nManage your RSVP: ${link}`;
  const html = `<p>Thanks ${esc(guest.label)} — you're confirmed for <strong>${esc(event.title)}</strong>.</p>`
    + eventDetails(event)
    + `<p>Manage your RSVP anytime: <a href="${link}">${link}</a></p>`;
  const ics = buildIcs(event, `guest-${guest.id}`);
  return send({
    to: guest.email, subject, text, html,
    attachments: [{ filename: 'event.ics', content: Buffer.from(ics).toString('base64') }],
  });
}

// Reminder to a guest who hasn't responded.
async function sendGuestReminder(event, guest) {
  const link = `${baseUrl}/r/${guest.token}`;
  const subject = `Reminder: please RSVP for ${event.title}`;
  const text = `Hi ${guest.label},\n\nJust a reminder to RSVP for ${event.title} (${formatDateTime(event.starts_at)}).\n\n${link}`;
  const html = `<p>Hi ${esc(guest.label)},</p><p>Just a friendly reminder to RSVP for <strong>${esc(event.title)}</strong>.</p>`
    + eventDetails(event)
    + `<p><a href="${link}">Tap here to RSVP</a></p>`;
  return send({ to: guest.email, subject, text, html });
}

module.exports = {
  send, notifyAdminNewRequest, notifyRequesterApproved,
  sendGuestInvite, sendGuestConfirmation, sendGuestReminder,
};
