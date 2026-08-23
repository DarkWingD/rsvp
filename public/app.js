'use strict';
// Small progressive enhancements. The app works without JS; this just makes it nicer.
// (Loaded as an external file so it complies with a strict Content-Security-Policy.)

// Reveal the "ask dietary" option only when "has food" is ticked.
document.addEventListener('DOMContentLoaded', function () {
  var food = document.getElementById('has_food');
  var dietRow = document.getElementById('dietrow');
  if (food && dietRow) {
    var sync = function () { dietRow.style.display = food.checked ? 'flex' : 'none'; };
    food.addEventListener('change', sync);
    sync();
  }
});

// Copy-to-clipboard buttons: [data-copy="text"] or [data-copy-target="#selector"].
document.addEventListener('click', function (e) {
  var btn = e.target.closest('[data-copy], [data-copy-target]');
  if (!btn) return;
  e.preventDefault();
  var text = btn.getAttribute('data-copy');
  if (!text) {
    var el = document.querySelector(btn.getAttribute('data-copy-target'));
    text = el ? (el.value != null ? el.value : el.textContent) : '';
  }
  var done = function () {
    var original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(function () { btn.textContent = original; }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () {});
  }
});

// Confirm dialogs for destructive forms: <form data-confirm="Are you sure?">.
document.addEventListener('submit', function (e) {
  var form = e.target;
  if (form.matches && form.matches('[data-confirm]')) {
    if (!window.confirm(form.getAttribute('data-confirm'))) e.preventDefault();
  }
});
