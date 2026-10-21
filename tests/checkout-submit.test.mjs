// 結帳頁「提交訂單」與訂單完成頁
// - 送出中蓋一層轉圈圈（建立訂單的伺服器第一次啟動要好幾秒，以前只有按鈕文字變，顧客以為當掉）
// - 送出中離開頁面會先詢問；成功後不再詢問、按鈕維持停用；失敗時收起轉圈圈、按鈕恢復
// - 必填欄位沒填：標出是哪一欄（reportValidity）
// - 送出前的庫存檢查：讀不到時說是網路問題，不能說成「庫存 0 件」；缺貨訊息用「份」
// - 訂單完成頁：金額有 NT$；沒留 Email 的人不能跟他說「連結已寄到您的信箱」
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const LILY = { name: '百合', price: 120, stock: 10, status: 'active', category: 'bulbs' };

function fakeServices(products) {
    const state = { failProductReads: false, calls: [], pending: null };
    const snap = (data) => ({ exists: () => !!data, data: () => data });
    const services = {
        db: {}, auth: { currentUser: null },
        collection: (db, name) => ({ name }), doc: (db, col, id) => ({ col, id }),
        query: () => ({}), where: () => ({}), orderBy: () => ({}),
        onAuthStateChanged: (a, cb) => { setTimeout(() => cb(null), 0); return () => {}; },
        getDoc: async (ref) => {
            if (ref.col === 'products') {
                if (state.failProductReads) { const e = new Error('offline'); e.code = 'unavailable'; throw e; }
                return snap(products[ref.id]);
            }
            return snap(null);
        },
        getDocsFromServer: async () => ({ forEach: () => {} }),
        // 每次呼叫都回傳一個由測試控制何時完成的 promise
        createOrder: (req) => {
            state.calls.push(req);
            return new Promise((resolve, reject) => { state.pending = { resolve, reject }; });
        },
    };
    return { state, services };
}

function loadPayment(products, cartItems) {
    const html = read('payment.html');
    const body = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' + html.slice(html.indexOf('<body>'));
    // 不轉送 jsdom 自己的錯誤（例如「Not implemented: navigation」——成功後會跳到下一頁）
    const dom = new JSDOM(body, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://flowerbulb.tw/payment.html', virtualConsole: new VirtualConsole() });
    const { window } = dom;
    window.console.log = () => {};
    window.console.error = () => {};
    window.console.warn = () => {};
    const alerts = [];
    window.alert = (m) => alerts.push(m);
    window.localStorage.setItem('cart', JSON.stringify(cartItems));
    const fake = fakeServices(products);
    window.firebaseServices = fake.services;
    window.eval(read('js/common.js'));
    window.eval(read('js/tw-districts.js'));
    window.initCommonFeatures = () => {};
    const toasts = [];
    window.showToast = (m) => toasts.push(m);
    window.eval(html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1]);
    if (window.document.readyState !== 'loading') window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    const $ = (id) => window.document.getElementById(id);
    const fill = () => { $('name').value = '王小明'; $('phone').value = '0912345678'; $('address').value = '台北車站門市'; };
    const overlay = () => $('checkout-loading-overlay').style.display;
    const leaveBlocked = () => {
        const e = new window.Event('beforeunload', { cancelable: true });
        window.dispatchEvent(e);
        return e.defaultPrevented;
    };
    return { window, $, fake, alerts, toasts, fill, overlay, leaveBlocked };
}

