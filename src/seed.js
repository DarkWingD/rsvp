'use strict';
// Create a demo event + guests for local development, and print a guest link to try.
const config = require('./config');
const {
  ensureOrganizer, setOrganizerStatus, getOrganizer, createEvent, addGuests, listGuests, addDaysToDate,
} = require('./models');
const { nowLocalDateStr } = require('./time');

const adminEmail = config.adminEmail || 'admin@example.com';
let org = ensureOrganizer(adminEmail);
if (org.status !== 'approved') {
  setOrganizerStatus(org.id, 'approved'); // ensure the demo event goes live in dev
  org = getOrganizer(org.id);
}

const startDate = addDaysToDate(nowLocalDateStr(), 14);
const event = createEvent({
  title: 'Demo Summer BBQ',
  description: 'Bring swimmers and a big appetite!',
  location: 'Our backyard',
  starts_at: `${startDate}T15:00`,
  ends_at: `${startDate}T18:00`,
  rsvp_deadline: null,
  theme: 'warm',
  has_food: true,
  ask_dietary: true,
  guests_see_each_other: false,
}, org);

addGuests(event.id, ['Sarah', 'Tom', 'Priya']);
const guests = listGuests(event.id);

console.log('\nSeeded demo event:', event.title, `(id ${event.id}, status ${event.status})`);
console.log('Organiser:', adminEmail);
console.log('\nGuest links:');
for (const g of guests) {
  console.log(`  ${g.label.padEnd(8)} ${config.baseUrl}/r/${g.token}`);
}
console.log('\nOpen a guest link above to try an RSVP. Admin/organiser pages: ' + config.baseUrl + '/organizer\n');
process.exit(0);
