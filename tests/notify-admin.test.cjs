// 新訂單管理員通知信（functions/notify-admin.js）
// 用假的 firebase-functions 與假的 Brevo 驅動真實程式碼，不會真的寄信。
// 執行：cd functions && node ../tests/notify-admin.test.cjs
const path = require('path');
const assert = require('assert');

const FN_DIR = path.join(__dirname, '..', 'functions');
function stub(id, exports) {
    const resolved = require.resolve(id, { paths: [FN_DIR] });
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const logs = [];
stub('firebase-functions/v2/firestore', { onDocumentCreated: (opts, handler) => Object.assign(handler, { opts }) });
stub('firebase-functions/params', { defineSecret: (name) => ({ name, value: () => 'FAKE-KEY' }) });
stub('firebase-functions/logger', {
    info: (m, d) => logs.push(['info', m, d]), warn() {}, error: (m, d) => logs.push(['error', m, d])
});
const sent = [];
let failBrevo = false;
stub(path.join(FN_DIR, 'brevo.js'), {
    sendEmail: async (args) => {
        if (failBrevo) throw new Error('Brevo API 回應 401');
        sent.push(args);
        return {};
    }
});

const { notifyAdminNewOrder, _internal } = require(path.join(FN_DIR, 'notify-admin.js'));

const ORDER = {
    orderNumber: 'BG20261014-TEST',
    customer: { name: '王<b>小明</b>', phone: '0912345678', email: 'a@example.com', address: '台北車站門市' },
    shipping: 'store', payment: 'transfer',
    items: [{ id: 'p1', name: '百合', price: 120, quantity: 2 }, { id: 'p2', name: '鬱金香', price: 80, quantity: 1 }],
    subtotal: 320, shippingFee: 60, total: 380, notes: '請幫我\n包裝好一點',
    orderDate: { toDate: () => new Date(Date.UTC(2026, 9, 14, 2, 30)) },
};
const event = (data) => ({ data: { data: () => data }, params: { orderId: 'ORDER123' } });

let pass = 0, fail = 0;
async function t(name, fn) {
    try { await fn(); pass++; console.log('  PASS  ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}

(async () => {
    await t('監聽的是新建立的訂單，並帶上 Brevo 金鑰', async () => {
        assert.strictEqual(notifyAdminNewOrder.opts.document, 'orders/{orderId}');
        assert.ok(notifyAdminNewOrder.opts.secrets.some((s) => s.name === 'BREVO_API_KEY'));
    });

    await t('寄給 vincentsayhello@gmail.com，主旨有訂單編號、顧客、金額', async () => {
        sent.length = 0;
        await notifyAdminNewOrder(event(ORDER));
        assert.deepStrictEqual(sent.map((s) => s.toEmail), ['vincentsayhello@gmail.com']);
        assert.ok(sent[0].subject.includes('BG20261014-TEST'), sent[0].subject);
        assert.ok(sent[0].subject.includes('NT$ 380'), sent[0].subject);
        assert.strictEqual(sent[0].apiKey, 'FAKE-KEY');
    });

    await t('內容有商品明細、運費、總額、備註、台灣時間，以及直接打開這筆訂單的後台連結', async () => {
        const { html } = _internal.buildAdminOrderEmail(ORDER, 'ORDER123');
        ['百合', '鬱金香', 'NT$ 240', 'NT$ 60', 'NT$ 380', '0912345678', '台北車站門市', 'ATM 轉帳', '7-11 取貨', '包裝好一點']
            .forEach((s) => assert.ok(html.includes(s), '缺少 ' + s));
        assert.ok(html.includes('2026/10/14 10:30'), '時間不是台灣時區');
        assert.ok(html.includes('https://flowerbulb.tw/admin/orders.html?id=ORDER123'), '缺少後台連結');
        assert.ok(html.includes('請幫我<br>包裝好一點'), '備註換行沒有保留');
    });

    await t('顧客填的內容會被跳脫，不能在信裡插入 HTML', async () => {
        const { html } = _internal.buildAdminOrderEmail(ORDER, 'ORDER123');
        assert.ok(!html.includes('<b>小明</b>'), '姓名沒有跳脫');
        assert.ok(html.includes('王&lt;b&gt;小明&lt;/b&gt;'));
    });

    await t('寄信失敗只記錄錯誤、不丟出例外（不讓 Cloud Functions 重試造成重複寄信）', async () => {
        failBrevo = true;
        logs.length = 0;
        await notifyAdminNewOrder(event(ORDER));
        failBrevo = false;
        assert.ok(logs.some(([level, m]) => level === 'error' && /寄送失敗/.test(m)), '沒有記錄錯誤');
    });

    await t('資料是空的就不寄', async () => {
        sent.length = 0;
        await notifyAdminNewOrder(event(undefined));
        assert.strictEqual(sent.length, 0);
    });

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
