// 全站頁面巡檢：把每一頁（前台 + 後台）用真實 Chrome 打開，連到正式的 Firebase，檢查
//   - 有沒有 JS 錯誤（含 import 的名稱不存在、SDK 版本混用等，這類錯誤會讓整頁失效）
//   - 公開資料有沒有真的讀出來（首頁精選商品、商品頁、栽培小知識、購物車運費）
//   - 寫入路徑是否正常：用訪客身分寫一筆規則一定會拒絕的資料，
//     預期得到 permission-denied（證明請求有送到伺服器、被規則擋下），
//     而不是程式錯誤。不會真的寫入任何資料。
//
// 用法：node tests/page-sweep.mjs [網站資料夾，預設是 repo 根目錄]
import puppeteer from 'puppeteer';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..'));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp' };
const server = http.createServer((q, s) => {
    let p = decodeURIComponent(q.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(s);
});
await new Promise((r) => server.listen(8097, r));
const BASE = 'http://localhost:8097/';

// 每頁「資料有讀出來」的判斷；沒列的頁面只檢查沒有錯誤、firebaseServices 有建立
const CHECKS = {
    'index.html': () => document.querySelectorAll('#featured-products-grid .product-card').length > 0,
    'products.html': () => document.querySelectorAll('#products-grid .product-card').length > 0,
    // 只有一篇文章時直接顯示那一篇
    'membership.html': () => document.querySelectorAll('#knowledge-article-view:not([hidden]) .knowledge-section').length > 0,
    'knowledge.html': () => document.querySelectorAll('#knowledge-grid a, #knowledge-grid .knowledge-card, #knowledge-grid article').length > 0,
    'cart.html': () => /NT\$|\$\s*\d|元/.test((document.querySelector('.cart-summary, #cart-summary, .summary') || document.body).textContent)
        && !/載入中|讀取中/.test((document.querySelector('#shipping-fee, .shipping-fee') || { textContent: '' }).textContent),
};
// 這些錯誤訊息是預期中的（例如未登入時被導回、沒有 favicon），不算失敗
const IGNORE = /favicon|Failed to load resource: the server responded with a status of 404|未登入|請先登入|not logged in|權限不足/i;

const pages = [...fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && !/^google|^TEST/i.test(f)),
    ...fs.readdirSync(path.join(ROOT, 'admin')).filter((f) => f.endsWith('.html')).map((f) => 'admin/' + f)];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-'));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: dir, args: ['--no-sandbox'] });
let failures = 0;
const sampleProduct = await (async () => {
    const r = await fetch('https://firestore.googleapis.com/v1/projects/bulb-market-217c4/databases/(default)/documents:runQuery?key=AIzaSyCGej6Feghnsz-J77NrVgFZVP-pPrlvsgU', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'products' }], where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'active' } } }, limit: 1 } }) });
    const [row] = await r.json();
    const f = row.document.fields;
    const num = (v) => Number(v.integerValue ?? v.doubleValue ?? 0);
    return { id: row.document.name.split('/').pop(), name: f.name.stringValue, price: num(f.price), quantity: 1, stock: num(f.stock || { integerValue: 5 }), category: f.category ? f.category.stringValue : 'bulbs' };
})();

for (const name of pages) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 160)));
    page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(m.text().slice(0, 160)); });
    page.on('requestfailed', (r) => { if (/gstatic|googleapis/.test(r.url()) && !/Listen\/channel|ERR_ABORTED/.test(r.url() + r.failure().errorText)) errors.push('request failed: ' + r.url().slice(0, 100) + ' ' + r.failure().errorText); });
    if (name === 'cart.html' || name === 'payment.html') {
        await page.evaluateOnNewDocument((item) => { localStorage.setItem('cart', JSON.stringify([item])); }, sampleProduct);
    }
    await page.goto(BASE + name, { waitUntil: 'domcontentloaded' });
    let dataOk = null;
    if (CHECKS[name]) {
        try { await page.waitForFunction(CHECKS[name], { timeout: 20000, polling: 100 }); dataOk = true; } catch (e) { dataOk = false; }
    }
    await new Promise((r) => setTimeout(r, 2500));
    const svc = await page.evaluate(() => {
        const s = window.firebaseServices;
        return s ? { db: !!s.db, lite: s.db && s.db.type === 'firestore-lite', getDocsFromServer: typeof s.getDocsFromServer } : null;
    });
    // 寫入測試本身會被規則拒絕，瀏覽器會印一行 403 的網路錯誤，那是預期中的，
    // 所以只看寫入測試「之前」的錯誤
    const loadErrors = errors.slice();
    // 寫入路徑：訪客寫 settings/sweepProbe，規則一定拒絕（不會真的寫入）
    const write = await page.evaluate(async () => {
        const s = window.firebaseServices;
        if (!s || !s.setDoc || !s.doc || !s.db) return 'skip';
        if (s.auth && s.auth.currentUser) return 'skip(已登入)';
        try { await s.setDoc(s.doc(s.db, 'settings', 'sweepProbe'), { probe: 1 }); return 'UNEXPECTED-SUCCESS'; }
        catch (e) { return (e.code || '') + (e.code === 'permission-denied' ? '' : ' ' + String(e.message).slice(0, 120)); }
    });
    const ok = loadErrors.length === 0 && dataOk !== false && svc && svc.db && svc.lite
        && (write === 'permission-denied' || write.startsWith('skip'));
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(24)} 資料:${dataOk === null ? '-' : dataOk ? '有' : '沒有'}  ` +
        `db:${svc ? (svc.lite ? 'Lite' : svc.db ? '完整版' : '無') : '無 firebaseServices'}  寫入測試:${write}` +
        (loadErrors.length ? '\n        ' + loadErrors.slice(0, 4).join('\n        ') : ''));
    await page.close();
}
await browser.close();
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
server.close();
console.log(`\n${pages.length - failures} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
