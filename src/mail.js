'use strict';
// Transactional email (admin alerts + approval notices) via Resend.
// If RESEND_API_KEY is blank, email is disabled and messages are logged instead.
const { mail, baseUrl, adminEmail } = require('./config');

let resend = null;
if (mail.enabled) {
  const { Resend } = require('resend');
  resend = new Resend(mail.resendKey);
}

async function send({ to, subject, html, text }) {
  if (!resend) {
    console.log(`[mail:disabled] to=${to} subject="${subject}"`);
    return { disabled: true };
  }
  try {
    return await resend.emails.send({ from: mail.from, to, subject, html, text });
  } catch (err) {
    console.error('[mail:error]', err && err.message ? err.message : err);
    return { error: true };
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
  const link = `${baseUrl}/organizer`;
  const subject = 'You can now host events on RSVP';
  const text = `Good news — you're approved to host events.\n\nManage your events: ${link}`;
  const html = `<p>Good news — you're approved to host events.</p>
<p><a href="${link}">Open your organiser dashboard</a></p>`;
  return send({ to: org.email, subject, text, html });
}

module.exports = { send, notifyAdminNewRequest, notifyRequesterApproved };
