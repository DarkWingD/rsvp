'use strict';
// Helpers for rendering a location that may be a pasted map link.

function isHttpUrl(s) {
  return /^https?:\/\/\S+$/i.test(String(s || '').trim());
}

// Try to pull a human-readable place name out of a maps URL; fall back to the host.
function mapLabel(s) {
  const raw = String(s || '').trim();
  try {
    const u = new URL(raw);
    // Google Maps: .../place/Some+Place/@...
    const place = u.pathname.match(/\/place\/([^/@]+)/);
    if (place) return decodeURIComponent(place[1].replace(/\+/g, ' ')).trim();
    // ?q= / ?query= style
    const q = u.searchParams.get('q') || u.searchParams.get('query');
    if (q) return decodeURIComponent(q.replace(/\+/g, ' ')).trim();
    // Shortened links can't be parsed without following them
    if (/goo\.gl|maps\.app|osm\.org|openstreetmap/.test(u.host)) return 'View on map';
    return u.host.replace(/^www\./, '');
  } catch (_e) {
    return 'View on map';
  }
}

module.exports = { isHttpUrl, mapLabel };
