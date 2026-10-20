# Deployment — PostgreSQL + Redis

```
browser ──HTTPS──▶ (TLS proxy / load balancer) ──▶ nginx ──┬─ static SPA (frontend/dist)
                                                           └─ /api ─▶ php-fpm (Laravel) ──▶ PostgreSQL
                                                                         │                    ▲
                                                              enqueue ───┴──▶ Redis ◀── queue worker(s) ──▶ FFmpeg, Python/Pillow, AI gateway (9router)
                                          shared file volume (uploads, exports) ◀── app + worker(s) + scheduler
```

## What has actually been verified

| Item | Status |
|---|---|
| Full backend test suite on **PostgreSQL 17** (migrations + 34 tests) | ✅ passed |
| Queue + cache on **Redis** with the `predis` client (export through a real worker, queue drained) | ✅ passed (Redis 5.0 Windows build) |
| `deploy/nginx/default.conf` on a real **nginx 1.28** → FastCGI → Laravel, production frontend build, PostgreSQL + Redis: sign-up, 2 scenes, audio upload, film export (MP4 with AAC), reload | ✅ passed |
| `X-Forwarded-*` handling: signed asset URLs are `https://<public host>/…` with `TRUSTED_PROXIES`, wrong without it; tampered signature → 403 | ✅ passed |
| Security headers on `/`, deep links, `/assets/*`, `/up`; SPA fallback; `/api` without a token → 401 | ✅ passed |
| `docker-compose.yml` parses and its `<<` merges resolve; `entrypoint.sh` passes `sh -n` | ✅ checked |
| **Docker image build / `docker compose up`** | ❌ **not run** (Docker is not installed on the development machine) — treat the Dockerfile and Compose file as a reviewed starting point and expect to fix small things on first run |
| systemd units, `schedule:work` in a container, Redis 7, Postgres in a container | ❌ not run |
| TLS termination, load / soak tests, backups & restore drill | ❌ not done |
| S3 / object storage | ❌ **not supported** (see below) |

## Requirements

