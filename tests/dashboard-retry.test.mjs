// 後台儀表板：連線不穩時要顯示「讀取中／連線中」並持續重試，
// 不能停在預設值讓管理員以為資料是那樣，也不能卡著不動什麼都不說。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const html = fs.readFileSync(path.join(ROOT, 'admin/dashboard.html'), 'utf8').split('\r\n').join('\n');

const dom = new JSDOM('<!DOCTYPE html><html><head><meta charset="utf-8"></head>' + html.slice(html.indexOf('<body>')),
    { runScripts: 'outside-only', url: 'https://flowerbulb.tw/admin/dashboard.html' });
const { window } = dom;
const { document } = window;
window.console.warn = () => {};
window.console.error = () => {};
window.console.log = () => {};

// 前 8 次讀取失敗（4 個統計 + 1 個訂單，所以要夠多次才會輪到成功），之後成功
const FAIL_TIMES = 8;
let calls = 0;
const offline = () => { const e = new Error('Failed to get documents from server.'); e.code = 'unavailable'; throw e; };
const snap = (n) => ({ size: n, empty: n === 0, forEach() {}, docs: [] });

window.firebaseServices = {
    db: {}, collection: () => ({}), query: () => ({}), where: () => ({}),
    orderBy: () => ({}), limit: () => ({}), doc: () => ({}),
    getDocsFromServer: async () => { calls++; if (calls <= FAIL_TIMES) offline(); return snap(7); },
    getDoc: async () => offline(),
    auth: {}, onAuthStateChanged: () => {}
};
window.AdminCommon = {
    showToast() {}, showLoading() {}, hideLoading() {}, handleError() {},
    formatDate: () => '', isAdmin: async () => true, checkAdminAccess() {}, getCurrentUser: () => null
};

// 兩個載入函式宣告在 DOMContentLoaded 的 callback 裡，外面取不到，
// 在 callback 結尾插一行把它們掛到 window 上
const inline = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
const EXPORT = '\n    window.__fetchStatistics = fetchStatistics;\n    window.__fetchRecentOrders = fetchRecentOrders;\n});\n';
const patched = inline.replace(/\n\s*\}\);\s*$/, EXPORT);
assert.notStrictEqual(patched, inline, '沒有成功插入匯出，請檢查 script 結尾格式');
window.eval(patched);
window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

let pass = 0, fail = 0;
const t = (n, f) => {
    try { f(); pass++; console.log('  PASS  ' + n); }
    catch (e) { fail++; console.log('  FAIL  ' + n + '\n        ' + e.message); }
};
const STAT_IDS = ['pending-orders', 'completed-orders', 'total-users', 'total-products'];
const stats = () => STAT_IDS.map((i) => document.getElementById(i).textContent);
const orders = () => document.getElementById('recent-orders-list').textContent;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('後台儀表板：連線不穩時的行為');

// 「讀取中」是在第一個 await 之前同步設定的，所以要在這裡立刻檢查。
// 真實情況下這個狀態會停留整整 10 秒（Firestore 的逾時），
// 但假的 Firestore 是立刻 reject，等一下再看就已經變成重試中的訊息了
window.__fetchStatistics();
window.__fetchRecentOrders();

t('一開始同步顯示「讀取中」，不是停在預設值', () => {
    assert.deepStrictEqual(stats(), ['…', '…', '…', '…'], '實際: ' + stats().join(','));
    assert.ok(/載入訂單中/.test(orders()), '訂單區沒有顯示載入中: ' + orders().trim().slice(0, 40));
});

await wait(2500);

t('持續失敗時說明是連線問題，而且絕不顯示 0', () => {
    const v = stats();
    assert.ok(v.every((x) => x === '連線中…' || x === '--'), '實際: ' + v.join(','));
    assert.ok(!v.includes('0'), '不應該顯示 0（那會讓管理員以為資料不見了）');
    assert.ok(/自動重新連線/.test(orders()), '訂單區訊息不對: ' + orders().trim().slice(0, 40));
});

t('有持續重試，不是失敗一次就放棄', () => {
    assert.ok(calls >= 4, '只呼叫了 ' + calls + ' 次');
});

await wait(14000);

t('連線恢復後自動補上正確數字，管理員不用重新整理', () => {
    assert.deepStrictEqual(stats(), ['7', '7', '7', '7'],
        '實際: ' + stats().join(',') + '（共呼叫 ' + calls + ' 次）');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
