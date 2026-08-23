'use strict';
// Delete events (and cascade their guests) whose purge date has passed.
// Run as a script (`npm run purge`) via a nightly timer, and also scheduled in-process.
const { db } = require('./db');
const { nowLocalDateStr } = require('./time');

function runPurge() {
  const today = nowLocalDateStr();
  const info = db.prepare('DELETE FROM events WHERE purge_after < ?').run(today);
  return info.changes;
}

if (require.main === module) {
  const n = runPurge();
  console.log(`[purge] removed ${n} expired event(s) as of ${nowLocalDateStr()}`);
  process.exit(0);
}

module.exports = { runPurge };
