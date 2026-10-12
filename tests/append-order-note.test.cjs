// 用假的 Firestore 驅動 functions/append-order-note.js，驗證行為（尤其是「只往後接」這個安全性質）
const path = require('path');
const assert = require('assert');

const FN_DIR = require('path').join(__dirname, '..', 'functions');

// ---- 先把要攔截的模組塞進 require.cache，append-order-note.js require 時就會拿到這些假的 ----
function stub(id, exports) {
    const resolved = require.resolve(id, { paths: [FN_DIR] });
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

class FakeHttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
}
stub('firebase-functions/v2/https', {
    // onCall 直接回傳 handler，測試就能像普通函式一樣呼叫
    onCall: (opts, handler) => handler,
    HttpsError: FakeHttpsError
});
stub('firebase-functions/logger', { info() {}, warn() {}, error() {} });

// 假 Firestore：用一個 Map 當資料庫
let store = new Map();
let writeLog = [];
function makeDb() {
    const refFor = (id) => ({
        id,
        get __id() { return id; },
        update(data) { throw new Error('不應直接呼叫 ref.update'); }
    });
    return {
        collection(name) {
            assert.strictEqual(name, 'orders');
            return { doc: (id) => refFor(id) };
        },
        async runTransaction(fn) {
            const tx = {
                async getAll(...refs) {
                    return refs.map((ref) => {
                        const data = store.get(ref.id);
                        return {
                            ref,
                            exists: data !== undefined,
                            data: () => data
                        };
                    });
                },
                update(ref, data) {
                    writeLog.push({ id: ref.id, data });
                    store.set(ref.id, Object.assign({}, store.get(ref.id), data));
                }
            };
            return fn(tx);
        }
    };
}
stub('firebase-admin/firestore', { getFirestore: makeDb });

const { appendOrderNote } = require(path.join(FN_DIR, 'append-order-note.js'));

// ---- 測試工具 ----
let pass = 0, fail = 0;
function t(name, fn) {
    store = new Map();
    writeLog = [];
    return Promise.resolve()
        .then(fn)
        .then(() => { pass++; console.log('  PASS  ' + name); })
        .catch((e) => { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); });
}
async function expectCode(code, fn) {
    try {
        await fn();
        throw new Error(`預期丟出 ${code}，但成功了`);
    } catch (e) {
        if (!(e instanceof FakeHttpsError)) throw e;
        assert.strictEqual(e.code, code, `預期 ${code}，實際 ${e.code}（${e.message}）`);
    }
}
const PAYMENT = {
    remitterName: '王小明', bank: '國泰世華', amount: '1250',
    lastFiveDigits: '12345', date: '2026-10-10', note: ''
};

