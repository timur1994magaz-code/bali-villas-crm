#!/usr/bin/env bash
# Резервная копия CRM: база и все файлы. Хранит 14 последних копий.
# Установка ежедневного запуска в 3 часа ночи:
#   sudo crontab -e
#   0 3 * * * /opt/bali-crm/deploy/backup.sh >> /var/log/bali-crm-backup.log 2>&1
set -euo pipefail

DATA_DIR="${CRM_DATA_DIR:-/var/lib/bali-crm}"
DEST="${CRM_BACKUP_DIR:-/var/backups/bali-crm}"
KEEP="${CRM_BACKUP_KEEP:-14}"
STAMP=$(date +%Y-%m-%d_%H%M)

mkdir -p "$DEST"

# база копируется средствами SQLite — так копия остаётся целостной,
# даже если в этот момент кто-то сохраняет бронь
if command -v sqlite3 >/dev/null 2>&1 && [ -f "$DATA_DIR/crm.db" ]; then
  sqlite3 "$DATA_DIR/crm.db" ".backup '$DEST/crm-$STAMP.db'"
  tar czf "$DEST/bali-crm-$STAMP.tar.gz" -C "$DEST" "crm-$STAMP.db" -C "$DATA_DIR" files thumbs
  rm -f "$DEST/crm-$STAMP.db"
else
  tar czf "$DEST/bali-crm-$STAMP.tar.gz" -C "$DATA_DIR" .
fi

echo "$(date '+%F %T') копия готова: $DEST/bali-crm-$STAMP.tar.gz ($(du -h "$DEST/bali-crm-$STAMP.tar.gz" | cut -f1))"

# чистим старые
ls -1t "$DEST"/bali-crm-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
