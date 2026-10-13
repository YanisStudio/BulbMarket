// 後台運費設定的兩個存檔問題：
//   1. 新增階梯時運費欄位空白，parseInt 得到 NaN，原本的檢查（fee === undefined）擋不住，
//      NaN 被存進資料庫，購物車／結帳頁的運費就顯示成「NT$ NaN」
//   2. 儲存其中一種配送方式的固定運費時，原本整份覆蓋 fixedRates 文件。頁面載入運費設定
//      失敗時，記憶體裡另一種是預設的 0，存超商運費就會把宅配運費改成 0 元
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function launch({ failLoad }) {
    const html = read('admin/shipping.html');
    const body = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' + html.slice(html.indexOf('<body>'));
    const dom = new JSDOM(body, { runScripts: 'outside-only', url: 'https://flowerbulb.tw/admin/shipping.html' });
    const { window } = dom;
    window.console.log = () => {};
    window.console.error = () => {};
    const writes = [];
    const toasts = [];
    const offline = () => { const e = new Error('offline'); e.code = 'unavailable'; throw e; };
    window.firebaseServices = {
        db: {}, auth: { currentUser: { uid: 'admin' } },
        doc: (db, col, id) => ({ col, id }), collection: (db, name) => ({ name }),
        serverTimestamp: () => 'TS',
        getDoc: async () => (failLoad ? offline() : { exists: () => false }),
        getDocsFromServer: async () => (failLoad ? offline() : { forEach() {} }),
        setDoc: async (ref, data, options) => { writes.push({ op: 'set', ref, data, options }); },
        addDoc: async (ref, data) => { writes.push({ op: 'add', ref, data }); return { id: 'new' }; },
        deleteDoc: async () => {},
    };
    window.AdminCommon = {
        checkAdminAccess: (ok) => ok({ uid: 'admin' }),
        showToast: (m, type) => toasts.push({ m, type }),
        showLoading() {}, hideLoading() {}, handleError() {},
        showConfirmDialog: async () => true,
    };
    const inline = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
    window.eval(inline[1]);
    // jsdom 會在建構後自己觸發一次 DOMContentLoaded（readyState 還是 loading 時），
    // 這時再手動 dispatch 一次，頁面就會初始化兩次（事件綁兩次、按一下寫兩筆）
    if (window.document.readyState !== 'loading') window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    return { window, document: window.document, writes, toasts };
}

let pass = 0, fail = 0;
async function t(name, fn) {
    try { await fn(); pass++; console.log('  PASS  ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}

await t('新增階梯時運費空白：擋下來，不寫入資料庫', async () => {
    const page = launch({ failLoad: false });
    await wait(100);
    const $ = (id) => page.document.getElementById(id);
    $('store-tier-category').value = 'bulbs';
    $('store-tier-min').value = '1';
    $('store-tier-max').value = '10';
    $('store-tier-fee').value = '';
    page.document.querySelector('.add-tier[data-method="store"]').click();
    await wait(50);
    assert.strictEqual(page.writes.filter((w) => w.op === 'add').length, 0,
        '寫入了：' + JSON.stringify(page.writes.map((w) => w.data)));
});

await t('新增階梯時運費填 0（免運）是合法的，照常寫入', async () => {
    const page = launch({ failLoad: false });
    await wait(100);
    const $ = (id) => page.document.getElementById(id);
    $('store-tier-category').value = 'bulbs';
    $('store-tier-min').value = '1';
    $('store-tier-max').value = '10';
    $('store-tier-fee').value = '0';
    page.document.querySelector('.add-tier[data-method="store"]').click();
    await wait(50);
    const added = page.writes.filter((w) => w.op === 'add');
    assert.strictEqual(added.length, 1, '沒有寫入');
    assert.strictEqual(added[0].data.fee, 0);
});

await t('載入失敗後只存超商運費：只寫超商這一欄（merge），不會把宅配運費改成 0', async () => {
    const page = launch({ failLoad: true });
    await wait(100);
    page.document.getElementById('store-fixed-fee').value = '70';
    page.document.querySelector('.save-fixed-rates[data-method="store"]').click();
    await wait(50);
    const set = page.writes.find((w) => w.op === 'set' && w.ref.id === 'fixedRates');
    assert.ok(set, '沒有寫入 fixedRates');
    assert.strictEqual(set.data.store, 70);
    assert.ok(!('home' in set.data), '連宅配運費也一起寫了：' + JSON.stringify(set.data));
    assert.ok(set.options && set.options.merge === true, '沒有用 merge，會整份覆蓋');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
