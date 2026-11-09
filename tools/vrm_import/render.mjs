#!/usr/bin/env node
/**
 * Renders a VRM avatar into standard-format 2D parts for the Character Builder library.
 *
 *   node render.mjs <model.vrm> <outDir> [--arm=72] [--only=front,left]
 *
 * Writes <outDir>/<view>-<slot>.png (800x1600, transparent) and <outDir>/manifest.json (what was drawn + the licence of the avatar).
 * `php artisan library:import-vrm <outDir>` registers the result in the library.
 *
 * NOTE: a VRM carries its own licence (meta). Converting an avatar into parts is a modification of it: only do that with an avatar
 * you made or may modify; the licence is copied into the manifest and every imported part.
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const here = path.dirname(fileURLToPath(import.meta.url))
const [, , modelArg, outArg, ...rest] = process.argv
if (!modelArg || !outArg) { console.error('usage: node render.mjs <model.vrm> <outDir> [--arm=72] [--only=front,left]'); process.exit(1) }
const opt = Object.fromEntries(rest.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')))
const model = path.resolve(modelArg), outDir = path.resolve(outArg)
fs.mkdirSync(outDir, { recursive: true })

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.vrm': 'model/gltf-binary' }
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0])
  const file = url === '/model.vrm' ? model : url === '/' ? path.join(here, 'viewer.html') : path.join(here, url)
  if (!file.startsWith(here) && file !== model) { res.writeHead(403); return res.end() }
  fs.readFile(file, (e, buf) => { if (e) { res.writeHead(404); return res.end() } res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' }); res.end(buf) })
}).listen(0)
const port = server.address().port

const BROWSERS = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe']
const browser = await puppeteer.launch({
  executablePath: BROWSERS.find((b) => fs.existsSync(b)), headless: 'new', protocolTimeout: 0,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.error('page error:', String(e).slice(0, 300)))
page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text().slice(0, 200)) })
await page.goto(`http://127.0.0.1:${port}/`)
await page.waitForFunction('window.VRMR_READY === true', { timeout: 60000 })
const info = await page.evaluate(() => window.VRMR.load('/model.vrm'))
console.log('avatar:', info.meta.name, '| licence:', info.meta.modification, '| slots:', JSON.stringify(info.slots))
await page.evaluate((arm) => window.VRMR.pose({ arm }), Number(opt.arm ?? 72))

const save = (name, dataUrl) => fs.writeFileSync(path.join(outDir, name), Buffer.from(dataUrl.split(',')[1], 'base64'))
const shot = (slots, view) => page.evaluate((s, v) => window.VRMR.render({ slots: s, view: v }), slots, view)
/**
 * The "mouth" mesh of a VRoid avatar is only the INSIDE of the mouth (teeth, tongue); the closed mouth is drawn on the skin. Alone it looks
 * like fangs. So a mouth part is the skin around the mouth WITH the inside, cut to a rectangle that holds every mouth shape: it is laid
 * over the face part and the rest of the face stays the face.
 */
let mouthRect = null
async function mouthShot(view) {
  return page.evaluate((v, r) => window.VRMR.render({ slots: ['face', 'mouth'], view: v, crop: r }), view, mouthRect)
}
async function measureMouth() {
  let u = null
  for (const e of ['aa', 'oh', 'happy', 'surprised', 'ee', 'ou']) {
    await page.evaluate((x) => window.VRMR.expression({ [x]: 1 }), e)
    await shot(['mouth'], 'front')
    const b = await page.evaluate(() => window.VRMR.bbox())
    if (b) u = u ? [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])] : b
  }
  const pad = 28 // pixels (14 canvas units) around the inside of the mouth: the lips and the corners
  mouthRect = u && [u[0] - pad, u[1] - pad, u[2] + pad, u[3] + pad]
}
const items = []
const views = (opt.only ?? 'front,right,left,back').split(',')
const has = (s) => (info.slots[s] ?? 0) > 0

// 1) the body parts, drawn from each direction (face features are not drawn from behind)
const PARTS = ['face', 'eyes', 'brows', 'mouth', 'hair_front', 'hair_back', 'torso', 'arm_l', 'arm_r', 'body', 'top', 'bottom', 'shoes']
await page.evaluate(() => window.VRMR.expression({ neutral: 1 })) // (the avatar's own resting face: closed mouth, no fangs)
if (has('mouth')) await measureMouth()
await page.evaluate(() => window.VRMR.expression({ neutral: 1 }))
for (const view of views) {
  for (const slot of PARTS) {
    if (!has(slot) || (view === 'back' && ['face', 'eyes', 'brows', 'mouth'].includes(slot))) continue
    const file = `${view}-${slot}.png`
    save(file, slot === 'mouth' && mouthRect ? await mouthShot(view) : await shot([slot], view))
    items.push({ slot, view, file, label: null })
  }
}

// 2) expressions of the face features (front view): eyes + brows + mouth for each expression, and the mouth shapes for lip-sync
if (views.includes('front')) {
  const MOUTH = { aa: 'A', ih: 'I', ou: 'U', ee: 'E', oh: 'O', happy: 'Senang', sad: 'Sedih', angry: 'Marah', surprised: 'Kaget', relaxed: 'Santai' }
  const EYES = { blink: 'Kedip', happy: 'Senang', sad: 'Sedih', angry: 'Marah', surprised: 'Kaget', relaxed: 'Santai' }
  const BROWS = { happy: 'Senang', sad: 'Sedih', angry: 'Marah', surprised: 'Kaget' }
  const names = new Set(info.expressions)
  for (const [slot, table] of [['mouth', MOUTH], ['eyes', EYES], ['brows', BROWS]]) {
    for (const [expr, label] of Object.entries(table)) {
      if (!names.has(expr) || !has(slot)) continue
      await page.evaluate((e) => window.VRMR.expression({ [e]: 1 }), expr)
      const file = `expr-${slot}-${expr}.png`
      save(file, slot === 'mouth' ? await mouthShot('front') : await shot([slot], 'front'))
      items.push({ slot, view: 'front', file, label })
    }
  }
}

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ source: path.basename(model), avatar: info.meta, rendered_at: new Date().toISOString(), arm_degrees: Number(opt.arm ?? 72), items }, null, 1))
console.log(`${items.length} gambar ditulis ke ${outDir}`)
await browser.close()
server.close()
