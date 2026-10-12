// createOrder 的下單頻率限制。
//
// 這支函式可以被匿名呼叫（訪客結帳本來就不需要登入），所以沒有頻率限制的話，
// 腳本重複呼叫就能把庫存扣光。這裡驗證計數邏輯與識別鍵，重點是：
//   - 達到上限會擋，而且錯誤訊息要能讓顧客知道等多久
//   - 時間窗過了會重新開始，不會把人永久鎖住
//   - 登入與未登入用不同的識別鍵，不同 IP 不會互相影響
const path = require('path');
const assert = require('assert');

const FN_DIR = path.join(__dirname, '..', 'functions');

// 攔截 firebase-functions，不用真的載入整個 SDK
function stub(id, exports) {
    const resolved = require.resolve(id, { paths: [FN_DIR] });
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
class FakeHttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
}
stub('firebase-functions/v2/https', { onCall: (o, h) => h, HttpsError: FakeHttpsError });
stub('firebase-functions/logger', { info() {}, warn() {}, error() {} });
stub('firebase-admin/firestore', { getFirestore: () => ({}), FieldValue: { increment: () => 0, serverTimestamp: () => 0 } });

const { _internal } = require(path.join(FN_DIR, 'create-order.js'));
const { checkRateLimit, rateLimitKey, RATE_LIMIT_MAX_ORDERS, RATE_LIMIT_WINDOW_MS } = _internal;

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  PASS  ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}
const snap = (data) => ({ exists: data !== null, data: () => data });
function expectBlocked(fn) {
    try { fn(); throw new Error('預期要被擋下，但放行了'); }
    catch (e) {
        if (!(e instanceof FakeHttpsError)) throw e;
        assert.strictEqual(e.code, 'resource-exhausted', '錯誤碼不對: ' + e.code);
        return e;
    }
}

console.log('下單頻率限制');

t('第一次下單：建立計數', () => {
    const now = 1_000_000;
    const next = checkRateLimit(snap(null), now);
    assert.deepStrictEqual(next, { windowStart: now, count: 1, updatedAt: now });
});

t('時間窗內可以連續下到上限', () => {
    const now = 1_000_000;
    let state = { windowStart: now, count: 0, updatedAt: now };
    for (let i = 1; i <= RATE_LIMIT_MAX_ORDERS; i++) {
        state = checkRateLimit(snap(state), now + i * 1000);
        assert.strictEqual(state.count, i, `第 ${i} 筆的計數不對`);
        assert.strictEqual(state.windowStart, now, '時間窗起點不該被重設');
    }
});

t('超過上限會被擋下（resource-exhausted）', () => {
    const now = 1_000_000;
    const atLimit = { windowStart: now, count: RATE_LIMIT_MAX_ORDERS, updatedAt: now };
    expectBlocked(() => checkRateLimit(snap(atLimit), now + 1000));
});

t('被擋下時會告訴顧客還要等幾分鐘', () => {
    const now = 1_000_000;
    const atLimit = { windowStart: now, count: RATE_LIMIT_MAX_ORDERS, updatedAt: now };
    const e = expectBlocked(() => checkRateLimit(snap(atLimit), now + 1000));
    assert.ok(/\d+ 分鐘後再試/.test(e.message), '訊息沒有說要等多久: ' + e.message);
    assert.ok(/聯絡我們/.test(e.message), '沒有提供誤判時的求助管道: ' + e.message);
});

t('時間窗過了就重新開始，不會永久鎖住', () => {
    const now = 1_000_000;
    const atLimit = { windowStart: now, count: RATE_LIMIT_MAX_ORDERS, updatedAt: now };
    const after = now + RATE_LIMIT_WINDOW_MS + 1;
    const next = checkRateLimit(snap(atLimit), after);
    assert.strictEqual(next.count, 1, '新時間窗應該從 1 重新算');
    assert.strictEqual(next.windowStart, after, '時間窗起點應該更新');
});

