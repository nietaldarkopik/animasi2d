#!/usr/bin/env node
/**
 * Headless Automated Cartoon Runner for Cartoon Maker AI
 * Runs headless Chrome, rigs characters, records the video, and downloads the MP4.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer-core');

// Parse CLI args
const args = process.argv.slice(2);
let projectId = null;
let userId = 1;
let outputDir = path.resolve(__dirname, '../daily_output');

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--projectId' && args[i + 1]) projectId = parseInt(args[++i], 10);
  if (args[i] === '--userId' && args[i + 1]) userId = parseInt(args[++i], 10);
  if (args[i] === '--outputDir' && args[i + 1]) outputDir = path.resolve(args[++i]);
}

// Ensure output dir exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Detect Chrome or Edge executable
function findBrowserPath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('Chrome atau Edge tidak ditemukan di path standar Windows.');
}

// Generate API token via Laravel Artisan
function getAuthToken(uid) {
  const backendDir = path.resolve(__dirname, '../backend');
  try {
    const cmd = `php artisan tinker --execute="$u = App\\Models\\User::find(${uid}) ?? App\\Models\\User::first(); echo $u->createToken('headless-daily')->plainTextToken;"`;
    const token = execSync(cmd, { cwd: backendDir, encoding: 'utf-8' }).trim();
    return token;
  } catch (e) {
    throw new Error('Gagal membuat auth token: ' + e.message);
  }
}

async function main() {
  console.log('=== Headless Cartoon Exporter ===');
  const browserPath = findBrowserPath();
  console.log(`Menggunakan browser: ${browserPath}`);

  const token = getAuthToken(userId);
  console.log(`Token autentikasi berhasil dibuat untuk user ID: ${userId}`);

  // If no projectId was passed, generate a new daily cartoon project first
  if (!projectId) {
    console.log('Menghasilkan naskah dan audio kartun harian baru...');
    const res = await fetch('http://127.0.0.1:8000/api/cartoon/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      throw new Error(`Gagal generate kartun via API: HTTP ${res.status}`);
    }
    const data = await res.json();
    projectId = data.data.project_id;
    console.log(`Project berhasil dibuat: "${data.data.title}" (ID: ${projectId})`);
  }

  console.log(`Membuka project ID ${projectId} di headless Chrome...`);
  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--autoplay-policy=no-user-gesture-required',
      '--window-size=1366,768',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });

    // Pre-set token in localStorage
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
    await page.evaluate((tok) => {
      localStorage.setItem('cm_token', tok);
    }, token);

    // Open project in editor with auto_export=1
    console.log(`Menavigasi ke editor http://localhost:5173/projects/${projectId}?auto_export=1`);
    await page.goto(`http://localhost:5173/projects/${projectId}?auto_export=1`, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    console.log('Menunggu proses perekaman canvas dan encode FFmpeg selesai...');
    const result = await page.waitForFunction(
      () => {
        if (window.__EXPORT_DONE__) return { status: 'done', export: window.__EXPORT_DONE__ };
        if (window.__EXPORT_FAILED__) return { status: 'failed', error: window.__EXPORT_FAILED__ };
        return false;
      },
      { polling: 1000, timeout: 600000 } // up to 10 minutes timeout
    );

    const exportData = await result.jsonValue();
    if (exportData.status === 'failed') {
      throw new Error(`Export gagal: ${exportData.error}`);
    }

    const exportId = exportData.export.id;
    console.log(`Export selesai di server! Export ID: ${exportId}`);

    // Download the MP4 deliverable
    const dateStr = new Date().toISOString().slice(0, 10);
    const mp4FileName = `kartun_${dateStr}_project_${projectId}.mp4`;
    const targetFile = path.join(outputDir, mp4FileName);

    console.log(`Mengunduh video MP4 ke: ${targetFile}`);
    const downloadRes = await fetch(`http://127.0.0.1:8000/api/exports/${exportId}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!downloadRes.ok) {
      throw new Error(`Gagal mengunduh file video: HTTP ${downloadRes.status}`);
    }

    const arrayBuffer = await downloadRes.arrayBuffer();
    fs.writeFileSync(targetFile, Buffer.from(arrayBuffer));

    console.log(`\n========================================`);
    console.log(`🎉 SUKSES! Film kartun harian telah siap:`);
    console.log(`File: ${targetFile}`);
    console.log(`Ukuran: ${(fs.statSync(targetFile).size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`========================================\n`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('\n❌ ERROR:', err.message);
  process.exit(1);
});
