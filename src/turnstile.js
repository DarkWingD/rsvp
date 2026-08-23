'use strict';
// Cloudflare Turnstile (captcha) verification for the public "request an event" form.
// If Turnstile isn't configured, verification is skipped (returns true).
const { turnstile } = require('./config');

async function verifyTurnstile(token, ip) {
  if (!turnstile.enabled) return true; // not configured → no-op
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret: turnstile.secretKey, response: token });
    if (ip) body.append('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await res.json();
    return Boolean(data.success);
  } catch (_e) {
    return false;
  }
}

module.exports = { verifyTurnstile };