- PHP ≥ 8.3 with `pdo_pgsql`, `gd`, `zip`, `fileinfo`, `pcntl`, `bcmath` — **no Redis extension needed** (`predis` is used).
- PostgreSQL ≥ 14 (tested on 17), Redis ≥ 5 (7 recommended).
- **FFmpeg ≥ 4.4** (needs `amix=normalize=0`) and `ffprobe`.
- Python ≥ 3.9 with Pillow (`pip install -r worker/requirements.txt`).
- Node ≥ 20 only to build the frontend.
- Optional: [9router](http://localhost:20128) (OpenAI-compatible gateway) for the AI features.

## Option A — Docker Compose

```bash
cp deploy/.env.production.example deploy/.env
# edit deploy/.env: APP_URL, DB_PASSWORD, REDIS_PASSWORD, (AI_API_KEY)
# generate the application key and paste it into APP_KEY:
docker compose -f deploy/docker-compose.yml --env-file deploy/.env build
docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm --no-deps -e APP_KEY=x app php artisan key:generate --show
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d
curl -fsS http://localhost:8080/up
```

Services: `postgres`, `redis`, `app` (php-fpm; the only one that migrates), `worker` (queue), `scheduler`, `web` (nginx, port `WEB_PORT`).
Put HTTPS in front of `web` (Caddy, Traefik, a cloud load balancer) and set `APP_URL=https://…`; keep `TRUSTED_PROXIES=*` only if nothing but that proxy can reach `web`.

## Option B — bare metal / VM

```bash
# 1. code, dependencies, frontend
cd /var/www/cartoon-maker
(cd backend && composer install --no-dev --optimize-autoloader)
(cd frontend && npm ci && npm run build)
pip install -r worker/requirements.txt

# 2. configuration
cp deploy/.env.production.example backend/.env      # then adapt: DB_HOST=127.0.0.1, REDIS_HOST=127.0.0.1, PYTHON_BIN=python3, WORKER_DIR=/var/www/cartoon-maker/worker …
cd backend && php artisan key:generate && php artisan migrate --force
php artisan config:cache && php artisan route:cache
chown -R www-data:www-data storage bootstrap/cache

# 3. web + background processes
sudo cp deploy/nginx/bare-metal.conf /etc/nginx/sites-available/cartoon-maker    # then enable it, add TLS
sudo cp deploy/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now cartoon-maker-worker cartoon-maker-scheduler
```

PHP-FPM limits for exports (a browser recording is uploaded in one request): `upload_max_filesize=520M`, `post_max_size=530M`, `memory_limit=512M`, `max_execution_time=300` (see `deploy/php/php.ini`) and nginx `client_max_body_size 530m`.

## Configuration reference (`backend/.env`)

| Key | Purpose |
|---|---|
| `APP_ENV=production`, `APP_DEBUG=false`, `APP_KEY`, `APP_URL` | basics; `APP_URL` with `https://` makes generated links https |
| `TRUSTED_PROXIES` | `*` or comma-separated IP/CIDR of your reverse proxy (required behind a proxy, otherwise signed asset URLs break) |
| `DB_CONNECTION=pgsql`, `DB_HOST/PORT/DATABASE/USERNAME/PASSWORD` | PostgreSQL |
| `QUEUE_CONNECTION=redis`, `CACHE_STORE=redis`, `REDIS_CLIENT=predis`, `REDIS_HOST/PORT/PASSWORD` | Redis |
| `FFMPEG_BIN`, `FFPROBE_BIN`, `PYTHON_BIN`, `WORKER_DIR` | external tools |
| `SANCTUM_EXPIRATION` | login token lifetime in minutes (default 43200 = 30 days) |
| `CORS_ALLOWED_ORIGINS` | only needed when the SPA is served from a different origin than the API |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_TIMEOUT` | AI gateway; empty key disables AI features cleanly |

The AI key lives only in the server environment; the browser never sees it and `/api/ai/status` only reports `configured: true/false`.

## Files and storage

All uploads and exports are written with Laravel's **`local` disk** under `storage/app/private`. FFmpeg and the Pillow worker need real file paths, so **S3-compatible storage is not supported yet** (it would need download-to-temp steps in the export and image jobs). Consequences:
- every process that touches files (php-fpm **and** every queue worker) must see the **same directory** — one Docker volume, or a shared/NFS mount;
- back it up together with the database (they reference each other).

Housekeeping (`php artisan schedule:work` or a cron `schedule:run`): `studio:prune` removes exports older than 7 days (files + rows) and AI job rows older than 30 days; expired API tokens are pruned daily. The raw browser recording is deleted as soon as an export succeeds.

## Backup and restore

```bash
pg_dump -Fc -h HOST -U USER cartoon_maker > backup-$(date +%F).dump
tar czf files-$(date +%F).tgz -C /var/www/cartoon-maker/backend/storage/app private      # or the Docker volume
# restore
pg_restore -c -d cartoon_maker backup.dump && tar xzf files.tgz -C /var/www/cartoon-maker/backend/storage/app
```

## Updating

```bash
git pull   # or deploy the new build
composer install --no-dev -o && php artisan migrate --force && php artisan config:cache && php artisan route:cache
(cd ../frontend && npm ci && npm run build)
sudo systemctl restart cartoon-maker-worker      # workers keep the old code in memory until restarted
```
Rolling back code is safe as long as no destructive migration ran; every migration in this repository is additive.

## Security checklist

- [ ] `APP_DEBUG=false`, strong `APP_KEY`, unique DB/Redis passwords; Redis **not** exposed publicly.
- [ ] HTTPS everywhere; `APP_URL=https://…`; `TRUSTED_PROXIES` limited to your proxy.
- [ ] Only ports 80/443 published; PostgreSQL, Redis, php-fpm (9000) on a private network.
- [ ] `.env` readable only by the service user; never baked into an image.
- [ ] The AI gateway is reachable only from the app/worker (a gateway on the Docker host must not listen on a public interface).
- [ ] Sign-up is open by default (throttled). On a private instance set `REGISTRATION_ENABLED=false` (the UI hides the form; the API answers 403).
- [ ] Monitor `/up`, the queue length (`redis-cli llen queues:default`), disk usage of the files volume, and failed exports (`export_jobs.status = 'failed'`).

## Known limits

- One worker process handles one export at a time (an export can take as long as the film itself plus encoding); run more workers for parallelism.
- The export is recorded in the *browser*; the tab must stay open while it records (the progress bar shows it).
- No multi-user collaboration; projects are private to the account that created them.
