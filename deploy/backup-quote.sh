#!/bin/bash
# 每日备份 data/ 目录
# 安装: sudo cp deploy/backup-quote.sh /opt/backup-quote.sh && sudo chmod +x /opt/backup-quote.sh
# cron: 0 3 * * * /opt/backup-quote.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/agent-quote-platform}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/agent-quote-platform}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%F-%H%M)"
ARCHIVE="$BACKUP_DIR/data-$STAMP.tar.gz"

tar czf "$ARCHIVE" -C "$APP_DIR" data
find "$BACKUP_DIR" -name 'data-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

echo "Backup saved: $ARCHIVE"