let pass = 0, fail = 0;
async function t(name, fn) {
    try { await fn(); pass++; console.log('  PASS  ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}

const CART = [{ id: 'p1', name: '百合', price: 120, quantity: 2 }];

console.log('結帳頁：提交訂單');

await t('必填欄位沒填：標出是哪一欄，不送出', async () => {
    const page = loadPayment({ p1: LILY }, CART);
    await wait(200);
    let reported = 0;
    page.$('checkout-form').reportValidity = () => { reported++; return false; };
    page.$('submit-order').click();
    await wait(20);
    assert.strictEqual(reported, 1, '沒有呼叫 reportValidity');
    assert.strictEqual(page.fake.state.calls.length, 0);
    assert.ok(page.toasts.includes('請填寫所有必填欄位'));
});

await t('送出中：轉圈圈畫面＋兩顆按鈕停用；離開頁面會先詢問', async () => {
    const page = loadPayment({ p1: LILY }, CART);
    await wait(200);
    page.fill();
    page.$('submit-order').click();
    await wait(30);
    assert.strictEqual(page.fake.state.calls.length, 1, '沒有送出 createOrder');
    assert.strictEqual(page.overlay(), 'flex', '沒有顯示轉圈圈');
    assert.strictEqual(page.$('checkout-loading-text').textContent, '正在建立訂單');
    assert.ok(/不要關閉/.test(page.$('checkout-loading-subtext').textContent));
    assert.ok(page.$('submit-order').disabled && page.$('mobile-submit-order').disabled, '按鈕沒有停用');
    assert.ok(page.leaveBlocked(), '送出中離開頁面應該先詢問');
});

await t('成功：收起轉圈圈、按鈕維持停用、不再擋離開；成功視窗金額有 NT$；記錄有沒有留 Email', async () => {
    const page = loadPayment({ p1: LILY }, CART);
    await wait(200);
    page.fill();
    page.$('submit-order').click();
    await wait(30);
    page.fake.state.pending.resolve({ data: { orderId: 'o1', orderNumber: 'BG20261022-TEST', total: 300, itemCount: 1 } });
    await wait(30);
    assert.strictEqual(page.overlay(), 'none');
    assert.ok(page.$('submit-order').disabled, '成功後按鈕不能再按');
    assert.strictEqual(page.$('submit-order').textContent, '訂單已成立');
    assert.ok(!page.leaveBlocked(), '成功後要跳到下一頁，不能再擋');
    const modal = page.window.document.querySelector('.order-success-modal');
    assert.ok(modal && modal.textContent.includes('NT$ 300'), '成功視窗沒有 NT$ 金額');
    assert.strictEqual(modal.querySelector('.redirect-link').getAttribute('href'), '/order-success.html?payment=transfer');
    const lastOrder = JSON.parse(page.window.sessionStorage.getItem('lastOrder'));
    assert.strictEqual(lastOrder.hasEmail, false);
    assert.strictEqual(page.window.localStorage.getItem('cart'), null, '購物車沒有清空');
});

await t('伺服器擋下（例如已售完）：收起轉圈圈、按鈕恢復、顯示原因', async () => {
    const page = loadPayment({ p1: LILY }, CART);
    await wait(200);
    page.fill();
    page.$('submit-order').click();
    await wait(30);
    const err = new Error('以下商品已售完或下架：百合，請返回購物車調整數量');
    err.code = 'functions/failed-precondition';
    page.fake.state.pending.reject(err);
    await wait(80);
    assert.strictEqual(page.overlay(), 'none');
    assert.ok(!page.$('submit-order').disabled && !page.$('mobile-submit-order').disabled, '按鈕沒有恢復');
    assert.strictEqual(page.$('submit-order').textContent, '提交訂單');
    assert.ok(!page.leaveBlocked());
    assert.ok(page.alerts.some((m) => m.includes('已售完或下架：百合')), page.alerts.join(' | '));
});

await t('庫存檢查讀不到：說是網路問題，不說成「庫存 0」；不送出訂單', async () => {
    const page = loadPayment({ p1: LILY }, CART);
    await wait(200);
    page.fill();
    page.fake.state.failProductReads = true;
    page.$('submit-order').click();
    await wait(80);
    assert.strictEqual(page.fake.state.calls.length, 0);
    assert.strictEqual(page.overlay(), 'none');
    assert.ok(page.alerts.some((m) => /網路連線不穩定/.test(m)), page.alerts.join(' | '));
    assert.ok(!page.alerts.some((m) => /庫存 0/.test(m)));
    assert.ok(!page.$('submit-order').disabled);
});

await t('庫存不足：列出需要幾份、目前庫存幾份', async () => {
    const page = loadPayment({ p1: { ...LILY, stock: 1 } }, CART);
    await wait(200);
    page.fill();
    page.$('submit-order').click();
    await wait(80);
    assert.strictEqual(page.fake.state.calls.length, 0);
    assert.ok(page.alerts.some((m) => m.includes('百合：需要 2 份，目前庫存 1 份')), page.alerts.join(' | '));
});

console.log('\n訂單完成頁');

function loadSuccess(lastOrder, query = '?payment=transfer') {
    const html = read('order-success.html');
    const body = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' + html.slice(html.indexOf('<body>'));
    const dom = new JSDOM(body, { runScripts: 'outside-only', url: 'https://flowerbulb.tw/order-success.html' + query, virtualConsole: new VirtualConsole() });
    const { window } = dom;
    window.sessionStorage.setItem('lastOrder', JSON.stringify(lastOrder));
    window.firebaseServices = { auth: { currentUser: null }, onAuthStateChanged: (a, cb) => { setTimeout(() => cb(null), 0); return () => {}; } };
    window.eval(read('js/common.js'));
    window.eval(read('js/bank-info.js'));
    window.initCommonFeatures = () => {};
    window.updateCartCount = () => {};
    window.eval(html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1]);
    if (window.document.readyState !== 'loading') window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    return { $: (id) => window.document.getElementById(id), document: window.document };
}

const ORDER = { id: 'o1', orderNumber: 'BG20261022-TEST', total: 880, items: 2, customerName: '王小明', customerPhone: '0912345678', orderDate: '2026-10-22' };

await t('訂單總額有 NT$，付款頁連結帶訂單 ID', async () => {
    const page = loadSuccess({ ...ORDER, hasEmail: true });
    await wait(20);
    assert.strictEqual(page.$('order-total').textContent, 'NT$ 880');
    assert.strictEqual(page.$('transfer-pay-link').getAttribute('href'), '/pay.html?id=o1');
});

await t('有留 Email：說明付款連結已寄到信箱', async () => {
    const page = loadSuccess({ ...ORDER, hasEmail: true });
    await wait(20);
    assert.ok(/已經寄到您的信箱/.test(page.document.querySelector('#transfer-notice .important-note').textContent));
});

await t('沒留 Email：提醒把付款頁存起來，不說「已寄到信箱」', async () => {
    const page = loadSuccess({ ...ORDER, hasEmail: false });
    await wait(20);
    const note = page.document.querySelector('#transfer-notice .important-note').textContent;
    assert.ok(/沒有留 Email/.test(note) && /加入書籤/.test(note), note);
    assert.ok(!/已經寄到您的信箱/.test(note));
});

await t('舊版結帳頁的資料（沒有 hasEmail）：維持原本說明', async () => {
    const page = loadSuccess({ ...ORDER });
    await wait(20);
    assert.ok(/已經寄到您的信箱/.test(page.document.querySelector('#transfer-notice .important-note').textContent));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
