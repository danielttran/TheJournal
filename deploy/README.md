# Deploying TheJournal (web)

End-to-end runbook for putting the web build on a Linux VPS, fronted by
Caddy for automatic HTTPS. Tested target: Ubuntu 22.04 LTS / Debian 12.

For the Electron desktop build see [../README.md](../README.md).
For environment variables see [../docs/env-vars.md](../docs/env-vars.md).
For backups see [../docs/backup-runbook.md](../docs/backup-runbook.md).

## Prerequisites

- A Linux server with **root** or `sudo`.
- A domain name pointing at the server (A record).
- Open ports **80** + **443** to the public internet (for ACME challenges
  and inbound HTTPS).
- **Node.js 22+** (the SQLCipher native binding is built for the napi-v6
  ABI; older Node versions won't load it).
- **libssl1.1** — SQLCipher's prebuilt binary links against OpenSSL 1.1.
  Ubuntu 22.04 still ships it; on 24.04 / Debian 12 you need to install
  it manually (see [troubleshooting](#troubleshooting)).
- **Git**.

## Step 1 — Clone and build

```bash
sudo useradd --system --shell /bin/bash --home-dir /var/lib/thejournal --create-home thejournal
sudo -u thejournal -i

git clone https://github.com/danielttran/TheJournal.git /var/lib/thejournal/app
cd /var/lib/thejournal/app

npm ci
npm run build       # runs `next build` then stages static + plugins
```

After `npm run build` you should have `.next/standalone/server.js` plus
`.next/standalone/public/` and `.next/standalone/plugins/` staged
alongside.

Sanity check the bundle:

```bash
test -f .next/standalone/server.js && echo OK
ls .next/standalone/node_modules/@journeyapps/sqlcipher/lib/binding/
# expect a napi-v6-<platform>-<arch>/ folder with node_sqlite3.node
```

## Step 2 — Set required env vars

Persistent storage lives under `/var/lib/thejournal/data/` so the DB
survives `git pull`.

```bash
sudo mkdir -p /var/lib/thejournal/data /var/lib/thejournal/data/plugins
sudo chown -R thejournal:thejournal /var/lib/thejournal/data

# /etc/thejournal/env — 0640, owned root:thejournal so the unit can
# source it but nobody else reads the DB key.
sudo install -m 0640 -o root -g thejournal /dev/null /etc/thejournal/env
sudo tee /etc/thejournal/env > /dev/null <<EOF
NODE_ENV=production
PORT=3000
JOURNAL_DB_SECRET=$(openssl rand -hex 32)
JOURNAL_DB_PATH=/var/lib/thejournal/data/journal.tjdb
JOURNAL_PLUGINS_DIR=/var/lib/thejournal/data/plugins
EOF
```

> **Back up `/etc/thejournal/env` separately from the .tjdb file.** If
> you lose `JOURNAL_DB_SECRET`, the database is unrecoverable. See
> [backup-runbook.md](../docs/backup-runbook.md).

## Step 3 — Run under systemd

Drop this in `/etc/systemd/system/thejournal.service`:

```ini
[Unit]
Description=TheJournal web server
After=network.target

[Service]
Type=simple
User=thejournal
Group=thejournal
WorkingDirectory=/var/lib/thejournal/app/.next/standalone
EnvironmentFile=/etc/thejournal/env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/thejournal/data

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now thejournal
sudo systemctl status thejournal
curl -s http://127.0.0.1:3000/api/health    # expect {"status":"ok",...}
```

## Step 4 — Caddy in front (HTTPS)

```bash
sudo apt-get install -y caddy
sudo cp /var/lib/thejournal/app/deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo sed -i 's/example\.com/your.real.hostname/' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy will provision a Let's Encrypt cert on first request. Verify:

```bash
curl -s https://your.real.hostname/api/health
```

If the cert hasn't completed provisioning yet, Caddy serves a self-signed
one briefly; check `journalctl -u caddy -n 50`.

## Step 5 — First user

Visit `https://your.real.hostname/register`, create your account. The
register action seeds a "Daily Journal" + "Notebook" category for you
([../src/lib/defaultCategories.ts](../src/lib/defaultCategories.ts)).

## Upgrades

```bash
sudo -u thejournal -i
cd /var/lib/thejournal/app
git fetch && git checkout vX.Y.Z   # or `git pull` for main
npm ci
npm run build
exit
sudo systemctl restart thejournal
```

The DB file under `/var/lib/thejournal/data/` is untouched by `git pull`
because it lives outside the repo. Schema migrations run automatically
on next request (see `src/lib/db.ts`'s migration list).

## Troubleshooting

### "libssl.so.1.1: cannot open shared object file"

SQLCipher's prebuilt binary needs OpenSSL 1.1. On Ubuntu 24.04 /
Debian 12 (which ship OpenSSL 3 only) install the compat library:

```bash
# Ubuntu 24.04
wget http://security.ubuntu.com/ubuntu/pool/main/o/openssl/libssl1.1_1.1.1f-1ubuntu2.24_amd64.deb
sudo dpkg -i libssl1.1_1.1.1f-1ubuntu2.24_amd64.deb
```

(Equivalent .deb for your distro can be found on
<https://launchpad.net/ubuntu/+source/openssl>.)

### Plugins folder doesn't show installed plugins

The web build reads from `$JOURNAL_PLUGINS_DIR` (or `<cwd>/plugins` if
unset). After `npm run build`, the staging script copies `plugins/`
into `.next/standalone/plugins/` — but the systemd unit sets
`JOURNAL_PLUGINS_DIR=/var/lib/thejournal/data/plugins`, so that's
where the runtime looks.

If you want the bundled `sentence-diagrammer` plugin available on
first boot, copy it once:

```bash
sudo cp -r /var/lib/thejournal/app/plugins/sentence-diagrammer \
          /var/lib/thejournal/data/plugins/
sudo chown -R thejournal:thejournal /var/lib/thejournal/data/plugins
sudo systemctl restart thejournal
```

### Healthcheck reports `degraded` / `dbUnlocked: false`

The DB path is unreachable, the file is locked by another process, or
`JOURNAL_DB_SECRET` doesn't match the key the file was originally
written with. Tail the journal:

```bash
journalctl -u thejournal -f
```

### Caddy can't provision a certificate

ACME needs ports 80 + 443 open AND the hostname resolving to this
server. Test:

```bash
dig +short your.real.hostname
sudo ss -tlnp | grep -E ':(80|443) '
```

Common causes: AAAA record pointing at the wrong IPv6, Cloudflare in
"proxied" mode (must be "DNS only" while Caddy provisions, or use
Cloudflare's origin-CA flow instead).

## Updating to a new TheJournal version

See `docs/release.md` for the maintainer's release workflow. As an
operator, you only care about `git pull && npm ci && npm run build &&
systemctl restart thejournal`.

## Tearing down

```bash
sudo systemctl disable --now thejournal
sudo rm /etc/systemd/system/thejournal.service /etc/thejournal/env
# Back up first!
sudo cp /var/lib/thejournal/data/journal.tjdb /root/journal-final-$(date +%F).tjdb
sudo rm -rf /var/lib/thejournal
sudo userdel thejournal
```
