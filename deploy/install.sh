#!/usr/bin/env bash
# Установка Bali Villas CRM на чистый VPS (Ubuntu/Debian).
# Запуск от root:
#   bash deploy/install.sh crm.ваш-домен.ру ваша@почта.ру
set -euo pipefail

DOMAIN="${1:-}"
ADMIN_EMAIL="${2:-}"
APP_DIR=/opt/bali-crm
DATA_DIR=/var/lib/bali-crm
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say()  { echo -e "\n\033[1;36m==> $*\033[0m"; }
warn() { echo -e "\033[1;33m    $*\033[0m"; }
die()  { echo -e "\033[1;31mОшибка: $*\033[0m" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "запустите от root:  sudo bash deploy/install.sh crm.домен.ру почта@домен.ру"
[ -n "$DOMAIN" ] || die "укажите домен:  bash deploy/install.sh crm.ваш-домен.ру ваша@почта.ру"
[ -n "$ADMIN_EMAIL" ] || die "укажите свою почту — она станет логином владельца"

say "Проверяем Node.js"
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  MAJOR=$(node -p "process.versions.node.split('.')[0]")
  [ "$MAJOR" -ge 22 ] && NEED_NODE=0 || warn "установлен Node $MAJOR, нужен 22 или новее"
fi
if [ "$NEED_NODE" = "1" ]; then
  say "Ставим Node.js 24"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node --version

say "Создаём пользователя crm"
id -u crm >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin crm

say "Копируем приложение в $APP_DIR"
mkdir -p "$APP_DIR" "$DATA_DIR"
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  cp -r "$SRC_DIR"/. "$APP_DIR"/
fi
rm -rf "$APP_DIR/.git/hooks" 2>/dev/null || true
chown -R root:root "$APP_DIR"
chown -R crm:crm "$DATA_DIR"
chmod 750 "$DATA_DIR"

say "Заводим владельца системы"
PASSWORD=$(node -e "console.log(require('crypto').randomBytes(9).toString('base64url'))")
CRM_DATA_DIR="$DATA_DIR" node "$APP_DIR/server/cli.js" add "$ADMIN_EMAIL" --admin --password "$PASSWORD" \
  || warn "пользователь уже существует — пароль не менялся"
chown -R crm:crm "$DATA_DIR"

say "Настраиваем службу"
cp "$APP_DIR/deploy/bali-crm.service" /etc/systemd/system/bali-crm.service
systemctl daemon-reload
systemctl enable --now bali-crm
sleep 2
systemctl is-active --quiet bali-crm || { journalctl -u bali-crm -n 30 --no-pager; die "служба не запустилась"; }

say "Настраиваем nginx"
if ! command -v nginx >/dev/null 2>&1; then apt-get install -y nginx; fi
sed "s/crm\.ваш-домен\.ру/$DOMAIN/g" "$APP_DIR/deploy/nginx.conf.example" > /etc/nginx/sites-available/bali-crm
ln -sf /etc/nginx/sites-available/bali-crm /etc/nginx/sites-enabled/bali-crm
nginx -t && systemctl reload nginx

say "Получаем сертификат (https)"
if ! command -v certbot >/dev/null 2>&1; then apt-get install -y certbot python3-certbot-nginx; fi
if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$ADMIN_EMAIL" --redirect; then
  SCHEME=https
else
  warn "сертификат получить не удалось — проверьте, что домен $DOMAIN указывает на этот сервер (A-запись)"
  warn "потом повторите:  certbot --nginx -d $DOMAIN"
  SCHEME=http
fi

say "Резервные копии по расписанию"
chmod +x "$APP_DIR/deploy/backup.sh"
# база — каждую ночь (весит килобайты), полный архив с фотографиями — раз в неделю
# и только если на диске есть запас; существующие задания crontab сохраняются
( crontab -l 2>/dev/null | grep -v 'bali-crm/deploy/backup.sh' ; \
  echo "0 3 * * * $APP_DIR/deploy/backup.sh >> /var/log/bali-crm-backup.log 2>&1" ; \
  echo "30 3 * * 0 $APP_DIR/deploy/backup.sh --full >> /var/log/bali-crm-backup.log 2>&1" ) | crontab -

cat <<FINAL

────────────────────────────────────────────────
 Готово.

 Адрес:  $SCHEME://$DOMAIN
 Логин:  $ADMIN_EMAIL
 Пароль: $PASSWORD

 Запишите пароль — второй раз он не показывается.
 Сменить: cd $APP_DIR/server && sudo -u crm CRM_DATA_DIR=$DATA_DIR node cli.js password $ADMIN_EMAIL

 Сотрудников добавляйте прямо в приложении:
 «Настройки» → «Сотрудники» → «+ Добавить сотрудника».

 Данные:  $DATA_DIR      Копии: /var/backups/bali-crm
 Журнал:  journalctl -u bali-crm -f
 Обновление: sudo $APP_DIR/deploy/update.sh
────────────────────────────────────────────────
FINAL
