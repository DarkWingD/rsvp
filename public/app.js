'use strict';
// Small progressive enhancements. The app works without JS; this just makes it nicer.
// Loaded from <head> (not deferred) so the colour-scheme choice applies before first paint.

// ── Colour scheme: auto by default, with a manual light/dark override ──
(function () {
  var KEY = 'rsvp-mode'; // 'auto' | 'light' | 'dark'
  function read() {
    try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; }
  }
  function apply(mode) {
    var el = document.documentElement;
    if (mode === 'light' || mode === 'dark') el.setAttribute('data-mode', mode);
    else el.removeAttribute('data-mode'); // auto → follow the OS
  }
  apply(read()); // run immediately to avoid a flash
  window.__rsvpTheme = {
    get: read,
    set: function (m) { try { localStorage.setItem(KEY, m); } catch (e) {} apply(m); },
  };
})();

document.addEventListener('DOMContentLoaded', function () {
  // Wire the colour-scheme toggle button (cycles auto → light → dark).
  var btn = document.getElementById('theme-toggle');
  if (btn) {
    var order = ['auto', 'light', 'dark'];
    var face = { auto: '🌗 Auto', light: '☀️ Light', dark: '🌙 Dark' };
    var render = function () {
      var m = window.__rsvpTheme.get();
      btn.textContent = face[m] || face.auto;
      btn.setAttribute('aria-label', 'Colour scheme: ' + (m || 'auto'));
    };
    render();
    btn.addEventListener('click', function () {
      var m = window.__rsvpTheme.get();
      window.__rsvpTheme.set(order[(order.indexOf(m) + 1) % order.length]);
      render();
    });
  }

  // Reveal the "ask dietary" option only when "has food" is ticked.
  var food = document.getElementById('has_food');
  var dietRow = document.getElementById('dietrow');
  if (food && dietRow) {
    var sync = function () { dietRow.style.display = food.checked ? 'flex' : 'none'; };
    food.addEventListener('change', sync);
    sync();
  }

  // Join-mode toggle: per-guest options vs open sign-up options.
  var amOpen = document.getElementById('am_open');
  var amGuest = document.getElementById('am_guest');
  var perGuestOpts = document.getElementById('per-guest-opts');
  var openLinkOpts = document.getElementById('open-link-opts');
  if (amOpen && amGuest && perGuestOpts && openLinkOpts) {
    var syncMode = function () {
      perGuestOpts.style.display = amOpen.checked ? 'none' : 'block';
      openLinkOpts.style.display = amOpen.checked ? 'block' : 'none';
    };
    amOpen.addEventListener('change', syncMode);
    amGuest.addEventListener('change', syncMode);
    syncMode();
  }

  // Live theme preview on the event form.
  var themeSel = document.getElementById('theme');
  var preview = document.getElementById('theme-preview');
  if (themeSel && preview) {
    themeSel.addEventListener('change', function () {
      preview.className = 'theme-preview theme-' + themeSel.value;
    });
  }
  var titleInput = document.getElementById('title');
  var tpTitle = document.getElementById('tp-title');
  if (titleInput && tpTitle) {
    titleInput.addEventListener('input', function () {
      tpTitle.textContent = titleInput.value || 'Your event title';
    });
  }
  var locInput = document.getElementById('location');
  var tpLoc = document.getElementById('tp-loc');
  if (locInput && tpLoc) {
    locInput.addEventListener('input', function () {
      var v = locInput.value.trim();
      if (v.length > 40) v = v.slice(0, 40) + '…';
      tpLoc.textContent = '📍 ' + (v || 'Location');
    });
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

// In-app confirmation modal for destructive forms: <form data-confirm="Are you sure?">.
function showConfirm(message, onOk) {
  var overlay = document.getElementById('confirm-modal');
  if (!overlay) { if (window.confirm(message)) onOk(); return; } // fallback if modal absent
  document.getElementById('confirm-text').textContent = message;
  var ok = document.getElementById('confirm-ok');
  var cancel = document.getElementById('confirm-cancel');
  overlay.hidden = false;

  function cleanup() {
    overlay.hidden = true;
    ok.removeEventListener('click', onOkClick);
    cancel.removeEventListener('click', cleanup);
    overlay.removeEventListener('click', onBackdrop);
    document.removeEventListener('keydown', onKey);
  }
  function onOkClick() { cleanup(); onOk(); }
  function onBackdrop(ev) { if (ev.target === overlay) cleanup(); }
  function onKey(ev) {
    if (ev.key === 'Escape') cleanup();
    else if (ev.key === 'Enter') { cleanup(); onOk(); }
  }
  ok.addEventListener('click', onOkClick);
  cancel.addEventListener('click', cleanup);
  overlay.addEventListener('click', onBackdrop);
  document.addEventListener('keydown', onKey);
  ok.focus();
}

document.addEventListener('submit', function (e) {
  var form = e.target;
  if (!(form.matches && form.matches('[data-confirm]'))) return;
  e.preventDefault();
  // form.submit() bypasses this handler, so no re-prompt loop.
  showConfirm(form.getAttribute('data-confirm'), function () { form.submit(); });
});
