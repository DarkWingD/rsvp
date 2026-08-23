'use strict';
// Unguessable, URL-safe tokens for per-guest RSVP links. Server-generated only.
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; // no 0/O/1/I/l

// ~16 chars from a 56-symbol alphabet ≈ 92 bits of entropy.
function makeToken(length = 16) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

module.exports = { makeToken };
