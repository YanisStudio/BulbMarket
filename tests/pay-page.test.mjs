// 付款頁 pay.html?id=訂單ID（訂單成立通知信的「前往付款」按鈕連到這裡）
// 以及未付款提醒（js/unpaid-reminder.js）、訂單記錄預設勾選未付款訂單。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const BASE_ORDER = {
    orderNumber: 'BG20261015-ABCD', status: 'pending', paymentConfirmed: false, payment: 'transfer_later',
    total: 380, shippingFee: 60, notes: '', items: [{ name: '百合', price: 160, quantity: 2 }],
    customer: { name: '王小明', phone: '0912345678', address: '台中市某某路 1 號' },
};

function openPay({ order, user = null, id = 'ORDER1', orders = null, query = null }) {
    const db = orders || (order ? { ORDER1: order } : {});
    const html = read('pay.html');
    const body = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' + html.slice(html.indexOf('<body>'));
    const dom = new JSDOM(body, { runScripts: 'outside-only', url: 'https://flowerbulb.tw/pay.html' + (query !== null ? query : (id ? '?id=' + id : '')) });
    const { window } = dom;
    window.console.error = () => {};
    window.console.log = () => {};
    window.scrollTo = () => {}; // jsdom 沒有實作捲動
    const calls = [];
    window.firebaseServices = {
        db: {}, auth: { currentUser: user },
        doc: (db, col, docId) => ({ col, id: docId }),
        getDoc: async (ref) => ({ exists: () => !!db[ref.id], data: () => db[ref.id] }),
        onAuthStateChanged: (auth, cb) => { setTimeout(() => cb(user), 0); return () => {}; },
        appendOrderNote: async (payload) => { calls.push(payload); return { data: { updated: 1 } }; },
    };
    window.eval(read('js/common.js'));
    window.initCommonFeatures = () => {};
    window.eval(read('js/bank-info.js'));
    window.eval(read('js/order-status.js'));
    const inline = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
    window.eval(inline[1]);
    return { window, document: window.document, calls, root: () => window.document.getElementById('pay-root') };
}

