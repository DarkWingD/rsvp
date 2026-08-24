#!/usr/bin/env bash
#
# Consistent SQLite backup, gzipped, with local rotation and optional offsite copy.
# Invoked by rsvp-backup.timer. Runs as the 'rsvp' user.
#
# Offsite (optional): create /opt/rsvp/backup.env with a line like
#   RCLONE_REMOTE=myremote:rsvp-backups
# and configure rclone for that user, and backups are copied there too.

set -euo pipefail

APP_DIR="/opt/rsvp/app"
BACKUP_DIR="/opt/rsvp/backups"
KEEP=14

mkdir -p "${BACKUP_DIR}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="${BACKUP_DIR}/rsvp-${STAMP}.db"

sqlite3 "${APP_DIR}/data.db" ".backup '${DEST}'"
gzip -f "${DEST}"   # -> ${DEST}.gz

# Rotate: keep only the newest ${KEEP} archives.
ls -1t "${BACKUP_DIR}"/rsvp-*.db.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

# Optional offsite copy.
if [[ -f /opt/rsvp/backup.env ]]; then
  # shellcheck disable=SC1091
  source /opt/rsvp/backup.env
  if [[ -n "${RCLONE_REMOTE:-}" ]]; then
    rclone copy "${DEST}.gz" "${RCLONE_REMOTE}" || echo "backup: rclone copy failed" >&2
  fi
fi

echo "backup: wrote ${DEST}.gz"