(async () => {
console.log('appendOrderNote');

await t('訪客訂單（沒有 userId）可以回報匯款', async () => {
    store.set('o1', { orderNumber: 'BG20261010-ABCD', notes: '' });
    const res = await appendOrderNote({ data: { orderIds: ['o1'], kind: 'payment', payment: PAYMENT }, auth: null });
    assert.strictEqual(res.updated, 1);
    const notes = store.get('o1').notes;
    assert.ok(notes.startsWith('【匯款確認】'), '缺少【匯款確認】標記: ' + notes);
    assert.ok(notes.includes('匯款人姓名: 王小明'), notes);
    assert.ok(notes.includes('對帳後五碼: 12345'), notes);
    assert.ok(notes.includes('備註: 無'), '沒填備註時應顯示「無」: ' + notes);
    assert.ok(/確認時間: \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}/.test(notes), '確認時間格式不對: ' + notes);
});

await t('只會往後接，既有備註一定被完整保留（核心安全性質）', async () => {
    const original = '[2026/10/09 10:00:00] 顧客原本的重要備註\n\n【匯款確認】前一次回報的內容';
    store.set('o1', { orderNumber: 'BG1', notes: original });
    await appendOrderNote({ data: { orderIds: ['o1'], kind: 'payment', payment: PAYMENT }, auth: null });
    const after = store.get('o1').notes;
    assert.ok(after.startsWith(original), '既有備註被改動了！\n舊: ' + original + '\n新: ' + after);
    assert.ok(after.length > original.length, '沒有接上新內容');
    // 只寫 notes 這一個欄位，不會動到金額/狀態
    assert.deepStrictEqual(Object.keys(writeLog[0].data), ['notes']);
});

await t('網頁端送 notes 之外的欄位也沒用（只有 notes 會被寫入）', async () => {
    store.set('o1', { orderNumber: 'BG1', notes: '', total: 1250, status: 'pending', paymentConfirmed: false });
    await appendOrderNote({
        data: {
            orderIds: ['o1'], kind: 'payment', payment: PAYMENT,
            total: 1, status: 'completed', paymentConfirmed: true, notes: '整段覆蓋'
        },
        auth: null
    });
    const o = store.get('o1');
    assert.strictEqual(o.total, 1250, '金額被改掉了');
    assert.strictEqual(o.status, 'pending', '狀態被改掉了');
    assert.strictEqual(o.paymentConfirmed, false, 'paymentConfirmed 被改掉了');
    assert.ok(o.notes.startsWith('【匯款確認】'), o.notes);
});

await t('會員訂單：別人的 uid 會被擋下來', async () => {
    store.set('o1', { orderNumber: 'BG1', notes: '', userId: 'owner-uid' });
    await expectCode('permission-denied', () =>
        appendOrderNote({ data: { orderIds: ['o1'], kind: 'payment', payment: PAYMENT }, auth: { uid: 'attacker-uid' } }));
    assert.strictEqual(writeLog.length, 0, '被擋下來卻還是寫入了');
});

await t('會員訂單：未登入也會被擋下來', async () => {
    store.set('o1', { orderNumber: 'BG1', notes: '', userId: 'owner-uid' });
    await expectCode('permission-denied', () =>
        appendOrderNote({ data: { orderIds: ['o1'], kind: 'payment', payment: PAYMENT }, auth: null }));
});

await t('會員訂單：本人可以寫入', async () => {
    store.set('o1', { orderNumber: 'BG1', notes: '', userId: 'owner-uid' });
    const res = await appendOrderNote({ data: { orderIds: ['o1'], kind: 'payment', payment: PAYMENT }, auth: { uid: 'owner-uid' } });
    assert.strictEqual(res.updated, 1);
});

await t('合併匯款：多筆訂單都寫入，且訂單編號由伺服器自己組', async () => {
    store.set('a', { orderNumber: 'BG-AAA', notes: '', userId: 'u1' });
    store.set('b', { orderNumber: 'BG-BBB', notes: '舊備註', userId: 'u1' });
    const res = await appendOrderNote({
        data: { orderIds: ['a', 'b'], kind: 'mergePayment', payment: PAYMENT },
        auth: { uid: 'u1' }
    });
    assert.strictEqual(res.updated, 2);
    for (const id of ['a', 'b']) {
        const n = store.get(id).notes;
        assert.ok(n.includes('【合併匯款確認】'), id + ': ' + n);
        assert.ok(n.includes('合併訂單: BG-AAA、BG-BBB'), id + ' 的合併訂單清單不對: ' + n);
    }
    assert.ok(store.get('b').notes.startsWith('舊備註\n\n'), '舊備註沒被保留');
});

await t('合併匯款：其中一筆是別人的，整批都不寫入（全有或全無）', async () => {
    store.set('a', { orderNumber: 'BG-AAA', notes: '', userId: 'u1' });
    store.set('b', { orderNumber: 'BG-BBB', notes: '', userId: 'someone-else' });
    await expectCode('permission-denied', () =>
        appendOrderNote({ data: { orderIds: ['a', 'b'], kind: 'mergePayment', payment: PAYMENT }, auth: { uid: 'u1' } }));
    assert.strictEqual(writeLog.length, 0, '有一筆不能改，卻還是寫了其他筆');
});

await t('一般備註：加上時間戳、用單一換行接在後面', async () => {
    store.set('o1', { orderNumber: 'BG1', notes: '舊的', userId: 'u1' });
    await appendOrderNote({ data: { orderIds: ['o1'], kind: 'note', text: '  請幫我晚一週出貨  ' }, auth: { uid: 'u1' } });
    const n = store.get('o1').notes;
    assert.ok(n.startsWith('舊的\n['), '接法不對: ' + JSON.stringify(n));
    assert.ok(n.endsWith('] 請幫我晚一週出貨'), '內容沒有去掉頭尾空白: ' + JSON.stringify(n));
});

await t('一般備註不能一次針對多筆訂單', async () => {
    store.set('a', { orderNumber: 'BG-A', notes: '' });
    store.set('b', { orderNumber: 'BG-B', notes: '' });
    await expectCode('invalid-argument', () =>
        appendOrderNote({ data: { orderIds: ['a', 'b'], kind: 'note', text: 'hi' }, auth: { uid: 'u1' } }));
});

await t('找不到訂單 → not-found', async () => {
    await expectCode('not-found', () =>
        appendOrderNote({ data: { orderIds: ['nope'], kind: 'payment', payment: PAYMENT }, auth: null }));
});

await t('缺少必填匯款欄位 → invalid-argument', async () => {
    store.set('o1', { orderNumber: 'BG1', notes: '' });
    await expectCode('invalid-argument', () =>
        appendOrderNote({ data: { orderIds: ['o1'], kind: 'payment', payment: { ...PAYMENT, remitterName: '   ' } }, auth: null }));
});

await t('備註太長 → invalid-argument', async () => {
    store.set('o1', { orderNumber: 'BG1', notes: '', userId: 'u1' });
    await expectCode('invalid-argument', () =>
        appendOrderNote({ data: { orderIds: ['o1'], kind: 'note', text: 'x'.repeat(1001) }, auth: { uid: 'u1' } }));
});

await t('既有備註已經爆量 → resource-exhausted（擋住把文件撐爆）', async () => {
    store.set('o1', { orderNumber: 'BG1', notes: 'x'.repeat(20000), userId: 'u1' });
    await expectCode('resource-exhausted', () =>
        appendOrderNote({ data: { orderIds: ['o1'], kind: 'note', text: 'hi' }, auth: { uid: 'u1' } }));
});

await t('訂單筆數超過上限 → invalid-argument', async () => {
    const ids = [];
    for (let i = 0; i < 21; i++) { ids.push('o' + i); store.set('o' + i, { orderNumber: 'BG' + i, notes: '' }); }
    await expectCode('invalid-argument', () =>
        appendOrderNote({ data: { orderIds: ids, kind: 'mergePayment', payment: PAYMENT }, auth: { uid: 'u1' } }));
});

await t('重複的訂單 ID 會去重（不會對同一筆訂單接兩次）', async () => {
    store.set('o1', { orderNumber: 'BG1', notes: '' });
    const res = await appendOrderNote({ data: { orderIds: ['o1', 'o1', 'o1'], kind: 'payment', payment: PAYMENT }, auth: null });
    assert.strictEqual(res.updated, 1);
    assert.strictEqual(writeLog.length, 1);
    assert.strictEqual((store.get('o1').notes.match(/【匯款確認】/g) || []).length, 1);
});

await t('orderIds 空的 / 型別錯誤 / 含路徑分隔符 → invalid-argument', async () => {
    for (const ids of [[], null, 'o1', [''], [123], ['a/b'], ['../x']]) {
        await expectCode('invalid-argument', () =>
            appendOrderNote({ data: { orderIds: ids, kind: 'payment', payment: PAYMENT }, auth: null }));
    }
});

await t('kind 不合法 → invalid-argument', async () => {
    store.set('o1', { orderNumber: 'BG1', notes: '' });
    for (const kind of [undefined, 'delete', 'admin', '']) {
        await expectCode('invalid-argument', () =>
            appendOrderNote({ data: { orderIds: ['o1'], kind, payment: PAYMENT }, auth: null }));
    }
});

await t('備註標記跟 common.js 的 isPaymentReported 正則對得上', async () => {
    const isPaymentReported = (order) => {
        if (!order || order.paymentConfirmed === true) return false;
        return /【(合併)?匯款確認】/.test(order.notes || '');
    };
    store.set('o1', { orderNumber: 'BG1', notes: '', paymentConfirmed: false });
    store.set('o2', { orderNumber: 'BG2', notes: '', paymentConfirmed: false, userId: 'u1' });
    await appendOrderNote({ data: { orderIds: ['o1'], kind: 'payment', payment: PAYMENT }, auth: null });
    await appendOrderNote({ data: { orderIds: ['o2'], kind: 'mergePayment', payment: PAYMENT }, auth: { uid: 'u1' } });
    assert.ok(isPaymentReported(store.get('o1')), '單筆匯款確認沒被認出來');
    assert.ok(isPaymentReported(store.get('o2')), '合併匯款確認沒被認出來');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})();
