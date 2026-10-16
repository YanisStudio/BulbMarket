// 訂單狀態（js/order-status.js）：7 個狀態的順序、名稱、算不算已付款，
// 以及前後台各頁面都改用這一份，而不是各自寫死。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' });
dom.window.eval(read('js/order-status.js'));
const S = dom.window.OrderStatus;

let pass = 0, fail = 0;
const t = (name, fn) => {
    try { fn(); pass++; console.log('  PASS  ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
};

t('7 個狀態，順序：未付款 → 訂單確認 → 已付款 → 確認收款備貨中 → 已出貨 → 已完成 → 已取消', () => {
    assert.deepStrictEqual([...S.LIST.map((s) => s.label)],
        ['未付款', '訂單確認', '已付款', '確認收款備貨中', '已出貨', '已完成', '已取消']);
});

t('「訂單確認」還在等付款（顧客看得到付款頁、未付款提醒），不算已付款', () => {
    assert.strictEqual(S.isAwaitingPayment('order_confirmed'), true);
    assert.strictEqual(S.isPaid('order_confirmed'), false);
});

t('「確認收款備貨中」算已付款（後台改成這個狀態會寄付款確認信），不再等付款', () => {
    assert.strictEqual(S.isPaid('preparing'), true);
    assert.strictEqual(S.isAwaitingPayment('preparing'), false);
});

t('還沒寄出的狀態，取消時可以把庫存加回；已出貨／已完成不行', () => {
    ['pending', 'order_confirmed', 'confirmed', 'preparing'].forEach((v) => assert.strictEqual(S.isRestorable(v), true, v));
    ['shipped', 'completed', 'cancelled'].forEach((v) => assert.strictEqual(S.isRestorable(v), false, v));
});

t('沒有狀態或不認得的狀態當成未付款（跟以前一致）', () => {
    assert.strictEqual(S.label(undefined), '未付款');
    assert.strictEqual(S.label('weird'), '未付款');
    assert.strictEqual(S.isAwaitingPayment(undefined), true);
});

t('後台篩選選單、Excel 匯出範圍都有新狀態', () => {
    const html = read('admin/orders.html');
    assert.ok(html.includes('<option value="order_confirmed">訂單確認</option>'));
    assert.ok(html.includes('<option value="preparing">確認收款備貨中</option>'));
    assert.ok(html.includes('value="preparing"> 僅確認收款備貨中訂單'));
});

t('各頁面都載入 js/order-status.js，不再自己寫死狀態清單', () => {
    for (const f of ['admin/orders.html', 'admin/dashboard.html', 'orders.html', 'pay.html']) {
        const html = read(f);
        assert.ok(html.includes('/js/order-status.js'), f + ' 沒有載入');
        assert.ok(!/case 'confirmed':/.test(html), f + ' 還有寫死的狀態 switch');
    }
    assert.ok(!read('admin/orders.html').includes("['confirmed', 'shipped', 'completed'].includes"), '後台付款判斷還是寫死');
});

t('後台狀態徽章、前台狀態標籤都有新狀態的顏色', () => {
    const css = read('css/admin-common.css');
    assert.ok(css.includes('.status-badge.order_confirmed') && css.includes('.status-badge.preparing'));
    const orders = read('orders.html');
    assert.ok(orders.includes('.status-order_confirmed') && orders.includes('.status-preparing'));
});

t('未付款提醒把「訂單確認」也算成未付款', () => {
    const w = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' }).window;
    w.eval(read('js/unpaid-reminder.js'));
    assert.strictEqual(w.UnpaidReminder.isUnpaid({ status: 'order_confirmed', paymentConfirmed: false, notes: '' }), true);
    assert.strictEqual(w.UnpaidReminder.isUnpaid({ status: 'preparing', paymentConfirmed: true }), false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
