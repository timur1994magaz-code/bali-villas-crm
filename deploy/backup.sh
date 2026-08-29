#!/usr/bin/env bash
# Резервная копия CRM.
#
#   backup.sh          — только база: маленькая копия, годится хоть каждую ночь
#   backup.sh --full   — база вместе с фотографиями и документами
#
# База — это все виллы, брони, клиенты и описания файлов. Она весит килобайты,
# поэтому ночная копия ничего не стоит. Полный архив тяжёлый: он нужен реже,
# и скрипт не станет его делать, если на диске не останется запаса.
set -euo pipefail

DATA_DIR="${CRM_DATA_DIR:-/var/lib/bali-crm}"
DEST="${CRM_BACKUP_DIR:-/var/backups/bali-crm}"
KEEP_DB="${CRM_BACKUP_KEEP_DB:-14}"
KEEP_FULL="${CRM_BACKUP_KEEP_FULL:-2}"
MODE="${1:-db}"
STAMP=$(date +%Y-%m-%d_%H%M)

mkdir -p "$DEST"
[ -f "$DATA_DIR/crm.db" ] || { echo "База не найдена: $DATA_DIR/crm.db"; exit 1; }

# --- копия базы: через механизм SQLite, чтобы не поймать её на середине записи ---
DB_COPY="$DEST/crm-$STAMP.db"
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DATA_DIR/crm.db" ".backup '$DB_COPY'"
else
  node -e "
    const {DatabaseSync}=require('node:sqlite');
    new DatabaseSync(process.argv[1]).exec(\"vacuum into '\"+process.argv[2]+\"'\");
  " "$DATA_DIR/crm.db" "$DB_COPY"
fi
gzip -f "$DB_COPY"
echo "$(date '+%F %T') база: $DB_COPY.gz ($(du -h "$DB_COPY.gz" | cut -f1))"
ls -1t "$DEST"/crm-*.db.gz 2>/dev/null | tail -n +$((KEEP_DB + 1)) | xargs -r rm -f

[ "$MODE" = "--full" ] || exit 0

# --- полный архив: только если на диске остаётся запас ---
FILES_KB=$(du -sk "$DATA_DIR/files" "$DATA_DIR/thumbs" 2>/dev/null | awk '{s+=$1} END {print s+0}')
FREE_KB=$(df -Pk "$DEST" | tail -1 | awk '{print $4}')
NEED_KB=$(( FILES_KB * 12 / 10 ))          # запас 20%: архив плюс место на распаковку
if [ "$FREE_KB" -lt "$NEED_KB" ]; then
  echo "Полный архив пропущен: нужно ~$((NEED_KB/1024)) МБ, свободно $((FREE_KB/1024)) МБ."
  echo "Скачайте копию к себе (в приложении «Настройки» → «Бэкап в ZIP») или подключите отдельный диск."
  exit 0
fi

ARCHIVE="$DEST/bali-crm-full-$STAMP.tar.gz"
tar czf "$ARCHIVE" -C "$DEST" "$(basename "$DB_COPY.gz")" -C "$DATA_DIR" files thumbs
echo "$(date '+%F %T') полный архив: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
ls -1t "$DEST"/bali-crm-full-*.tar.gz 2>/dev/null | tail -n +$((KEEP_FULL + 1)) | xargs -r rm -f