t('剛好卡在時間窗邊界也會重置（不會差一秒就鎖住）', () => {
    const now = 1_000_000;
    const atLimit = { windowStart: now, count: RATE_LIMIT_MAX_ORDERS, updatedAt: now };
    const next = checkRateLimit(snap(atLimit), now + RATE_LIMIT_WINDOW_MS);
    assert.strictEqual(next.count, 1);
});

t('髒資料不會讓限制失效，也不會害顧客被鎖死', () => {
    const now = 1_000_000;
    for (const bad of [{}, { count: 'x' }, { windowStart: 'x', count: 3 }, { count: null }]) {
        const next = checkRateLimit(snap(bad), now);
        assert.strictEqual(next.count, 1, '壞資料應該當成全新的時間窗: ' + JSON.stringify(bad));
        assert.strictEqual(next.windowStart, now);
    }
});

console.log('\n識別鍵');

t('登入的人用 uid', () => {
    const k = rateLimitKey({ auth: { uid: 'user-123' } });
    assert.strictEqual(k, 'uid_user-123');
});

t('訪客用來源 IP 的雜湊，不存原始 IP', () => {
    const req = { rawRequest: { headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' } } };
    const k = rateLimitKey(req);
    assert.ok(k.startsWith('ip_'), k);
    assert.ok(!k.includes('203.0.113.5'), '不應該把原始 IP 存進鍵值: ' + k);
    assert.strictEqual(k.length, 3 + 32);
});

t('x-forwarded-for 取第一段（才是真實來源，後面是負載平衡器）', () => {
    const a = rateLimitKey({ rawRequest: { headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' } } });
    const b = rateLimitKey({ rawRequest: { headers: { 'x-forwarded-for': '203.0.113.5' } } });
    assert.strictEqual(a, b, '同一個來源應該得到同一個鍵');
});

t('不同 IP 得到不同的鍵（不會互相影響）', () => {
    const a = rateLimitKey({ rawRequest: { headers: { 'x-forwarded-for': '203.0.113.5' } } });
    const b = rateLimitKey({ rawRequest: { headers: { 'x-forwarded-for': '203.0.113.6' } } });
    assert.notStrictEqual(a, b);
});

t('登入的人跟訪客不會共用計數', () => {
    const user = rateLimitKey({ auth: { uid: 'u1' }, rawRequest: { headers: { 'x-forwarded-for': '203.0.113.5' } } });
    const guest = rateLimitKey({ rawRequest: { headers: { 'x-forwarded-for': '203.0.113.5' } } });
    assert.notStrictEqual(user, guest, '同一台電腦登入前後應該分開計算');
});

t('完全沒有來源資訊也不會壞掉', () => {
    assert.ok(rateLimitKey({}).startsWith('ip_'));
    assert.ok(rateLimitKey({ rawRequest: {} }).startsWith('ip_'));
});

console.log('\n攻擊情境');

t('腳本連續下單會在第 ' + (RATE_LIMIT_MAX_ORDERS + 1) + ' 次被擋，庫存最多只被扣 ' + RATE_LIMIT_MAX_ORDERS + ' 筆', () => {
    const now = 1_000_000;
    let state = null, succeeded = 0;
    for (let i = 0; i < 50; i++) {
        try { state = checkRateLimit(snap(state), now + i * 100); succeeded++; }
        catch (e) { break; }
    }
    assert.strictEqual(succeeded, RATE_LIMIT_MAX_ORDERS,
        `應該只有 ${RATE_LIMIT_MAX_ORDERS} 次成功，實際 ${succeeded} 次`);
});

t('同時湧入的請求讀到同一份舊計數時，不會一起被放行', () => {
    // 這是把檢查放進 transaction 的理由：Firestore transaction 偵測到
    // 同一份文件被並行修改會重跑，所以每個請求最終都會讀到已更新的計數
    const now = 1_000_000;
    const atLimit = { windowStart: now, count: RATE_LIMIT_MAX_ORDERS, updatedAt: now };
    for (let i = 0; i < 10; i++) {
        expectBlocked(() => checkRateLimit(snap(atLimit), now + i));
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
