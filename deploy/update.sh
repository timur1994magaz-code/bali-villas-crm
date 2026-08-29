#!/usr/bin/env bash
# Обновление CRM до свежей версии из репозитория.
set -euo pipefail
APP_DIR="${CRM_APP_DIR:-/opt/bali-crm}"

echo "Резервная копия перед обновлением…"
"$APP_DIR/deploy/backup.sh" || echo "  (пропущено)"

echo "Забираем свежую версию…"
cd "$APP_DIR"
git pull --ff-only

echo "Перезапуск…"
systemctl restart bali-crm
sleep 2
systemctl is-active --quiet bali-crm && echo "Готово, сервис работает." || {
  echo "Сервис не поднялся. Журнал:"; journalctl -u bali-crm -n 30 --no-pager; exit 1;
}
