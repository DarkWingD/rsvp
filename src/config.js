'use strict';
// Central configuration. Everything comes from environment variables (see .env.example).
// No secrets or environment-specific values are hard-coded anywhere in the source.
require('dotenv').config();

const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
const str = (v, d = '') => (v == null || v === '' ? d : String(v));
const lc = (v, d = '') => str(v, d).toLowerCase().trim();

const baseUrl = str(process.env.BASE_URL, `http://localhost:${int(process.env.PORT, 3000)}`)
  .replace(/\/+$/, '');

module.exports = {
  port: int(process.env.PORT, 3000),
  baseUrl,
  isHttps: baseUrl.startsWith('https://'),
  tz: str(process.env.APP_TZ, 'UTC'),
  secret: str(process.env.SECRET, 'dev-insecure-change-me'),
  dbPath: str(process.env.DB_PATH, 'data.db'),

  adminEmail: lc(process.env.ADMIN_EMAIL),

  cf: {
    teamDomain: str(process.env.CF_ACCESS_TEAM_DOMAIN).replace(/\/+$/, ''),
    aud: str(process.env.CF_ACCESS_AUD),
  },
  devBypassAuth: str(process.env.DEV_BYPASS_AUTH) === 'true',
  devEmail: lc(process.env.DEV_EMAIL, lc(process.env.ADMIN_EMAIL)),

  turnstile: {
    siteKey: str(process.env.TURNSTILE_SITE_KEY),
    secretKey: str(process.env.TURNSTILE_SECRET_KEY),
    get enabled() {
      return Boolean(this.siteKey && this.secretKey);
    },
  },

  mail: {
    resendKey: str(process.env.RESEND_API_KEY),
    from: str(process.env.MAIL_FROM, 'RSVP <no-reply@example.com>'),
    get enabled() {
      return Boolean(this.resendKey);
    },
  },

  purgeDays: int(process.env.PURGE_DAYS, 30),

  caps: {
    activeEventsPerOrg: int(process.env.MAX_ACTIVE_EVENTS_PER_ORG, 10),
    guestsPerEvent: int(process.env.MAX_GUESTS_PER_EVENT, 250),
    guestsPerRequest: int(process.env.MAX_GUESTS_PER_REQUEST, 500),
    eventsPerDay: int(process.env.MAX_EVENTS_PER_DAY, 5),
    signupsPerDay: int(process.env.MAX_SIGNUPS_PER_DAY, 20),
    globalActiveEvents: int(process.env.GLOBAL_ACTIVE_EVENT_CAP, 200),
    rsvpEditsPerHour: int(process.env.MAX_RSVP_EDITS_PER_HOUR, 20),
  },

  themes: ['modern', 'warm', 'elegant'],
};
