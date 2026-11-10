---
name: clipwize
description: Use ClipWize (the user's clipper-tool, online at https://existcode.excoder.site/api) from scripts. Covers text-to-speech narration (TTS 9router on the server), importing a finished MP4 as a clip, publishing or scheduling it to a connected social account such as YouTube "Ternyata Begini", checking post status, analytics, trending topics, research channels, ideas and content briefs. Use whenever a task needs narration audio, a YouTube or social upload through ClipWize, or ClipWize data, including the daily "Ternyata Begini" video production task.
---

# ClipWize API skill

All calls go through `scripts/clipwize.py`, a single CLI that uses only the Python standard library. The full API reference is in `C:\wamp64\www\clipper-tool\docs\api-integration-guide.md` (sections 8 and 9; base URLs in section 2; local operation in `docs/penggunaan-lokal.md`). Do not invent endpoints.

## Base URL and automatic fallback (guide section 2)
- The public domain `https://existcode.excoder.site/api` runs on the owner's own PC behind DNS + a reverse proxy/tunnel, so it can be offline while the PC is on.
- The local address `http://localhost:8000/api` (or `http://<LAN-IP>:8000/api` from another device) is the **same backend and database**, so **the same token works**; only the base URL changes. Plain HTTP.
- The CLI tries, in order: the base that last worked (remembered in `~/.clipwize_base`), then the public domain, then `http://localhost:8000/api`, then `CLIPWIZE_LAN_BASE` if set. It prints `[clipwize] ... tidak terjangkau; mencoba alamat lain...` to stderr when it switches.
- Override: `--base <url>` (one address, no fallback) or env `CLIPWIZE_BASE` (same), or `CLIPWIZE_BASES="url1,url2"` (custom order). Add a LAN address with `CLIPWIZE_LAN_BASE=http://192.168.x.y:8000/api`.
- `python clipwize.py ping` checks every address without a token (`HTTP 401 (API hidup)` = API is up).
- Fallback safety (no idempotency keys): GET requests may switch address on any connection-level error. **Non-GET (tts, import, publish) only switch when the connection could not be opened at all** (DNS failure, refused, proxy tunnel failure, or a 502/503/504 from the gateway with no application response), meaning the request was certainly not delivered. A timeout or a dropped connection in the middle of a POST stops with "Status TIDAK diketahui": then check `posts` / `post <id>` and never re-run `publish` blindly.
- Signed media URLs follow the address that was called; `download()` fetches local URLs without the proxy.
- Not possible without the public domain: connecting *new* social accounts (OAuth) and TikTok login. Publishing through already-connected accounts (such as "Ternyata Begini") works on the local address.
- **From Claude's device_bash VM:** the VM's `localhost` is not the user's PC, and the egress proxy refuses localhost/private addresses (HTTP 403), so the local fallback only works when the CLI runs **natively on the user's PC** (or from a LAN device). If both the domain and the fallback are unreachable from the VM, stop, keep the finished files, write a `_siap_unggah.txt` marker in the production folder, and notify the user. They can upload with the same commands on their PC, where `localhost:8000` works.

## Credentials (read carefully)
- Auth is a Sanctum bearer token. The CLI reads it from a token file in this order: `CLIPWIZE_TOKEN_FILE`, then `C:\Videos\FaktaUnik\.clipwize_token` (Windows) / `$HOME/mnt/FaktaUnik/.clipwize_token` (device_bash VM), then `~/.clipwize_token`.
- **Claude never logs in, never types or reads a password, and never opens, prints or copies the token file or any user/password file.** The token is created by the **user** once, interactively, on their PC:
  `python clipwize.py login --email <their email>` (asks for the password with a hidden prompt and saves the token).
- If any command says "Token belum ada" or returns HTTP 401, stop and ask the user to run `login`. Never work around this.
- Revoke the token with `python clipwize.py logout`.

## Commands
| Command | What it does | Risk |
|---|---|---|
| `ping` | Checks which base URL answers (no token needed) | read |
| `me`, `accounts` | Shows the user and the social accounts (id, platform, name, status) | read |
| `tts <text_file|text> <out.wav|out.mp3> [--voice]` | `POST /tts`, which uses the server's TTS (9router; the voice is set by the server). Downloads the result. A `.wav` output is converted with ffmpeg (24 kHz mono). Retries once. | costly (AI credits, 20/min) |
| `import <video.mp4> --meta metadata.json` | `POST /clips/import`. Registers a finished video as a completed clip using the title, description and tags from metadata.json. **Does not publish.** Prints `clip_id`. | disk |
| `publish <clip_id> --account N --expect-account "Ternyata Begini" --yes [--scheduled-at ISO+07:00]` | `POST /social-posts`. First checks that account N exists, is connected and has the expected name. Publishes now (or schedules), then polls until published or failed and prints `post_url` and the platform id. | **PUBLIC, irreversible** |
| `post <id> [--wait S]`, `posts [--status] [--account N] [--per-page N]` | Shows post status (newest first; `--account 10` = only "Ternyata Begini"); YouTube `video_id` is derived from `post_url` | read |
| `analytics [--days]`, `trending`, `channels`, `ideas [--channel]` | Analytics and research data | read |
| `brief "<topic>"` | AI research brief, polled until done | costly |
| `sign <paths…>` | Gets fresh signed media URLs | read |
| `raw GET /path` | Any other documented endpoint. Non-GET requires `--yes`. | depends |

## Rules
- Only publish when the task or user explicitly asks for it, and only after the video passes QC. Never retry `publish` blindly: there are no idempotency keys, so a second call creates a second post. If the status is unclear, run `posts` or `post <id>` first.
- Before publishing, run `posts --account 10 --per-page 50` to check what was already uploaded today (the daily task forbids two videos from the same field on the same date and allows at most 5 per day).
- Do not log signed URLs or the token. Do not call `tts` in unbounded loops.
- In the device_bash VM, HTTPS goes through the proxy automatically (urllib reads `HTTPS_PROXY`). `existcode.excoder.site` must be on the allowed-domains list.

## Daily "Ternyata Begini" flow
```
python clipwize.py ping                                      # which base URL is up (domain or localhost:8000)
python clipwize.py accounts                                  # confirm the id of "Ternyata Begini" (it is 10)
for each scene: python clipwize.py tts audio/scene_NN.txt audio/scene_NN.wav
... sync + mux + QC (ffprobe) ...
python clipwize.py import video.mp4 --meta metadata.json     # -> clip_id
python clipwize.py publish <clip_id> --account <id> --expect-account "Ternyata Begini" --yes
```
Record `post_url` and the post or video id in `hasil.md`. If any step fails, write down the error message (without secrets) and do not publish.
