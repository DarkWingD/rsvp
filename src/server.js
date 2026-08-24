'use strict';
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const { formatDateTime, formatDate, formatTimeOnly } = require('./time');
const { isHttpUrl, mapLabel } = require('./location');
require('./db'); // initialise schema on startup
const { runPurge } = require('./purge');

const app = express();
app.set('trust proxy', true); // behind Cloudflare Tunnel
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// Security headers. Allow Turnstile's script/frame; everything else self-hosted.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://challenges.cloudflare.com'],
      frameSrc: ['https://challenges.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'https://challenges.cloudflare.com'],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
}));

// In-app rate limiting (a $0 fallback for edge rate limiting). Keyed on the real client IP
// that Cloudflare forwards. This backs up — it does not replace — Cloudflare's edge rules.
const postLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.ip,
  validate: { trustProxy: false },
});
app.use((req, res, next) => (req.method === 'POST' ? postLimiter(req, res, next) : next()));

app.use(cookieParser(config.secret));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

// CSRF: synchroniser token in a signed, httpOnly cookie; verified on state-changing methods.
app.use((req, res, next) => {
  let token = req.signedCookies && req.signedCookies.csrf;
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    res.cookie('csrf', token, { httpOnly: true, sameSite: 'lax', secure: config.isHttps, signed: true });
  }
  res.locals.csrfToken = token;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    if (!req.body || req.body._csrf !== token) {
      return res.status(403).render('error', {
        title: 'Session expired',
        message: 'Your form session expired or was invalid. Please go back and try again.',
      });
    }
  }
  next();
});

// View helpers available to every template.
app.use((req, res, next) => {
  res.locals.fmtDateTime = formatDateTime;
  res.locals.fmtDate = formatDate;
  res.locals.fmtTime = formatTimeOnly;
  res.locals.isUrl = isHttpUrl;
  res.locals.mapLabel = mapLabel;
  res.locals.baseUrl = config.baseUrl;
  res.locals.appTz = config.tz;
  res.locals.turnstileSiteKey = config.turnstile.siteKey;
  res.locals.currentPath = req.path;
  next();
});

// Routes
app.get('/', (req, res) => res.render('home', { title: 'RSVP' }));
app.get('/privacy', (req, res) => res.render('privacy', { title: 'Privacy', purgeDays: config.purgeDays }));
app.use('/r', require('./routes/guest'));
app.use('/organiser', require('./routes/organizer'));
app.use('/admin', require('./routes/admin'));

// 404
app.use((req, res) => res.status(404).render('error', { title: 'Not found', message: 'That page could not be found.' }));

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err && err.stack ? err.stack : err);
  res.status(500).render('error', { title: 'Something went wrong', message: 'An unexpected error occurred.' });
});

// In-process safety-net purge (in addition to the nightly systemd timer).
try { runPurge(); } catch (e) { console.error('[purge:startup]', e.message); }
setInterval(() => { try { runPurge(); } catch (e) { console.error('[purge:interval]', e.message); } }, 6 * 3600 * 1000);

app.listen(config.port, '127.0.0.1', () => {
  console.log(`RSVP listening on http://127.0.0.1:${config.port}  (public: ${config.baseUrl})`);
  if (config.devBypassAuth) console.warn('⚠  DEV_BYPASS_AUTH is ON — authentication is bypassed. Do NOT use in production.');
  if (!config.cf.teamDomain && !config.devBypassAuth) {
    console.warn('⚠  Cloudflare Access is not configured (CF_ACCESS_TEAM_DOMAIN). /organiser and /admin will reject.');
  }
});
