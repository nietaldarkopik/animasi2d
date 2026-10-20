#!/bin/sh
# Prepares the container. Only the php-fpm container touches the database schema and the caches.
set -e
cd /var/www/html

if [ "$1" = "php-fpm" ]; then
  # a volume mounted over storage/ is created root-owned
  chown -R www-data:www-data storage bootstrap/cache 2>/dev/null || true

  if [ -z "$APP_KEY" ]; then
    echo "APP_KEY is empty. Generate one with:  docker compose run --rm app php artisan key:generate --show" >&2
    exit 1
  fi

  if [ "${RUN_MIGRATIONS:-0}" = "1" ]; then
    echo "Running migrations..."
    php artisan migrate --force
  fi

  php artisan config:cache
  php artisan route:cache
  php artisan event:cache >/dev/null 2>&1 || true
fi

exec "$@"