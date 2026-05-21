# Backup runbook

The `.tjdb` file is a SQLCipher (AES-256) encrypted SQLite database. It
contains everything: entries, attachments, reminders, settings.
Restoring is "drop the file back in place"; backing up needs a tiny bit
of care because of WAL mode.

> **Two things you cannot recover without:**
> 1. The `.tjdb` file itself.
> 2. The `JOURNAL_DB_SECRET` env var that decrypts it (see
>    [env-vars.md](./env-vars.md)).
>
> Back them up to different places. If you put both in the same bucket
> with the same key, a stolen bucket = stolen journal.

## What to copy

TheJournal runs SQLite in WAL mode, so a live database has three files
next to it:

```
journal.tjdb
journal.tjdb-wal     # write-ahead log
journal.tjdb-shm     # shared-memory index for the WAL
```

You have two safe options:

### Option A — checkpoint, then copy one file

The recommended path. Forces SQLite to fold the WAL back into the main
file so you only have to copy `journal.tjdb`.

```bash
# Using sqlcipher CLI (must match the key the app uses):
sqlcipher journal.tjdb <<SQL
PRAGMA key = "x'$JOURNAL_DB_SECRET'";
PRAGMA wal_checkpoint(TRUNCATE);
.exit
SQL
cp journal.tjdb /your/backup/path/journal-$(date +%F).tjdb
```

After `wal_checkpoint(TRUNCATE)` the `-wal` and `-shm` files are
zero-length and safe to ignore.

### Option B — copy all three files

Less surgery, but you MUST copy them as a snapshot — either by stopping
the app first, or by `cp` in quick succession (acceptable for nightly
backups where you tolerate ≤1s of in-flight writes being missed; the
app's autosave re-fires).

```bash
systemctl stop thejournal     # if running under systemd
cp journal.tjdb     /backup/journal-$(date +%F).tjdb
cp journal.tjdb-wal /backup/journal-$(date +%F).tjdb-wal
cp journal.tjdb-shm /backup/journal-$(date +%F).tjdb-shm
systemctl start thejournal
```

## Off-host destinations

Pick one. All assume you've checkpointed first (Option A).

### rsync to a peer

```bash
rsync -av --delete \
  /var/lib/thejournal/journal.tjdb \
  user@backup-host:/srv/backups/thejournal/
```

Add `--bwlimit=10m` if your link is small.

### Amazon S3

```bash
aws s3 cp \
  /var/lib/thejournal/journal.tjdb \
  s3://my-bucket/thejournal/journal-$(date +%F).tjdb \
  --storage-class STANDARD_IA
```

Enable bucket versioning so accidental overwrites don't bin your
backup history.

### Backblaze B2 / S3-compatible via rclone

```bash
rclone copy \
  /var/lib/thejournal/journal.tjdb \
  b2:my-bucket/thejournal/ \
  --b2-versions
```

## Nightly cron snippet

```cron
# Run at 03:15 local time. Adjust path / destination.
15 3 * * * /usr/local/bin/thejournal-backup.sh >> /var/log/thejournal-backup.log 2>&1
```

`/usr/local/bin/thejournal-backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

DB=/var/lib/thejournal/journal.tjdb
DEST=/backups/thejournal
KEEP_DAYS=7

# Checkpoint into the main file.
sqlcipher "$DB" <<SQL
PRAGMA key = "x'${JOURNAL_DB_SECRET}'";
PRAGMA wal_checkpoint(TRUNCATE);
.exit
SQL

# Atomic copy: write to .tmp, rename — readers never see a half-file.
mkdir -p "$DEST"
cp "$DB" "$DEST/journal-$(date +%F).tjdb.tmp"
mv "$DEST/journal-$(date +%F).tjdb.tmp" "$DEST/journal-$(date +%F).tjdb"

# Retention: delete anything older than KEEP_DAYS.
find "$DEST" -name 'journal-*.tjdb' -mtime "+$KEEP_DAYS" -delete
```

Source the secret from a file the script can read but no other user
can: `chmod 0400 /etc/thejournal/secret.env` containing
`export JOURNAL_DB_SECRET=...`, then `source /etc/thejournal/secret.env`
at the top of the script.

## Restoring

1. Stop the running server.
2. Drop the backup `.tjdb` in place of the live file.
3. Ensure `JOURNAL_DB_SECRET` in the runtime env matches the secret
   the backup was encrypted with.
4. Start the server. SQLite will rebuild the `-wal` and `-shm` files
   from scratch.

```bash
systemctl stop thejournal
cp /backups/thejournal/journal-2026-01-15.tjdb /var/lib/thejournal/journal.tjdb
rm -f /var/lib/thejournal/journal.tjdb-wal /var/lib/thejournal/journal.tjdb-shm
systemctl start thejournal
curl http://localhost:3000/api/health   # expect status:ok, dbUnlocked:true
```

## What the built-in auto-backup does (Electron)

The Electron build can write a copy of the live DB to a folder you
pick in **Settings → Backup Location**, with **Settings → Backup
Frequency** controlling how many days between snapshots and
**Settings → Retention Policy** controlling how many to keep. See
`src/electron/main.js` `performAutoBackup()` for the exact logic.

The web build doesn't run a cron equivalent — wire up the script
above instead.

## Sanity test your backup

Once a quarter:

1. `cp` your latest backup to a scratch machine.
2. Start TheJournal there with the same `JOURNAL_DB_SECRET`.
3. Log in and confirm you can read a recent entry.

A backup you've never restored is a hope, not a backup.
