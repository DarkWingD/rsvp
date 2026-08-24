# RSVP

A **simple, privacy-respecting, self-hosted RSVP system** for organising events with
friends & family — without making your guests create accounts.

- 🔑 **No logins for guests.** Each guest gets a unique, unguessable link and just taps
  Yes / No / Maybe.
- 🛡️ **Organiser auth with zero password code** — handled by [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
  (one-time email PIN). The app never stores passwords.
- ✅ **Approval gate** — you approve who is allowed to create events (once per person).
- 🔒 **Minimal personal data**, with automatic deletion a fixed period after each event.
- 🎨 **Mobile-first**, with a theme the organiser picks per event.
- 💸 **~$0 to run** on a small always-on PC behind a free Cloudflare Tunnel.

> **Status:** early / self-host project. Provided as-is under the MIT license.

---

## How it works

```
 Guest / Organiser
        │  https://rsvp.example.com
        ▼
 ┌──────────────┐   Cloudflare Access gates /admin & /organiser (email PIN)
 │  Cloudflare  │   Turnstile + WAF + rate limiting at the edge
 └──────┬───────┘
        │  Cloudflare Tunnel (outbound, no open ports)
        ▼
 ┌──────────────┐   Node + Express (bound to 127.0.0.1)
 │   this app   │   • verifies the Access JWT, reads the visitor's email
 │              │   • authorises: admin / organiser / new-requester
 │   SQLite     │   • serves public guest pages at /r/:token
 └──────────────┘
```

**Cloudflare Access authenticates; the app authorises.** After a visitor signs in with a
one-time PIN, Cloudflare passes a signed JWT to the app. The app verifies it and decides:

| Verified email | Role |
| --- | --- |
| matches `ADMIN_EMAIL` | **Admin** — approve organisers, oversee/cancel events, kill switch |
| an approved organiser | **Organiser** — create events, manage guests, share links |
| anyone else | shown a **"request to host an event"** form → lands in the admin queue |

Guest RSVP pages (`/r/:token`) are **public** (outside Cloudflare Access) so guests never log in.

---

## Prerequisites

- A host to run it on — **Linux (e.g. Fedora)** recommended for an always-on box, but any
  machine with **Node.js ≥ 20** works.
- A **domain managed by Cloudflare** (free plan is fine).
- A **Cloudflare Zero Trust** account (free tier covers up to 50 organiser seats).
- Optionally a [Resend](https://resend.com) account (free tier) for admin/approval emails.

On a fresh Fedora box you may also need build tools for the native SQLite module:

```bash
sudo dnf install -y nodejs gcc-c++ make python3
```

---

## Quick start (local development)

```bash
git clone https://github.com/DarkWingD/rsvp.git
cd rsvp
npm ci
cp .env.example .env          # then edit .env (see Configuration below)
npm run css:build             # compile Tailwind CSS once
npm run seed                  # create a demo event + guest link (prints the link)
npm run dev                   # start the app on http://localhost:3000
```

For local dev, set `DEV_BYPASS_AUTH=true` and `DEV_EMAIL=admin@example.com` in `.env` so you
can reach the admin/organiser pages **without** Cloudflare in front. Open the guest link that
`npm run seed` printed to try an RSVP.

> ⚠️ Never set `DEV_BYPASS_AUTH=true` in production — it disables authentication.

---

## Configuration

All configuration is via environment variables in `.env` (copied from `.env.example`).
**No secrets live in the code.**

| Variable | Required | Purpose | Example |
| --- | --- | --- | --- |
| `PORT` | yes | Port the app listens on (localhost only) | `3000` |
| `BASE_URL` | yes | Public URL, used to build shareable links | `https://rsvp.example.com` |
| `APP_TZ` | yes | IANA timezone for displaying dates | `Australia/Perth` |
| `SECRET` | yes | Long random string for CSRF/session signing | `openssl rand -hex 32` |
| `ADMIN_EMAIL` | yes | Email with full admin rights | `admin@example.com` |
| `CF_ACCESS_TEAM_DOMAIN` | prod | Your Zero Trust team domain | `https://team.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | prod | Access application Audience (AUD) tag | `a1b2c3...` |
| `DEV_BYPASS_AUTH` | no | Bypass Access locally (dev only!) | `false` |
| `DEV_EMAIL` | no | Email assumed when bypassing auth | `admin@example.com` |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | no | Captcha on the request form | — |
| `RESEND_API_KEY` | no | Enables email; blank = log instead | `re_...` |
| `MAIL_FROM` | no | From address for outgoing mail | `RSVP <no-reply@example.com>` |
| `PURGE_DAYS` | no | Days after event to auto-delete data | `30` |
| `MAX_ACTIVE_EVENTS_PER_ORG` | no | Cap: active events per organiser | `10` |
| `MAX_GUESTS_PER_EVENT` | no | Cap: guests per event | `250` |
| `MAX_GUESTS_PER_REQUEST` | no | Cap: guests added in one request | `500` |
| `MAX_EVENTS_PER_DAY` | no | Cap: new events/day per organiser | `5` |
| `MAX_SIGNUPS_PER_DAY` | no | Cap: new organiser signups/day (global) | `20` |
| `GLOBAL_ACTIVE_EVENT_CAP` | no | Global active-event cap → auto-pause signups | `200` |
| `MAX_RSVP_EDITS_PER_HOUR` | no | Cap: RSVP edits per link per hour | `20` |

---

## Production setup (Fedora + Cloudflare)

**Fast path:** a provisioning script does steps 1–2 and the systemd wiring for you:

```bash
sudo bash deploy/setup.sh
# then edit /opt/rsvp/app/.env and:  sudo systemctl enable --now rsvp
```
It installs Node + build tools, creates the `rsvp` user, clones/updates the repo, builds CSS,
creates `.env` from the template, and enables the app + nightly purge/backup timers. You still
do the interactive Cloudflare steps below (tunnel login, Access app). The manual equivalent:

Placeholders below (`rsvp.example.com`, `admin@example.com`) — substitute your own.

1. **Install & place the app**
   ```bash
   sudo useradd -r -m -d /opt/rsvp rsvp
   sudo -u rsvp git clone https://github.com/DarkWingD/rsvp.git /opt/rsvp/app
   cd /opt/rsvp/app && sudo -u rsvp npm ci && sudo -u rsvp npm run css:build
   sudo -u rsvp cp .env.example .env   # then edit with real values
   ```
   The app binds to `127.0.0.1:$PORT` only — it is never exposed to your LAN directly.

2. **Run as a service** — see [`deploy/rsvp.service`](deploy/rsvp.service):
   ```bash
   sudo cp deploy/rsvp.service /etc/systemd/system/
   sudo systemctl enable --now rsvp
   ```

3. **Cloudflare Tunnel** — expose the app with no open ports (see [`deploy/cloudflared.md`](deploy/cloudflared.md)):
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create rsvp
   cloudflared tunnel route dns rsvp rsvp.example.com
   # map rsvp.example.com -> http://localhost:3000 in the tunnel config, then:
   sudo cloudflared service install
   ```

4. **Cloudflare Access** (Zero Trust → Access → Applications → Add a self-hosted app):
   - Application domain: `rsvp.example.com`
   - **Path**: add an application covering `/admin` and `/organiser` **only** (leave `/` and
     `/r/*` public).
   - Policy: **Allow** with a **One-time PIN** login method.
   - Copy the application **Audience (AUD)** tag and your **team domain** into `.env`
     (`CF_ACCESS_AUD`, `CF_ACCESS_TEAM_DOMAIN`).

5. **Turnstile** (optional but recommended): create a widget, put the keys in `.env`.

6. **Edge protection**: turn on Bot Fight Mode and the managed WAF, and add one Rate-Limiting
   rule on the `/request` and `/r/*` POST paths.

7. **Timers** — auto-purge and offsite backups (systemd timers or cron):
   ```bash
   # nightly purge of expired events
   node /opt/rsvp/app/src/purge.js
   # nightly consistent backup, then copy offsite
   sqlite3 /opt/rsvp/app/data.db ".backup '/tmp/rsvp.bak'"
   rclone copy /tmp/rsvp.bak remote:rsvp-backups   # or scp to another machine
   ```

8. **Resilience**: set the BIOS to *Restore on AC power loss = On*, and confirm the `rsvp` and
   `cloudflared` services come back after a reboot.

---

## Security & privacy notes

- The app **binds to `127.0.0.1`** and is only reachable through Cloudflare — so nobody on your
  LAN can hit `/admin` directly, and the Access JWT is **always verified** server-side.
- **Data minimisation**: we store an organiser's email and a guest label; everything else
  (dietary, notes, party size) is optional. Dietary is only collected when the organiser turns
  it on for an event.
- Guest RSVP links are **bearer tokens** — anyone with a link can respond as that guest. Share
  them privately (1:1). This is a deliberate trade-off for a login-free experience.
- **Retention**: events and their guests are automatically deleted `PURGE_DAYS` (default 30)
  after the event date.
- App logs are **response-only** — no guest IPs or user-agents are logged by the app.
- **Never commit `.env` or `data.db`** — both are git-ignored. `data.db` contains guest PII.

---

## Backups & restore

- **Backup**: `sqlite3 data.db ".backup '/path/rsvp.bak'"` produces a consistent copy while the
  app runs. Copy it offsite.
- **Restore**: stop the service, replace `data.db` with the backup, start the service.

---

## Troubleshooting

- **`/admin` returns 401** — check `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` match your Access
  app, and that the Access application covers the `/admin` path.
- **Can't reach anything locally** — for dev, set `DEV_BYPASS_AUTH=true`; in prod you must go
  through the Cloudflare hostname, not `localhost`.
- **`better-sqlite3` build errors** — install `gcc-c++ make python3` (see Prerequisites).
- **No emails sent** — a blank `RESEND_API_KEY` disables email; the app logs what it *would*
  have sent instead.

---

## Project layout

```
src/            Express app: server, db, auth, routes, purge, seed
views/          EJS templates (admin, organizer, guest, request) + theme partials
public/         Compiled CSS, htmx, static assets
deploy/         systemd unit + Cloudflare tunnel notes
.env.example    All configuration keys (copy to .env)
```

## License

[MIT](LICENSE) © DarkWingD. Contributions welcome.