let pass = 0, fail = 0;
async function t(name, fn) {
    try { await fn(); pass++; console.log('  PASS  ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}

console.log('付款頁');

await t('未付款的訪客訂單：顯示應付金額、匯款帳號與回報表單；不顯示電話地址', async () => {
    const page = openPay({ order: { ...BASE_ORDER, payment: 'transfer' } });
    await wait(100);
    const text = page.root().textContent;
    ['BG20261015-ABCD', '尚未付款', '1023-979-097466', '林瑞青', '玉山銀行', 'NT$ 380']
        .forEach((s) => assert.ok(text.includes(s), '缺少 ' + s));
    assert.ok(!text.includes('0912345678') && !text.includes('台中市某某路'), '不應該顯示電話或地址');
    assert.ok(page.document.getElementById('pay-form'), '沒有回報表單');
    assert.strictEqual(page.document.getElementById('pay-amount').value, '380', '金額沒有預先帶入');
});

await t('送出回報：呼叫 appendOrderNote（kind=payment，這一筆訂單），成功後顯示已收到', async () => {
    const page = openPay({ order: { ...BASE_ORDER, payment: 'transfer' } });
    await wait(100);
    const $ = (id) => page.document.getElementById(id);
    $('pay-remitter').value = '王小明';
    $('pay-bank').value = '台灣銀行';
    $('pay-last5').value = '12345';
    $('pay-form').dispatchEvent(new page.window.Event('submit', { cancelable: true }));
    await wait(50);
    assert.strictEqual(page.calls.length, 1, '沒有呼叫');
    assert.deepStrictEqual([...page.calls[0].orderIds], ['ORDER1']);
    assert.strictEqual(page.calls[0].kind, 'payment');
    assert.strictEqual(page.calls[0].payment.lastFiveDigits, '12345');
    assert.strictEqual(page.calls[0].payment.amount, '380');
    assert.ok(/已收到您的匯款資訊/.test($('pay-report').textContent));
});

await t('會員訂單、沒有登入（從信件連結進來）：一樣可以直接回報，不用先登入', async () => {
    const page = openPay({ order: { ...BASE_ORDER, userId: 'u1' } });
    await wait(100);
    assert.ok(page.root().textContent.includes('1023-979-097466'), '帳號沒顯示');
    assert.ok(page.document.getElementById('pay-form'), '應該直接顯示回報表單');
    assert.ok(!/請先登入/.test(page.root().textContent), '不應該要求登入');
});

await t('多筆一起付（?ids=）：合計金額、一張表單，送出時用 mergePayment 一次回報所有未付款訂單', async () => {
    const page = openPay({
        query: '?ids=A,B,C,MISSING',
        orders: {
            A: { ...BASE_ORDER, orderNumber: 'BG-A', total: 380 },
            B: { ...BASE_ORDER, orderNumber: 'BG-B', total: 120 },
            C: { ...BASE_ORDER, orderNumber: 'BG-C', total: 999, paymentConfirmed: true, status: 'confirmed' },
        },
    });
    await wait(100);
    const text = page.root().textContent;
    assert.ok(text.includes('共 2 筆訂單尚未付款') && text.includes('NT$ 500'), '合計不對：' + text.slice(0, 80));
    assert.ok(text.includes('BG-C') && text.includes('已付款'), '已付款的訂單應該列出來並標示已付款');
    assert.ok(text.includes('1 筆訂單找不到'), '找不到的訂單沒有提示');
    assert.strictEqual(page.document.getElementById('pay-amount').value, '500');
    const $ = (id) => page.document.getElementById(id);
    $('pay-remitter').value = '王小明';
    $('pay-bank').value = '台灣銀行';
    $('pay-last5').value = '12345';
    $('pay-form').dispatchEvent(new page.window.Event('submit', { cancelable: true }));
    await wait(50);
    assert.strictEqual(page.calls[0].kind, 'mergePayment');
    assert.deepStrictEqual([...page.calls[0].orderIds], ['A', 'B'], '只回報未付款的那兩筆');
});

await t('已回報匯款：顯示「已收到您的匯款回報」，仍可補充', async () => {
    const page = openPay({ order: { ...BASE_ORDER, notes: '【匯款確認】匯款人姓名: 王小明' } });
    await wait(100);
    assert.ok(page.root().textContent.includes('已收到您的匯款回報'));
    assert.ok(page.document.getElementById('pay-form'));
});

await t('已付款／已取消：不顯示匯款帳號與表單', async () => {
    for (const [patch, word] of [[{ paymentConfirmed: true, status: 'confirmed' }, '已確認付款'], [{ status: 'cancelled' }, '已取消']]) {
        const page = openPay({ order: { ...BASE_ORDER, ...patch } });
        await wait(100);
        assert.ok(page.root().textContent.includes(word), '缺少 ' + word);
        assert.ok(!page.root().textContent.includes('1023-979-097466'), word + ' 還顯示帳號');
        assert.ok(!page.document.getElementById('pay-form'), word + ' 還顯示表單');
    }
});

await t('網址沒有訂單編號、或訂單不存在：顯示找不到', async () => {
    let page = openPay({ order: BASE_ORDER, id: '' });
    await wait(50);
    assert.ok(page.root().textContent.includes('找不到訂單'));
    page = openPay({ order: null, id: 'NOPE' });
    await wait(100);
    assert.ok(page.root().textContent.includes('找不到訂單'));
});

console.log('\n未付款提醒');

function openReminder({ pathname = '/index.html', orders, user = { uid: 'u1' }, storage = null }) {
    const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
        runScripts: 'outside-only', url: 'https://flowerbulb.tw' + pathname,
    });
    const { window } = dom;
    window.console.warn = () => {};
    if (storage) Object.entries(storage).forEach(([k, v]) => window.sessionStorage.setItem(k, v));
    const queries = [];
    window.firebaseServices = {
        db: {}, auth: { currentUser: user },
        collection: (db, name) => ({ name }), where: (f, op, v) => ({ f, op, v }), query: (c, w) => ({ c, w }),
        getDocs: async (q) => { queries.push(q); return { forEach: (fn) => orders.forEach((o, i) => fn({ id: 'o' + i, data: () => o })) }; },
        onAuthStateChanged: (auth, cb) => { setTimeout(() => cb(user), 0); return () => {}; },
    };
    window.eval(read('js/common.js'));
    window.eval(read('js/unpaid-reminder.js'));
    return { window, document: window.document, queries };
}

const UNPAID = [
    { status: 'pending', paymentConfirmed: false, total: 380, notes: '' },
    { status: 'pending', paymentConfirmed: false, total: 120, notes: '' },
    { status: 'pending', paymentConfirmed: false, total: 999, notes: '【匯款確認】已回報' },
    { status: 'confirmed', paymentConfirmed: true, total: 500 },
];

await t('有 2 筆以上未付款：跳出提醒，筆數與金額不含已回報、已付款的訂單，帶到訂單記錄讓顧客自己勾選', async () => {
    const page = openReminder({ orders: UNPAID });
    await wait(50);
    const box = page.document.querySelector('.unpaid-reminder');
    assert.ok(box, '沒有跳出提醒');
    assert.ok(box.textContent.includes('2 筆') && box.textContent.includes('NT$ 500'), box.textContent.trim().slice(0, 80));
    assert.strictEqual(box.querySelector('a').getAttribute('href'), '/orders.html');
    assert.deepStrictEqual(page.queries[0].w, { f: 'userId', op: '==', v: 'u1' }, '只能查自己的訂單');
    box.querySelector('.unpaid-reminder-later').click();
    assert.strictEqual(page.document.querySelector('.unpaid-reminder'), null, '按「稍後再說」沒有關掉');
});

await t('只有 1 筆未付款：直接帶到那筆的付款頁', async () => {
    const page = openReminder({ orders: [UNPAID[0], UNPAID[3]] });
    await wait(50);
    const box = page.document.querySelector('.unpaid-reminder');
    assert.ok(box && box.textContent.includes('1 筆') && box.textContent.includes('NT$ 380'));
    assert.strictEqual(box.querySelector('a').getAttribute('href'), '/pay.html?id=o0');
});

await t('同一個工作階段只提醒一次', async () => {
    const page = openReminder({ orders: UNPAID, storage: { unpaidReminderShown_u1: '1' } });
    await wait(50);
    assert.strictEqual(page.document.querySelector('.unpaid-reminder'), null);
    assert.strictEqual(page.queries.length, 0, '提醒過了還在查詢');
});

await t('在訂單記錄、付款頁、結帳頁不跳提醒；沒有未付款訂單也不跳', async () => {
    for (const p of ['/orders.html', '/pay.html', '/payment.html']) {
        const page = openReminder({ pathname: p, orders: UNPAID });
        await wait(50);
        assert.strictEqual(page.document.querySelector('.unpaid-reminder'), null, p + ' 跳了提醒');
    }
    const page = openReminder({ orders: [UNPAID[2], UNPAID[3]] });
    await wait(50);
    assert.strictEqual(page.document.querySelector('.unpaid-reminder'), null, '沒有未付款還是跳了');
});

console.log('\n訂單記錄');

await t('未付款訂單的勾選框預設勾選', async () => {
    const src = read('orders.html');
    assert.ok(/class="order-select-checkbox"[^`]*\bchecked\b/.test(src), '勾選框沒有預設 checked');
});

await t('訂單記錄不放付款表單，「前往付款」帶著勾選的訂單到付款頁', async () => {
    const html = read('orders.html');
    assert.ok(!html.includes('merge-payment-form'), '還有合併匯款表單');
    const dom = new JSDOM('<!DOCTYPE html><body>' + html.slice(html.indexOf('<div class="merge-payment-bar"'), html.indexOf('</div>', html.indexOf('id="go-pay-btn"')) + 6)
        + '<input type="checkbox" class="order-select-checkbox" data-id="A" data-total="380" checked>'
        + '<input type="checkbox" class="order-select-checkbox" data-id="B" data-total="120" checked>'
        + '<input type="checkbox" class="order-select-checkbox" data-id="C" data-total="999"></body>', { runScripts: 'outside-only' });
    const fn = html.match(/function updateMergePaymentBar\(\) \{[\s\S]*?\n\}/)[0];
    dom.window.eval(fn + '; updateMergePaymentBar();');
    const d = dom.window.document;
    assert.strictEqual(d.getElementById('go-pay-btn').getAttribute('href'), '/pay.html?ids=A,B');
    assert.strictEqual(d.getElementById('merge-selected-total').textContent, '500');
});

await t('結帳完成頁不放回報表單、離開時不再跳提醒，改成「前往付款」', async () => {
    const html = read('order-success.html');
    assert.ok(!html.includes('payment-confirm-form'), '還有回報表單');
    assert.ok(!html.includes('beforeunload'), '還有離開提醒');
    assert.ok(html.includes("'/pay.html?id=' + encodeURIComponent(lastOrder.id)"), '沒有付款頁連結');
});

await t('所有前台頁面都載入了未付款提醒', async () => {
    const missing = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'))
        .filter((f) => read(f).includes('/js/member.js') && !read(f).includes('/js/unpaid-reminder.js'));
    assert.deepStrictEqual(missing, []);
});

console.log('\n結帳與訂單資訊');

await t('結帳時 Email 是選填（不是每個顧客都有 Email），手機登入的會員會帶入會員資料的 Email', async () => {
    const html = read('payment.html');
    const input = html.match(/<input type="email" id="email"[^>]*>/)[0];
    assert.ok(!/\brequired\b/.test(input), 'Email 不能是必填：' + input);
    assert.ok(html.includes('if (!emailInput.value && userData.email) emailInput.value = userData.email;'), '沒有帶入會員資料的 Email');
});

await t('結帳完成頁的說明跟實際一致：寄 Email 通知，不是簡訊', async () => {
    const html = read('order-success.html');
    assert.ok(!html.includes('簡訊'), '還寫著簡訊通知');
    assert.ok(html.includes('寄 Email 通知您'));
});

await t('商品數量顯示總件數（1 種買 3 顆是 3 件），不是商品種類數', async () => {
    assert.ok(!read('orders.html').includes('order.items?.length || 0} 件'), '訂單記錄還在用商品種類數');
    assert.ok(!read('payment.html').includes('items: result.itemCount'), '結帳完成頁還在用商品種類數');
});

await t('未付款訂單有說明不要的話怎麼辦（聯絡我們取消）', async () => {
    assert.ok(read('orders.html').includes('不需要這筆訂單了嗎？'));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
