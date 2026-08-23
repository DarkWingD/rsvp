'use strict';
// Cloudflare Access authentication. Access proves the visitor's email (one-time PIN) and
// passes a signed JWT; we verify it here and never trust the raw header. The app then
// authorises based on the verified email (admin / organiser / new-requester).
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { cf, devBypassAuth, devEmail, adminEmail } = require('./config');
const { roleForEmail, findOrganizerByEmail } = require('./models');

let client = null;
if (cf.teamDomain) {
  client = jwksClient({
    jwksUri: `${cf.teamDomain}/cdn-cgi/access/certs`,
    cache: true,
    cacheMaxAge: 60 * 60 * 1000,
    rateLimit: true,
  });
}

function getKey(header, cb) {
  if (!client) return cb(new Error('Cloudflare Access is not configured (CF_ACCESS_TEAM_DOMAIN)'));
  client.getSigningKey(header.kid, (err, key) => (err ? cb(err) : cb(null, key.getPublicKey())));
}

function verifyAccessJwt(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getKey,
      { audience: cf.aud, issuer: cf.teamDomain, algorithms: ['RS256'] },
      (err, decoded) => (err ? reject(err) : resolve(decoded))
    );
  });
}

function getAccessToken(req) {
  return (
    req.headers['cf-access-jwt-assertion'] ||
    (req.cookies && req.cookies.CF_Authorization) ||
    null
  );
}

// Returns the verified lowercase email, or null.
async function identify(req) {
  if (devBypassAuth) return devEmail || null;
  const token = getAccessToken(req);
  if (!token) return null;
  try {
    const decoded = await verifyAccessJwt(token);
    return (decoded.email || '').toLowerCase() || null;
  } catch (_e) {
    return null;
  }
}

function unauthorized(res) {
  return res.status(401).render('error', {
    title: 'Sign-in required',
    message: 'Please sign in via Cloudflare Access to continue.',
  });
}

// Any authenticated identity (guest pages do NOT use this).
function requireAuth() {
  return async (req, res, next) => {
    const email = await identify(req);
    if (!email) return unauthorized(res);
    req.userEmail = email;
    req.role = roleForEmail(email);
    req.organizer = findOrganizerByEmail(email) || null;
    res.locals.role = req.role;
    res.locals.isAdmin = email === adminEmail;
    res.locals.userEmail = email;
    next();
  };
}

// Admin-only.
function requireAdmin() {
  return async (req, res, next) => {
    const email = await identify(req);
    if (!email) return unauthorized(res);
    if (email !== adminEmail) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'Admins only.' });
    }
    req.userEmail = email;
    req.role = 'admin';
    res.locals.role = 'admin';
    res.locals.isAdmin = true;
    res.locals.userEmail = email;
    next();
  };
}

module.exports = { requireAuth, requireAdmin, identify, verifyAccessJwt };
