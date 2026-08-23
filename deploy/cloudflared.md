# Cloudflare Tunnel + Access setup

This exposes the app at `rsvp.example.com` with **no open ports** on your network, gives you
automatic HTTPS, and puts Cloudflare's protections in front. Replace `rsvp.example.com` with
your subdomain and `3000` with your `PORT`.

## 1. Install cloudflared (Fedora)

```bash
sudo dnf install -y cloudflared    # or download from the Cloudflare releases page
cloudflared --version
```

## 2. Create the tunnel

```bash
cloudflared tunnel login                 # opens a browser to authorise your domain
cloudflared tunnel create rsvp           # creates the tunnel + credentials file
cloudflared tunnel route dns rsvp rsvp.example.com
```

## 3. Configure the tunnel

Create `/etc/cloudflared/config.yml`:

```yaml
tunnel: rsvp
credentials-file: /root/.cloudflared/<TUNNEL-UUID>.json

ingress:
  - hostname: rsvp.example.com
    service: http://localhost:3000
  - service: http_status:404
```

## 4. Run it as a service

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

## 5. Cloudflare Access (organiser/admin login)

In the Zero Trust dashboard → **Access → Applications → Add an application → Self-hosted**:

- **Application domain:** `rsvp.example.com`
- Add **two paths** so only the management areas are gated:
  - `rsvp.example.com/admin`
  - `rsvp.example.com/organizer`
  - Leave `/` and `/r/*` **public** (guests must not be asked to log in).
- **Identity / login method:** enable **One-time PIN**.
- **Policy:** Action **Allow**. For a private tool you can Allow *everyone* (the app then
  authorises by email), or restrict to specific emails/domains.
- After saving, open the application's settings and copy:
  - the **Application Audience (AUD) tag** → `CF_ACCESS_AUD` in `.env`
  - your **team domain** (e.g. `https://yourteam.cloudflareaccess.com`) → `CF_ACCESS_TEAM_DOMAIN`

> The app **verifies** the Access JWT on every `/admin` and `/organizer` request, so nobody on
> your LAN can bypass Cloudflare by hitting `localhost` directly.

## 6. Edge protection (recommended, free)

- **Turnstile:** create a widget, put the site/secret keys in `.env`.
- **Bot Fight Mode** + **Managed WAF:** turn on in the dashboard.
- **Rate limiting:** add one rule targeting `POST /organizer/request` and `POST /r/*`.

## 7. Timers (purge + backup)

Create systemd timers (or cron entries) on the host:

```bash
# nightly purge of expired events
/usr/bin/node /opt/rsvp/app/src/purge.js

# nightly consistent backup, copied offsite
sqlite3 /opt/rsvp/app/data.db ".backup '/tmp/rsvp.bak'"
rclone copy /tmp/rsvp.bak remote:rsvp-backups     # or: scp /tmp/rsvp.bak user@host:/backups/
```
