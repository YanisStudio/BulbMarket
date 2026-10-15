// 訂單成立通知信的付款區塊（functions/index.js）：要有匯款帳號、付款頁連結，而且不再寫「ATM」。
// 用假的 firebase-functions 載入真實程式碼，不會真的寄信。
// 執行：cd functions && node ../tests/order-email-payment.test.cjs
const path = require('path');
const assert = require('assert');

const FN_DIR = path.join(__dirname, '..', 'functions');
function stub(id, exports) {
    const resolved = require.resolve(id, { paths: [FN_DIR] });
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const passthrough = (opts, handler) => handler;
stub('firebase-functions/v2/firestore', { onDocumentCreated: passthrough, onDocumentUpdated: passthrough });
stub('firebase-functions/v2/https', { onCall: passthrough, HttpsError: class extends Error {} });
stub('firebase-functions/params', { defineSecret: () => ({ value: () => 'KEY' }) });
stub('firebase-functions/logger', { info() {}, warn() {}, error() {} });
stub('firebase-admin/app', { initializeApp() {} });
stub('firebase-admin/firestore', { getFirestore() {}, FieldValue: {} });

const { _emailInternal } = require(path.join(FN_DIR, 'index.js'));
const { buildOrderConfirmationEmail, BANK_TRANSFER_INFO } = _emailInternal;

const order = (payment) => ({
    orderNumber: 'BG20261015-TEST', payment, total: 380, subtotal: 320, shippingFee: 60,
    customer: { name: '王<b>小明</b>', email: 'a@example.com' },
    items: [{ name: '百合', price: 160, quantity: 2 }],
});

let pass = 0, fail = 0;
const t = (name, fn) => {
    try { fn(); pass++; console.log('  PASS  ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
};

for (const payment of ['transfer', 'transfer_later']) {
    const { subject, bodyHtml } = buildOrderConfirmationEmail(order(payment), 'ORDER123');
    t(`${payment}：信裡有匯款帳號、應付金額`, () => {
        [BANK_TRANSFER_INFO.account, BANK_TRANSFER_INFO.accountName, BANK_TRANSFER_INFO.bankName, 'NT$ 380']
            .forEach((s) => assert.ok(bodyHtml.includes(s), '缺少 ' + s));
    });
    t(`${payment}：有連到這筆訂單付款頁的按鈕`, () => {
        assert.ok(bodyHtml.includes('href="https://flowerbulb.tw/pay.html?id=ORDER123"'), '沒有付款頁連結');
        assert.ok(bodyHtml.includes('前往付款'), '沒有按鈕文字');
    });
    t(`${payment}：不再出現「ATM」，付款方式叫「銀行轉帳」／「稍後轉帳」`, () => {
        assert.ok(!/ATM/.test(bodyHtml + subject), '還有 ATM');
        assert.ok(bodyHtml.includes(payment === 'transfer' ? '銀行轉帳' : '稍後轉帳'));
    });
}

t('顧客姓名有跳脫', () => {
    const { bodyHtml } = buildOrderConfirmationEmail(order('transfer'), 'X');
    assert.ok(!bodyHtml.includes('<b>小明</b>') && bodyHtml.includes('&lt;b&gt;'));
});

t('網站的匯款帳號（js/bank-info.js）跟信裡的一致', () => {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'js', 'bank-info.js'), 'utf8');
    for (const key of ['accountName', 'bankName', 'bankCode', 'account']) {
        assert.ok(src.includes(`${key}: '${BANK_TRANSFER_INFO[key]}'`), `${key} 不一致`);
    }
    const success = require('fs').readFileSync(path.join(__dirname, '..', 'order-success.html'), 'utf8');
    assert.ok(success.includes(BANK_TRANSFER_INFO.account), 'order-success.html 的帳號不一致');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
