// 冷開比較：同一頁的幾個版本，輪流用「全新瀏覽器 + 全新 profile」（= 重開瀏覽器第一次進站）
// 打開，並用 CDP 模擬較慢的網路，量：
//   - SDK 開始下載的時間（看 modulepreload 有沒有效）
//   - 第一個 Firestore 請求的時間
//   - 畫面就緒（首頁精選商品／商品頁商品卡片出現）的時間
//   - 有沒有卡到 Firestore 的 10 秒逾時、有沒有「preload 了卻沒用到」的警告、SDK 有沒有被重複下載
//
// 用法（各版本是一個資料夾，例如用 git worktree 拉出 main 來比）：
//   git worktree add ../bm-main origin/main
//   node tests/coldstart-compare.mjs index.html 8 main=../bm-main branch=.
//   LAT=0 node tests/coldstart-compare.mjs ...      # 不模擬慢網路
//
// 注意：
// - 不模擬慢網路時（LAT=0）幾乎不會卡住；模擬 150ms 延遲時才重現得出來，所以預設 150。
// - 每次取樣差異很大，至少各跑 8 次以上，並交錯執行（這支已經是交錯的）再下結論。
import puppeteer from 'puppeteer';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [PAGE = 'index.html', NARG = '8', ...SITE_ARGS] = process.argv.slice(2);
const N = Number(NARG);
const SITES = Object.fromEntries(SITE_ARGS.map((s) => {
    const [name, dir] = s.split('=');
    return [name, path.resolve(dir)];
}));
const KEYS = Object.keys(SITES);
if (KEYS.length === 0) {
    console.log('用法: node tests/coldstart-compare.mjs <頁面> <次數> 名稱=資料夾 [名稱=資料夾 ...]');
    process.exit(1);
}
const LATENCY = Number(process.env.LAT ?? 150);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp' };

let root = SITES[KEYS[0]];
const server = http.createServer((q, s) => {
    let p = decodeURIComponent(q.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(s);
});
await new Promise((r) => server.listen(8098, r));

const READY = {
    'index.html': () => document.querySelector('#featured-products-grid .product-card'),
    'products.html': () => document.querySelector('#products-grid .product-card'),
};
const readyFn = READY[PAGE] || (() => window.firebaseServices && window.firebaseServices.db);

async function trial() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-'));
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: dir,
        args: ['--no-sandbox', '--disable-dev-shm-usage', ...(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(' ') : [])] });
    const page = await browser.newPage();
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    if (LATENCY > 0) {
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: LATENCY,
            downloadThroughput: 10 * 1024 * 1024 / 8, uploadThroughput: 5 * 1024 * 1024 / 8 });
    }
    const warnings = [];
    let stalled = false;
    page.on('console', (m) => {
        const t = m.text();
        if (/preload/i.test(t)) warnings.push(t.slice(0, 120));
        if (/Could not reach Cloud Firestore backend/.test(t)) stalled = true;
    });
    page.on('pageerror', (e) => warnings.push('pageerror: ' + String(e.message).slice(0, 120)));
    const sdkHits = {};
    let t0 = 0, sdkStart = 0, fsFirst = 0;
    cdp.on('Network.requestWillBeSent', (e) => {
        if (!t0 && e.type === 'Document') t0 = e.timestamp;
        const u = e.request.url;
        if (/firebasejs\/[\d.]+\/firebase-firestore(-lite)?\.js/.test(u) && !sdkStart) sdkStart = e.timestamp;
        if (/firestore\.googleapis\.com/.test(u) && !fsFirst) fsFirst = e.timestamp;
        const m = u.match(/firebasejs\/[\d.]+\/(firebase-[a-z-]+\.js)$/);
        if (m) sdkHits[m[1]] = (sdkHits[m[1]] || 0) + 1;
    });
    const start = Date.now();
    await page.goto('http://localhost:8098/' + PAGE, { waitUntil: 'domcontentloaded' });
    let ready = -1;
    try {
        await page.waitForFunction(readyFn, { timeout: 60000, polling: 50 });
        ready = Date.now() - start;
    } catch (e) { /* 60 秒內沒出現 */ }
    await new Promise((r) => setTimeout(r, 1500)); // 讓「preload 未使用」警告有時間出現
    await browser.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
    const ms = (t) => (t ? Math.round((t - t0) * 1000) : -1);
    const dup = Object.entries(sdkHits).filter(([, n]) => n > 1).map(([k, n]) => `${k}×${n}`);
    return { sdk: ms(sdkStart), fs: ms(fsFirst), ready, stalled, warnings, dup };
}

const median = (a) => {
    const s = a.filter((x) => x >= 0).sort((x, y) => x - y);
    return s.length ? s[Math.floor(s.length / 2)] : -1;
};
const rows = Object.fromEntries(KEYS.map((k) => [k, []]));
for (let i = 1; i <= N; i++) {
    for (const k of KEYS) { // 交錯執行，避免網路狀況隨時間變化造成偏差
        root = SITES[k];
        const r = await trial();
        rows[k].push(r);
        console.log(`${k} #${i}  SDK開始下載 ${String(r.sdk).padStart(5)}ms  第一個Firestore請求 ${String(r.fs).padStart(5)}ms` +
            `  畫面就緒 ${r.ready < 0 ? '  >60秒' : String(r.ready).padStart(6) + 'ms'}${r.stalled ? '  ⚠️10秒逾時' : ''}` +
            (r.dup.length ? '  重複下載:' + r.dup.join(',') : '') + (r.warnings.length ? '  警告:' + r.warnings.join(' | ') : ''));
    }
}
console.log(`\n【${PAGE}】模擬延遲 ${LATENCY}ms，各 ${N} 次`);
for (const k of KEYS) {
    const r = rows[k];
    const stalls = r.filter((x) => x.stalled);
    console.log(`  ${k}: 卡住 ${stalls.length}/${N}，畫面就緒中位數 ${median(r.map((x) => x.ready))}ms` +
        (stalls.length ? `，卡住那幾次的就緒時間 ${stalls.map((x) => (x.ready < 0 ? '>60s' : (x.ready / 1000).toFixed(1) + 's')).join(' / ')}` : '') +
        `，SDK開始下載中位數 ${median(r.map((x) => x.sdk))}ms`);
}
server.close();
