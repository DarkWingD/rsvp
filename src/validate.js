'use strict';
// Input parsing & validation for forms. Returns { errors: [...], data: {...} }.
const { themes } = require('./config');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function cleanStr(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}
function checked(v) {
  return v === 'on' || v === '1' || v === 'true';
}

function parseEventForm(body) {
  const errors = [];
  const title = cleanStr(body.title, 120);
  if (!title) errors.push('Title is required.');

  const date = cleanStr(body.date, 10);
  if (!DATE_RE.test(date)) errors.push('A valid start date is required.');
  let time = cleanStr(body.time, 5);
  if (time && !TIME_RE.test(time)) { errors.push('Start time is invalid.'); time = ''; }
  const starts_at = `${date}T${time || '00:00'}`;

  let ends_at = null;
  const endTime = cleanStr(body.end_time, 5);
  if (endTime) {
    if (!TIME_RE.test(endTime)) errors.push('End time is invalid.');
    else ends_at = `${date}T${endTime}`;
  }
  if (ends_at && ends_at <= starts_at) errors.push('End time must be after the start time.');

  let rsvp_deadline = cleanStr(body.rsvp_deadline, 10) || null;
  if (rsvp_deadline && !DATE_RE.test(rsvp_deadline)) { errors.push('RSVP deadline is invalid.'); rsvp_deadline = null; }

  let theme = cleanStr(body.theme, 20);
  if (!themes.includes(theme)) theme = 'modern';

  const has_food = checked(body.has_food);
  const ask_dietary = has_food && checked(body.ask_dietary);
  const guests_see_each_other = checked(body.guests_see_each_other);

  return {
    errors,
    data: {
      title,
      description: cleanStr(body.description, 4000) || null,
      location: cleanStr(body.location, 300) || null,
      starts_at, ends_at, rsvp_deadline, theme,
      has_food, ask_dietary, guests_see_each_other,
    },
  };
}

function parseGuestNames(raw, max) {
  return String(raw || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.slice(0, 120))
    .slice(0, max);
}

function parseRsvpForm(body, askDietary) {
  const errors = [];
  const rsvp = ['yes', 'no', 'maybe'].includes(body.rsvp) ? body.rsvp : null;
  if (!rsvp) errors.push('Please choose Yes, No, or Maybe.');
  let party_size = parseInt(body.party_size, 10);
  if (!Number.isFinite(party_size) || party_size < 1) party_size = 1;
  if (party_size > 20) party_size = 20;
  const dietary = askDietary ? (cleanStr(body.dietary, 500) || null) : null;
  const notes = cleanStr(body.notes, 500) || null;
  return { errors, data: { rsvp, party_size, dietary, notes } };
}

module.exports = { cleanStr, checked, parseEventForm, parseGuestNames, parseRsvpForm };
