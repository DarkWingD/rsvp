'use strict';
// Date/time helpers. Event times are stored as naive local wall-clock strings
// ("YYYY-MM-DDTHH:mm") interpreted in APP_TZ. These helpers format them for display
// and convert to UTC for calendar (.ics) output.
const { tz } = require('./config');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseLocal(localStr) {
  if (!localStr) return null;
  const [datePart, timePart = '00:00'] = String(localStr).split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  if (!y || !mo || !d) return null;
  return { y, mo, d, h: h || 0, mi: mi || 0 };
}

function nowLocalDateStr() {
  // Today's date (YYYY-MM-DD) in APP_TZ.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).reduce((a, p) => ((a[p.type] = p.value), a), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function pad(n) { return String(n).padStart(2, '0'); }

function formatTime(h, mi) {
  const ampm = h >= 12 ? 'pm' : 'am';
  let hr = h % 12;
  if (hr === 0) hr = 12;
  return mi === 0 ? `${hr}${ampm}` : `${hr}:${pad(mi)}${ampm}`;
}

// "Sat 12 Oct 2026 · 3:00pm"
function formatDateTime(localStr) {
  const p = parseLocal(localStr);
  if (!p) return '';
  const wd = WEEKDAYS[new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay()];
  return `${wd} ${p.d} ${MONTHS[p.mo - 1]} ${p.y} · ${formatTime(p.h, p.mi)}`;
}

// "3:00pm" (time only)
function formatTimeOnly(localStr) {
  const p = parseLocal(localStr);
  if (!p) return '';
  return formatTime(p.h, p.mi);
}

// "Sat 12 Oct 2026" (date only)
function formatDate(localStr) {
  const p = parseLocal(localStr);
  if (!p) return '';
  const wd = WEEKDAYS[new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay()];
  return `${wd} ${p.d} ${MONTHS[p.mo - 1]} ${p.y}`;
}

// Offset (minutes, zone - UTC) of `date` (a UTC instant) in the given IANA timezone.
function tzOffsetMinutes(date, zone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = dtf.formatToParts(date).reduce((a, x) => ((a[x.type] = x.value), a), {});
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUTC - date.getTime()) / 60000;
}

// Convert a wall-clock local string in APP_TZ to a UTC Date.
function zonedToUtc(localStr) {
  const p = parseLocal(localStr);
  if (!p) return null;
  const guess = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, 0);
  const offset = tzOffsetMinutes(new Date(guess), tz);
  return new Date(guess - offset * 60000);
}

function toIcsStamp(date) {
  return date.getUTCFullYear().toString()
    + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate()) + 'T'
    + pad(date.getUTCHours()) + pad(date.getUTCMinutes()) + pad(date.getUTCSeconds()) + 'Z';
}

function icsEscape(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// Build a minimal VCALENDAR for an event.
function buildIcs(event, uidSeed) {
  const start = zonedToUtc(event.starts_at);
  let end = event.ends_at ? zonedToUtc(event.ends_at) : null;
  if (!end && start) end = new Date(start.getTime() + 2 * 60 * 60 * 1000); // default 2h
  const stamp = toIcsStamp(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//rsvp//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${icsEscape(uidSeed)}@rsvp`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${toIcsStamp(start)}`,
    `DTEND:${toIcsStamp(end)}`,
    `SUMMARY:${icsEscape(event.title)}`,
  ];
  if (event.location) lines.push(`LOCATION:${icsEscape(event.location)}`);
  if (event.description) lines.push(`DESCRIPTION:${icsEscape(event.description)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

// Is the given local date/time in the past (relative to now in APP_TZ)?
function isPastLocal(localStr) {
  if (!localStr) return false;
  const d = zonedToUtc(localStr);
  return d ? d.getTime() < Date.now() : false;
}

// Is a date-only string (YYYY-MM-DD) before today in APP_TZ?
function isPastDate(dateStr) {
  if (!dateStr) return false;
  return dateStr < nowLocalDateStr();
}

module.exports = {
  parseLocal, formatDateTime, formatDate, formatTimeOnly, zonedToUtc, buildIcs,
  isPastLocal, isPastDate, nowLocalDateStr,
};
