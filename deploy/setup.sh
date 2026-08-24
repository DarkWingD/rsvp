#!/usr/bin/env bash
#
# One-shot provisioning for the RSVP app on Fedora (or similar systemd + dnf systems).
# Run as root:   sudo bash deploy/setup.sh
#
# Idempotent-ish: safe to re-run to update code and refresh services.
# It does NOT do the interactive Cloudflare steps (tunnel login, Access) — see deploy/cloudflared.md.

set -euo pipefail

APP_USER="rsvp"
APP_HOME="/opt/rsvp"
APP_DIR="${APP_HOME}/app"
REPO_URL="${1:-https://github.com/DarkWingD/rsvp.git}"

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root:  sudo bash deploy/setup.sh" >&2
  exit 1
fi

echo "==> Installing packages (nodejs, build tools, sqlite, git)"
dnf install -y nodejs gcc-c++ make python3 sqlite git

echo "==> Ensuring service user '${APP_USER}'"
id -u "${APP_USER}" &>/dev/null || useradd -r -m -d "${APP_HOME}" "${APP_USER}"

echo "==> Fetching code into ${APP_DIR}"
if [[ -d "${APP_DIR}/.git" ]]; then
  sudo -u "${APP_USER}" git -C "${APP_DIR}" pull --ff-only
else
  sudo -u "${APP_USER}" git clone "${REPO_URL}" "${APP_DIR}"
fi

echo "==> Installing dependencies and building CSS"
cd "${APP_DIR}"
sudo -u "${APP_USER}" npm ci
sudo -u "${APP_USER}" npm run css:build

if [[ ! -f "${APP_DIR}/.env" ]]; then
  echo "==> Creating .env from template (EDIT THIS before the app is usable)"
  sudo -u "${APP_USER}" cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
  NEW_ENV=1
fi

echo "==> Installing systemd units (app + purge timer + backup timer)"
install -m0644 deploy/rsvp.service          /etc/systemd/system/rsvp.service
install -m0644 deploy/rsvp-purge.service    /etc/systemd/system/rsvp-purge.service
install -m0644 deploy/rsvp-purge.timer      /etc/systemd/system/rsvp-purge.timer
install -m0644 deploy/rsvp-backup.service   /etc/systemd/system/rsvp-backup.service
install -m0644 deploy/rsvp-backup.timer     /etc/systemd/system/rsvp-backup.timer
systemctl daemon-reload
systemctl enable --now rsvp-purge.timer rsvp-backup.timer

if [[ "${NEW_ENV:-0}" == "1" ]]; then
  echo
  echo "  ⚠  Edit ${APP_DIR}/.env now (ADMIN_EMAIL, SECRET, BASE_URL, APP_TZ, CF_ACCESS_*),"
  echo "     then start the app:  systemctl enable --now rsvp"
else
  systemctl enable --now rsvp
  systemctl restart rsvp
fi

echo
echo "==> Done."
echo "    App status:   systemctl status rsvp --no-pager"
echo "    Logs:         journalctl -u rsvp -f"
echo "    Next:         set up the Cloudflare Tunnel + Access (deploy/cloudflared.md)"
