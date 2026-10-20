# syntax=docker/dockerfile:1
# Build context: the repository root.   docker compose -f deploy/docker-compose.yml build

# ---- frontend (static files) -------------------------------------------------
FROM node:22-alpine AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- PHP dependencies ----------------------------------------------------------
FROM composer:2 AS vendor
WORKDIR /app
COPY backend/composer.json backend/composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction
COPY backend/ ./
RUN composer dump-autoload --no-dev --optimize --classmap-authoritative

# ---- application image: php-fpm + queue worker + scheduler (same image, different command) ----
FROM php:8.4-fpm-alpine AS app
# ffmpeg: exports; python3 + Pillow: image clean-up worker; the rest: PHP extensions (no Redis extension needed: predis)
RUN apk add --no-cache ffmpeg python3 py3-pillow libzip libpng libjpeg-turbo freetype libpq \
 && apk add --no-cache --virtual .build-deps $PHPIZE_DEPS libzip-dev libpng-dev libjpeg-turbo-dev freetype-dev postgresql-dev \
 && docker-php-ext-configure gd --with-freetype --with-jpeg \
 && docker-php-ext-install -j"$(nproc)" pdo_pgsql gd zip pcntl bcmath \
 && apk del .build-deps
COPY deploy/php/php.ini /usr/local/etc/php/conf.d/zz-studio.ini
WORKDIR /var/www/html
COPY --from=vendor /app ./
COPY worker /var/www/worker
COPY deploy/php/entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint \
 && mkdir -p storage/framework/cache storage/framework/sessions storage/framework/views storage/logs storage/app/private bootstrap/cache \
 && chown -R www-data:www-data storage bootstrap/cache
ENV PYTHON_BIN=python3 WORKER_DIR=/var/www/worker FFMPEG_BIN=ffmpeg FFPROBE_BIN=ffprobe
ENTRYPOINT ["entrypoint"]
CMD ["php-fpm"]

# ---- web: nginx serving the SPA and forwarding /api to php-fpm ------------------
FROM nginx:1.27-alpine AS web
COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend /src/frontend/dist /usr/share/nginx/html