#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ClipWize API CLI (stdlib only). Docs: clipper-tool/docs/api-integration-guide.md

Token: read from a file (default: CLIPWIZE_TOKEN_FILE env, else ~/.clipwize_token,
else C:\\Videos\\FaktaUnik\\.clipwize_token / $HOME/mnt/FaktaUnik/.clipwize_token).
The token is never printed. Create it once yourself with:  python clipwize.py login --email you@x
"""
import argparse, getpass, json, mimetypes, os, socket, sys, time, uuid, urllib.request, urllib.error

# Base URL (docs §2): domain publik, dengan cadangan alamat lokal/LAN. Backend & database sama, jadi
# token yang sama berlaku di semua alamat. Urutan dicoba: --base / CLIPWIZE_BASE (satu alamat, tanpa cadangan),
# atau CLIPWIZE_BASES (dipisah koma), atau default di bawah. Tambah alamat LAN lewat CLIPWIZE_LAN_BASE,
# mis. http://192.168.1.20:8000/api.
PUBLIC_BASE = "https://existcode.excoder.site/api"
LOCAL_BASE = "http://localhost:8000/api"
def _bases():
    one = os.environ.get("CLIPWIZE_BASE")
    if one: return [one.rstrip("/")]
    many = os.environ.get("CLIPWIZE_BASES")
    if many: return [b.strip().rstrip("/") for b in many.split(",") if b.strip()]
    b = [PUBLIC_BASE, LOCAL_BASE]
    if os.environ.get("CLIPWIZE_LAN_BASE"): b.append(os.environ["CLIPWIZE_LAN_BASE"].rstrip("/"))
    return b
BASES = _bases()
BASE = BASES[0]          # alamat yang terakhir berhasil dipakai (diperbarui otomatis)
STATE_FILE = os.path.join(os.path.expanduser("~"), ".clipwize_base")   # ingat alamat yang terakhir berhasil (bukan rahasia)
TOKEN_CANDIDATES = [os.environ.get("CLIPWIZE_TOKEN_FILE"),
                    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".clipwize_token"),
                    r"C:\wamp64\www\animasi2d\.clipwize_token",
                    r"C:\wamp64\www\FaktaUnik\.clipwize_token",
                    r"C:\Videos\FaktaUnik\.clipwize_token" if os.name == "nt" else None,
                    os.path.expanduser("~/mnt/FaktaUnik/.clipwize_token"), os.path.expanduser("~/.clipwize_token")]

def token_path(for_write=False):
    for p in TOKEN_CANDIDATES:
        if p and (os.path.isfile(p) or (for_write and os.path.isdir(os.path.dirname(p)))):
            return p
    sys.exit("Token belum ada. Jalankan sendiri: python clipwize.py login --email <email>")

def token():
    return open(token_path(), encoding="utf-8").read().strip()

class Unreachable(Exception):
    """Koneksi gagal dibuat (DNS/tunnel/proxy/port tertutup): permintaan belum sampai ke aplikasi."""

# Gateway/proxy di depan domain (bukan aplikasi Laravel) -> anggap domain mati.
GATEWAY_CODES = (502, 503, 504, 521, 522, 523, 530)

def _is_connect_error(err):
    r = getattr(err, "reason", err)
    txt = str(r)
    if isinstance(r, (ConnectionRefusedError, ConnectionResetError)): return True
    if isinstance(r, socket.gaierror): return True
    return any(k in txt for k in ("Tunnel connection failed", "Name or service not known", "getaddrinfo failed",
                                  "No route to host", "Network is unreachable", "Connection refused", "nodename nor servname"))

def _ordered_bases():
    order = list(BASES)
    try:
        last = open(STATE_FILE, encoding="utf-8").read().strip()
        if last in order: order.remove(last); order.insert(0, last)
    except Exception: pass
    return order

def _remember(b):
    global BASE
    BASE = b
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f: f.write(b)
    except Exception: pass

def req(method, path, body=None, files=None, auth=True, timeout=600):
    """Kirim permintaan; bila alamat tidak terjangkau, coba alamat berikutnya.
    Aturan keamanan (tanpa idempotensi, docs §3): GET boleh pindah alamat untuk galat apa pun di tingkat koneksi.
    Non-GET hanya pindah alamat bila koneksi GAGAL DIBUKA (permintaan pasti belum terkirim) atau gateway
    menjawab 502/503/504 tanpa respons aplikasi. Timeout/putus di tengah POST -> berhenti, jangan diulang."""
    errors = []
    if method == "GET" and timeout == 600: timeout = 45     # GET cepat; jangan menunggu lama di alamat yang mati
    for b in _ordered_bases():
        try:
            res = _req_once(b, method, path, body, files, auth, timeout)
            _remember(b); return res
        except Unreachable as e:
            errors.append("%s: %s" % (b, e))
            print("[clipwize] %s tidak terjangkau (%s); mencoba alamat lain..." % (b, e), file=sys.stderr)
    sys.exit("Semua alamat ClipWize tidak terjangkau:\n  " + "\n  ".join(errors) +
             "\nPeriksa: domain/tunnel hidup? Laravel (php artisan serve, port 8000) hidup? Dari mesin lain gunakan CLIPWIZE_LAN_BASE.")

def _req_once(base, method, path, body=None, files=None, auth=True, timeout=600):
    url = base + path
    headers = {"Accept": "application/json"}
    data = None
    if files is not None:
        boundary = uuid.uuid4().hex
        parts = []
        for k, v in (body or {}).items():
            for item in (v if isinstance(v, list) else [v]):
                name = k + "[]" if isinstance(v, list) else k
                parts.append(("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n%s\r\n" % (boundary, name, item)).encode())
        for k, fp in files.items():
            ct = mimetypes.guess_type(fp)[0] or "application/octet-stream"
            parts.append(("--%s\r\nContent-Disposition: form-data; name=\"%s\"; filename=\"%s\"\r\nContent-Type: %s\r\n\r\n"
                          % (boundary, k, os.path.basename(fp), ct)).encode() + open(fp, "rb").read() + b"\r\n")
        parts.append(("--%s--\r\n" % boundary).encode())
        data = b"".join(parts); headers["Content-Type"] = "multipart/form-data; boundary=" + boundary
    elif body is not None:
        data = json.dumps(body).encode(); headers["Content-Type"] = "application/json"
    if auth:
        headers["Authorization"] = "Bearer " + token()
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    is_local = base.startswith("http://localhost") or base.startswith("http://127.") or "://192.168." in base or "://10." in base
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({})) if is_local else urllib.request.build_opener()
    try:
        with opener.open(r, timeout=timeout) as resp:
            raw = resp.read(); return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read()
        ctype = (e.headers.get("Content-Type") or "") if e.headers else ""
        if e.code in GATEWAY_CODES and "application/json" not in ctype:
            raise Unreachable("HTTP %s dari gateway/proxy" % e.code)
        try: j = json.loads(raw); msg = j.get("message", "")
        except Exception: msg = raw[:300].decode("utf-8", "replace")
        sys.exit("HTTP %s %s %s: %s" % (e.code, method, path, msg))
    except urllib.error.URLError as e:
        if method == "GET" or _is_connect_error(e):
            raise Unreachable(str(getattr(e, "reason", e))[:160])
        sys.exit("Koneksi terputus saat %s %s (%s). Status TIDAK diketahui: jangan ulangi; cek dulu dengan 'posts'/'post <id>'." % (method, path, e))
    except (socket.timeout, TimeoutError) as e:
        if method == "GET": raise Unreachable("timeout")
        sys.exit("Timeout saat %s %s. Status TIDAK diketahui: jangan ulangi; cek dulu dengan 'posts'/'post <id>'." % (method, path))

def out(x): print(json.dumps(x, ensure_ascii=False, indent=1))

def download(url, dest):
    local = url.startswith("http://localhost") or url.startswith("http://127.") or "://192.168." in url or "://10." in url
    op = urllib.request.build_opener(urllib.request.ProxyHandler({})) if local else urllib.request.build_opener()
    with op.open(url, timeout=300) as r, open(dest, "wb") as f: f.write(r.read())

# ---------- commands ----------
def c_login(a):
    if not sys.stdin.isatty():
        sys.exit("login harus dijalankan manusia secara interaktif (password tidak boleh diberikan lewat skrip).")
    pw = getpass.getpass("Password ClipWize untuk %s: " % a.email)
    _, j = req("POST", "/auth/login", {"email": a.email, "password": pw}, auth=False)
    p = a.token_file or token_path(for_write=True)
    with open(p, "w", encoding="utf-8") as f: f.write(j["token"])
    print("Token disimpan di", p, "(jangan dibagikan; cabut dengan: clipwize.py logout)")

def c_logout(a): req("POST", "/auth/logout"); os.remove(token_path()); print("Token dicabut dan dihapus.")
def c_me(a): out(req("GET", "/auth/me")[1]["data"])

def c_ping(a):
    """Cek setiap alamat (tanpa token): 401 di /auth/me = API hidup."""
    for b in BASES:
        try:
            st, _ = _req_once(b, "GET", "/auth/me", auth=False, timeout=15); res = "HTTP %s" % st
        except Unreachable as e: res = "TIDAK TERJANGKAU (%s)" % e
        except SystemExit as e: res = str(e).split(":")[0].replace("HTTP 401 GET /auth/me", "HTTP 401 (API hidup)")
        print("%-40s %s" % (b, res))

def c_accounts(a):
    for s in req("GET", "/social-accounts")[1]["data"]:
        print("%-5s %-10s %-30s status=%s token=%s" % (s["id"], s["platform"], s["account_name"], s["status"], s.get("token_status")))

def c_tts(a):
    """Satu file teks -> MP3 (dan WAV bila ffmpeg ada)."""
    text = open(a.text_file, encoding="utf-8").read().strip() if os.path.isfile(a.text_file) else a.text_file
    body = {"text": text}
    if a.voice: body["voice"] = a.voice
    last = None
    for attempt in (1, 2):
        try:
            _, j = req("POST", "/tts", body, timeout=180); break
        except SystemExit as e:
            last = e; print("TTS gagal (percobaan %d): %s" % (attempt, e), file=sys.stderr); time.sleep(5)
    else:
        sys.exit(1)
    d = j["data"]; dest = a.output
    mp3 = dest if dest.lower().endswith(".mp3") else os.path.splitext(dest)[0] + ".mp3"
    download(d["url"], mp3)
    if not dest.lower().endswith(".mp3"):
        import subprocess
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", mp3, "-ar", "24000", "-ac", "1", dest], check=True)
    print(json.dumps({"output": dest, "duration_seconds": d.get("duration_seconds"), "characters": d.get("characters")}))

def c_import(a):
    meta = json.load(open(a.meta, encoding="utf-8")) if a.meta else {}
    body = {"title": a.title or meta.get("title")}
    cap = a.caption or meta.get("description")
    if cap: body["caption"] = cap
    tags = meta.get("tags") or []
    if tags: body["hashtags"] = tags[:30]
    if a.project_id: body["project_id"] = a.project_id
    _, j = req("POST", "/clips/import", body, files={"file": a.video}, timeout=1800)
    d = j["data"]; print(json.dumps({"clip_id": d["id"], "status": d["status"], "aspect_ratio": d.get("aspect_ratio"), "duration": d.get("duration")}))

def check_account(acc_id, expect):
    accs = {s["id"]: s for s in req("GET", "/social-accounts")[1]["data"]}
    s = accs.get(acc_id)
    if not s: sys.exit("Akun %s tidak ditemukan untuk user ini." % acc_id)
    if expect and expect.lower() not in (s["account_name"] or "").lower():
        sys.exit("Akun %s bernama '%s', bukan '%s'. Dibatalkan." % (acc_id, s["account_name"], expect))
    if s["status"] != "connected": sys.exit("Akun %s status=%s, tidak terhubung." % (acc_id, s["status"]))
    return s

def poll_post(pid, timeout_s):
    t = time.time()
    while True:
        p = req("GET", "/social-posts/%s" % pid)[1]["data"]
        if p["status"] in ("published", "failed", "cancelled") or time.time() - t > timeout_s: return p
        time.sleep(10)

def summarize(p):
    keys = ("id", "status", "platform", "post_url", "platform_post_id", "external_id", "error_message", "published_at")
    d = {k: p.get(k) for k in keys if k in p}
    u = p.get("post_url") or ""
    if "youtube.com/shorts/" in u: d["video_id"] = u.rsplit("/", 1)[-1].split("?")[0]
    return d

def c_publish(a):
    """PUBLIK & tidak bisa dibatalkan. Wajib --yes."""
    if not a.yes: sys.exit("Publikasi bersifat publik. Tambahkan --yes untuk konfirmasi.")
    s = check_account(a.account, a.expect_account)
    body = {"clip_id": a.clip_id, "social_account_ids": [a.account]}
    if a.scheduled_at: body["scheduled_at"] = a.scheduled_at
    _, j = req("POST", "/social-posts", body)
    posts = j["data"] if isinstance(j.get("data"), list) else [j.get("data")]
    print("Akun:", s["account_name"], "| post dibuat:", [p["id"] for p in posts])
    if a.scheduled_at: out([summarize(p) for p in posts]); return
    out([summarize(poll_post(p["id"], a.wait)) for p in posts])

def c_post(a): out(summarize(poll_post(a.post_id, a.wait)) if a.wait else summarize(req("GET", "/social-posts/%s" % a.post_id)[1]["data"]))

def c_posts(a):
    q = "?per_page=%d&sort_by=created_at&sort_dir=desc" % a.per_page + ("&status=" + a.status if a.status else "") + \
        ("&social_account_id=%d" % a.account if a.account else "")
    for p in req("GET", "/social-posts" + q)[1]["data"]:
        print(json.dumps({**summarize(p), "title": (p.get("clip") or {}).get("title"), "account": (p.get("social_account") or {}).get("account_name"),
                          "created_at": p.get("created_at")}, ensure_ascii=False))

def c_analytics(a): out(req("GET", "/analytics?days=%d" % a.days)[1])
def c_trending(a): out(req("GET", "/trending")[1])
def c_channels(a): out(req("GET", "/content-channels")[1])
def c_ideas(a): out(req("GET", "/content-ideas?per_page=%d" % a.per_page + ("&content_channel_id=%s" % a.channel if a.channel else ""))[1])
def c_brief(a):
    _, j = req("POST", "/content-briefs", {"topic": a.topic}); bid = j["data"]["id"]; t = time.time()
    while True:
        d = req("GET", "/content-briefs/%s" % bid)[1]["data"]
        if d["status"] in ("completed", "failed", "cancelled") or time.time() - t > a.wait: out(d); return
        time.sleep(10)
def c_sign(a): out(req("POST", "/media/sign", {"paths": a.paths})[1])
def c_raw(a):
    if a.method.upper() != "GET" and not a.yes: sys.exit("Non-GET butuh --yes.")
    out(req(a.method.upper(), a.path, json.loads(a.json) if a.json else None)[1])

def main():
    ap = argparse.ArgumentParser(description="ClipWize API CLI")
    ap.add_argument("--base", help="paksa satu base URL, mis. http://localhost:8000/api (tanpa cadangan)")
    sp = ap.add_subparsers(dest="cmd", required=True)
    sp.add_parser("ping", help="cek alamat mana yang hidup").set_defaults(f=c_ping)
    p = sp.add_parser("login", help="(manusia saja) login interaktif & simpan token"); p.add_argument("--email", required=True); p.add_argument("--token-file"); p.set_defaults(f=c_login)
    sp.add_parser("logout").set_defaults(f=c_logout); sp.add_parser("me").set_defaults(f=c_me); sp.add_parser("accounts").set_defaults(f=c_accounts)
    p = sp.add_parser("tts", help="teks -> audio"); p.add_argument("text_file"); p.add_argument("output"); p.add_argument("--voice"); p.set_defaults(f=c_tts)
    p = sp.add_parser("import", help="daftarkan video jadi clip (tidak mempublikasi)"); p.add_argument("video"); p.add_argument("--meta"); p.add_argument("--title"); p.add_argument("--caption"); p.add_argument("--project-id", type=int); p.set_defaults(f=c_import)
    p = sp.add_parser("publish", help="PUBLIK: buat social post"); p.add_argument("clip_id", type=int); p.add_argument("--account", type=int, required=True)
    p.add_argument("--expect-account", help="nama akun yang harus cocok, mis. 'Ternyata Begini'"); p.add_argument("--scheduled-at"); p.add_argument("--wait", type=int, default=900); p.add_argument("--yes", action="store_true"); p.set_defaults(f=c_publish)
    p = sp.add_parser("post"); p.add_argument("post_id", type=int); p.add_argument("--wait", type=int, default=0); p.set_defaults(f=c_post)
    p = sp.add_parser("posts"); p.add_argument("--status"); p.add_argument("--account", type=int, help="filter social_account_id"); p.add_argument("--per-page", type=int, default=25); p.set_defaults(f=c_posts)
    p = sp.add_parser("analytics"); p.add_argument("--days", type=int, default=30); p.set_defaults(f=c_analytics)
    sp.add_parser("trending").set_defaults(f=c_trending); sp.add_parser("channels").set_defaults(f=c_channels)
    p = sp.add_parser("ideas"); p.add_argument("--channel"); p.add_argument("--per-page", type=int, default=20); p.set_defaults(f=c_ideas)
    p = sp.add_parser("brief", help="riset brief (biaya AI)"); p.add_argument("topic"); p.add_argument("--wait", type=int, default=600); p.set_defaults(f=c_brief)
    p = sp.add_parser("sign"); p.add_argument("paths", nargs="+"); p.set_defaults(f=c_sign)
    p = sp.add_parser("raw", help="panggil endpoint lain dari dokumentasi"); p.add_argument("method"); p.add_argument("path"); p.add_argument("--json"); p.add_argument("--yes", action="store_true"); p.set_defaults(f=c_raw)
    a = ap.parse_args()
    if a.base:
        global BASES, BASE
        BASES = [a.base.rstrip("/")]; BASE = BASES[0]
    a.f(a)

if __name__ == "__main__":
    main()
