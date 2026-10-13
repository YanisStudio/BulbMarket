// 購物車／結帳頁的價格要以資料庫為準。
//
// 購物車存在 localStorage 的是「加入當下」的價格。後台改價之後，結帳頁和伺服器
// 都會因為價格對不上而擋下訂單、請顧客「回購物車確認最新金額」——如果購物車
// 不更新價格，顧客回去看到的還是舊價格，就卡在購物車和結帳頁之間，
// 只能刪掉商品重新加入（重新加入也沒用，addToCart 只會加數量）。
//
// 另外驗證：
//   - 階梯運費的最大數量是 0 時，前台不能無限迴圈（跟伺服器同一套容錯）
//   - 移除商品後重新讀取失敗時，不能把舊列表留在畫面上（每列的編號已經對不上）
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.join(path.dirname(HERE), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 假的 Firestore：products 用 db 物件，其他設定文件都不存在（＝預設值：固定運費、超商 0 元）
function fakeServices(products, { tieredRates = [], calculationMode = null } = {}) {
    const state = { failReads: false };
    const offline = () => { const e = new Error('Failed to get document from server.'); e.code = 'unavailable'; throw e; };
    const snap = (data) => ({ exists: () => !!data, data: () => data });
    return {
        state,
        services: {
            db: {}, auth: { currentUser: null },
            collection: (db, name) => ({ name }), doc: (db, col, id) => ({ col, id }),
            query: () => ({}), where: () => ({}), orderBy: () => ({}),
            onAuthStateChanged: (a, cb) => { setTimeout(() => cb(null), 0); return () => {}; },
            getDoc: async (ref) => {
                if (state.failReads) offline();
                if (ref.col === 'products') return snap(products[ref.id]);
                if (ref.col === 'shippingSettings' && ref.id === 'calculationMode' && calculationMode) {
                    return snap({ mode: calculationMode });
                }
                return snap(null);
            },
            getDocsFromServer: async () => {
                if (state.failReads) offline();
                return { forEach: (fn) => tieredRates.forEach((r, i) => fn({ id: 't' + i, data: () => r })) };
            },
        },
    };
}

function loadPage(file, cartItems, fake, extraScripts = []) {
    const html = read(file);
    const body = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' + html.slice(html.indexOf('<body>'));
    const dom = new JSDOM(body, { runScripts: 'outside-only', url: 'https://flowerbulb.tw/' + file });
    const { window } = dom;
    window.console.log = () => {};
    window.console.warn = () => {};
    window.console.error = () => {};
    window.confirm = () => true;
    window.alert = () => {};
    window.localStorage.setItem('cart', JSON.stringify(cartItems));
    window.firebaseServices = fake.services;
    window.eval(read('js/common.js'));
    extraScripts.forEach((f) => window.eval(read(f)));
    window.initCommonFeatures = () => {};
    const toasts = [];
    window.showToast = (m) => toasts.push(m);
    const inline = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
    window.eval(inline[1]);
    // jsdom 會在建構後自己觸發一次 DOMContentLoaded（readyState 還是 loading 時），
    // 這時再手動 dispatch 一次，頁面就會初始化兩次（事件綁兩次、按一下寫兩筆）
    if (window.document.readyState !== 'loading') window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    return { window, document: window.document, toasts, savedCart: () => JSON.parse(window.localStorage.getItem('cart')) };
}

const LILY = { name: '百合', price: 120, stock: 10, status: 'active', category: 'bulbs' };
const TULIP = { name: '鬱金香', price: 80, stock: 10, status: 'active', category: 'bulbs' };

// ---- 子行程模式：專門跑「可能無限迴圈」的情境，由主行程設逾時 ----
if (process.argv[2] === '--zero-max-tier') {
    const fake = fakeServices({ p1: LILY }, {
        calculationMode: 'tiered',
        tieredRates: [{ method: 'store', category: 'bulbs', minQuantity: 1, maxQuantity: 0, fee: 60 }],
    });
    const page = loadPage('cart.html', [{ id: 'p1', name: '百合', price: 120, quantity: 2, stock: 10 }], fake);
    await wait(200);
    process.stdout.write('TOTAL=' + page.document.getElementById('cart-total').textContent.trim());
    process.exit(0);
}

let pass = 0, fail = 0;
async function t(name, fn) {
    try { await fn(); pass++; console.log('  PASS  ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}

console.log('購物車');

await t('後台改價後，購物車改用最新價格、寫回 localStorage，並告知顧客', async () => {
    const fake = fakeServices({ p1: LILY });
    const page = loadPage('cart.html', [{ id: 'p1', name: '百合', price: 100, quantity: 2, stock: 10 }], fake);
    await wait(200);
    assert.strictEqual(page.savedCart()[0].price, 120, 'localStorage 還是舊價格 ' + page.savedCart()[0].price);
    const total = page.document.getElementById('cart-total').textContent;
    assert.ok(/NT\$ 240/.test(total), '總額應該是 NT$ 240，實際 ' + total);
    const notice = page.document.querySelector('.removed-items-notification');
    assert.ok(notice && /商品價格已更新/.test(notice.textContent) && /100/.test(notice.textContent) && /120/.test(notice.textContent),
        '沒有顯示價格更新通知');
});

await t('價格沒變時不顯示通知', async () => {
    const fake = fakeServices({ p1: LILY });
    const page = loadPage('cart.html', [{ id: 'p1', name: '百合', price: 120, quantity: 1, stock: 10 }], fake);
    await wait(200);
    assert.strictEqual(page.document.querySelector('.removed-items-notification'), null, '不應該有通知');
    assert.ok(/NT\$ 120/.test(page.document.getElementById('cart-total').textContent));
});

await t('移除商品後重新讀取失敗：改顯示連線錯誤，不留下編號對不上的舊列表', async () => {
    const fake = fakeServices({ p1: LILY, p2: TULIP });
    const page = loadPage('cart.html', [
        { id: 'p1', name: '百合', price: 120, quantity: 1, stock: 10 },
        { id: 'p2', name: '鬱金香', price: 80, quantity: 1, stock: 10 },
    ], fake);
    await wait(200);
    fake.state.failReads = true;
    page.document.querySelector('.remove-item[data-index="0"]').click();
    await wait(200);
    const text = page.document.getElementById('cart-container').textContent;
    assert.ok(/網路連線不穩定/.test(text), '應顯示連線錯誤，實際：' + text.trim().slice(0, 60));
    assert.strictEqual(page.document.querySelectorAll('.remove-item').length, 0, '舊列表的刪除按鈕還在');
    assert.deepStrictEqual(page.savedCart().map((i) => i.id), ['p2'], '購物車內容不對');
});

await t('階梯運費最大數量是 0：不會無限迴圈，視為不限（跟伺服器一致）', async () => {
    const r = spawnSync(process.execPath, [HERE, '--zero-max-tier'], { timeout: 20000, encoding: 'utf8' });
    assert.ok(!r.error && r.status === 0, '頁面卡住或出錯（' + (r.error ? r.error.code : 'exit ' + r.status) + '）');
    assert.ok(/TOTAL=NT\$ 300/.test(r.stdout), '總額應該是 240 + 運費 60 = NT$ 300，實際 ' + r.stdout);
});

console.log('\n結帳頁');

await t('後台改價後，結帳頁也改用最新價格計算小計，並寫回 localStorage', async () => {
    const fake = fakeServices({ p1: LILY });
    const page = loadPage('payment.html', [{ id: 'p1', name: '百合', price: 100, quantity: 2, stock: 10 }], fake,
        ['js/tw-districts.js']);
    await wait(300);
    assert.strictEqual(page.document.getElementById('subtotal').textContent.trim(), '240', '小計還是用舊價格');
    assert.strictEqual(page.savedCart()[0].price, 120, 'localStorage 還是舊價格');
    assert.ok(page.toasts.some((m) => /價格已更新/.test(m)), '沒有告知顧客價格更新');
});

console.log('\n加入購物車');

await t('已經在購物車裡的商品再加一次，價格與名稱更新成目前的', async () => {
    const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only', url: 'https://flowerbulb.tw/' });
    const { window } = dom;
    window.console.log = () => {};
    window.localStorage.setItem('cart', JSON.stringify([{ id: 'p1', name: '舊名稱', price: 100, quantity: 1, stock: 10 }]));
    window.eval(read('js/common.js'));
    window.showToast = () => {};
    window.updateCartCount = () => {};
    window.addToCart('p1', '百合', 120, 1, 10);
    const item = JSON.parse(window.localStorage.getItem('cart'))[0];
    assert.deepStrictEqual([item.price, item.name, item.quantity], [120, '百合', 2]);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
