// 後台儀表板在 Firestore 連線卡住時的行為。
//
// 關鍵背景：Firestore 一旦進入離線模式，之後每次讀取都「立刻」失敗——
// 重試再多次都沒用，因為用的還是同一個壞掉的連線。要換一個全新的連線物件才會恢復。
// 後台原本完全沒有這個機制，所以會永遠停在那裡，管理員只能自己重新整理。
//
// 兩個情境分開測：
//   A. 重建連線有效 → 應該自動恢復，不用重新整理
//   B. 連線一直壞著 → 應該持續顯示「連線中」並重試，而且絕不顯示 0
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const html = fs.readFileSync(path.join(ROOT, 'admin/dashboard.html'), 'utf8').split('\r\n').join('\n');
const adminCommon = fs.readFileSync(path.join(ROOT, 'js/admin-common.js'), 'utf8').split('\r\n').join('\n');

const STAT_IDS = ['pending-orders', 'completed-orders', 'total-users', 'total-products'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// rebuildFixesIt: 重建連線之後讀取是否會恢復
function launch(rebuildFixesIt) {
    const dom = new JSDOM('<!DOCTYPE html><html><head><meta charset="utf-8"></head>' + html.slice(html.indexOf('<body>')),
        { runScripts: 'outside-only', url: 'https://flowerbulb.tw/admin/dashboard.html' });
    const { window } = dom;
    const { document } = window;
    window.console.warn = () => {};
    window.console.error = () => {};
    window.console.log = () => {};

    const state = { calls: 0, resets: 0, alive: false };
    const offline = () => { const e = new Error('Failed to get documents from server.'); e.code = 'unavailable'; throw e; };
    const snap = (n) => ({ size: n, empty: n === 0, forEach() {}, docs: [] });

    window.firebaseServices = {
        db: {}, collection: () => ({}), query: () => ({}), where: () => ({}),
        orderBy: () => ({}), limit: () => ({}), doc: () => ({}),
        getDocsFromServer: async () => { state.calls++; if (!state.alive) offline(); return snap(7); },
        getDoc: async () => offline(),
        auth: {}, onAuthStateChanged: () => {}
    };
    // 「什麼時候重建」用 admin-common.js 裡真正的政策程式碼，不要自己另寫一份假的——
    // 以前這裡只假造了 resetFirestoreConnection，儀表板改呼叫 maybeResetFirestoreConnection
    // 之後，這支測試就悄悄變成「從來不重建」，情境 A 跟著壞掉
    window.__fakeReset = async () => {
        state.resets++;
        if (rebuildFixesIt) state.alive = true;
        return rebuildFixesIt;
    };
    const policyStart = adminCommon.indexOf('// ---- 什麼時候才該重建連線 ----');
    const policyFnStart = adminCommon.indexOf('async function maybeResetFirestoreConnection()', policyStart);
    const policyEnd = adminCommon.indexOf('\n}\n', policyFnStart) + 2;
    assert.ok(policyStart > 0 && policyFnStart > 0 && policyEnd > policyFnStart, '在 admin-common.js 找不到重建政策');
    window.eval('const resetFirestoreConnection = window.__fakeReset;\n' + adminCommon.slice(policyStart, policyEnd) +
        '\nwindow.__policy = { maybeResetFirestoreConnection, noteFirestoreSuccess };');

    window.AdminCommon = {
        showToast() {}, showLoading() {}, hideLoading() {}, handleError() {},
        formatDate: () => '', isAdmin: async () => true, checkAdminAccess() {}, getCurrentUser: () => null,
        resetFirestoreConnection: window.__fakeReset,
        maybeResetFirestoreConnection: window.__policy.maybeResetFirestoreConnection,
        noteFirestoreSuccess: window.__policy.noteFirestoreSuccess
    };

    // 兩個載入函式宣告在 DOMContentLoaded 的 callback 裡，外面取不到，
    // 在 callback 結尾插一行把它們掛到 window 上
    const inline = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
    const EXPORT = '\n    window.__fetchStatistics = fetchStatistics;\n    window.__fetchRecentOrders = fetchRecentOrders;\n});\n';
    const patched = inline.replace(/\n\s*\}\);\s*$/, EXPORT);
    assert.notStrictEqual(patched, inline, '沒有成功插入匯出，請檢查 script 結尾格式');
    window.eval(patched);
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

    return {
        state,
        stats: () => STAT_IDS.map((i) => document.getElementById(i).textContent),
        orders: () => document.getElementById('recent-orders-list').textContent,
        start: () => { window.__fetchStatistics(); window.__fetchRecentOrders(); }
    };
}

let pass = 0, fail = 0;
const t = (n, f) => {
    try { f(); pass++; console.log('  PASS  ' + n); }
    catch (e) { fail++; console.log('  FAIL  ' + n + '\n        ' + e.message); }
};

console.log('情境 A：重建連線之後可以恢復');
{
    const a = launch(true);
    a.start();

    // 「讀取中」是在第一個 await 之前同步設定的，所以要在這裡立刻檢查。
    // 真實情況下它會停留整整 10 秒（Firestore 的逾時），但假的 Firestore 立刻 reject
    t('一開始同步顯示「讀取中」，不是停在預設值', () => {
        assert.deepStrictEqual(a.stats(), ['…', '…', '…', '…'], '實際: ' + a.stats().join(','));
        assert.ok(/載入訂單中/.test(a.orders()), '訂單區沒有載入提示: ' + a.orders().trim().slice(0, 40));
    });

    await wait(4000);

    t('失敗後有重建 Firestore 連線（否則永遠卡在離線狀態）', () => {
        assert.ok(a.state.resets >= 1, '一次都沒重建 → 會跟原本一樣永遠恢復不了');
    });
    t('重建後自動補上正確數字，管理員不用重新整理', () => {
        assert.deepStrictEqual(a.stats(), ['7', '7', '7', '7'],
            '實際: ' + a.stats().join(',') + `（呼叫 ${a.state.calls} 次，重建 ${a.state.resets} 次）`);
        assert.ok(!/自動重新連線|載入訂單中/.test(a.orders()), '訂單區還停在載入訊息');
    });
}

console.log('\n情境 B：連線一直壞著（最糟情況）');
{
    const b = launch(false);
    b.start();
    await wait(4000);

    t('持續顯示連線問題，而且絕不顯示 0', () => {
        const v = b.stats();
        assert.ok(v.every((x) => x === '連線中…' || x === '--'), '實際: ' + v.join(','));
        assert.ok(!v.includes('0'), '不應該顯示 0（那會讓管理員以為資料不見了）');
        assert.ok(/自動重新連線/.test(b.orders()), '訂單區訊息不對: ' + b.orders().trim().slice(0, 40));
    });
    t('持續重試，不是失敗一次就放棄', () => {
        assert.ok(b.state.calls >= 4, '只呼叫了 ' + b.state.calls + ' 次');
    });
    t('重建有節流，不會每次失敗都重建', () => {
        assert.ok(b.state.resets <= 2, '重建了 ' + b.state.resets + ' 次，節流沒生效');
    });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
