// 用 Firebase Rules API 的 :test 方法，對「線上實際發布的規則」跑完整權限矩陣。
// 完全不碰正式資料：這個 API 只做規則運算，不讀寫 Firestore。
import fs from 'node:fs';

const PROJECT = 'bulb-market-217c4';
const TOKEN = process.argv[2];
const RULES = fs.readFileSync(process.argv[3], 'utf8');
const DB = `/databases/(default)/documents`;

// ---- 身分 ----
const guest = null;
const cust = { uid: 'cust-1', token: { email: 'cust@example.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } } };
const custUnverified = { uid: 'cust-2', token: { email: 'cust2@example.com', email_verified: false } };
const custPhone = { uid: 'cust-3', token: { phone_number: '+886912345678' } };
const other = { uid: 'other-9', token: { email: 'other@example.com', email_verified: true } };
const admin = { uid: 'admin-1', token: { admin: true, email: 'admin@example.com', email_verified: true } };

// ---- 範例文件 ----
const guestOrder = { customer: { name: '王小明', phone: '0911222333', email: 'guest@example.com' }, total: 1250, status: 'pending', notes: '原本的備註', paymentConfirmed: false };
const myOrder = { ...guestOrder, userId: 'cust-1', customer: { ...guestOrder.customer, email: 'cust@example.com' } };
const myPhoneOrder = { ...guestOrder, customer: { ...guestOrder.customer, phone: '0912345678' } };
const othersOrder = { ...guestOrder, userId: 'other-9', customer: { ...guestOrder.customer, email: 'other@example.com' } };

const cases = [];
function T(group, name, expectation, auth, method, path, resourceData, requestData) {
    const request = { path: DB + path, method };
    if (auth) request.auth = auth;
    if (requestData) request.resource = { data: requestData };
    const tc = { expectation, request };
    if (resourceData) tc.resource = { data: resourceData };
    cases.push({ group, name, tc });
}

// ========== 訪客（未登入）：顧客瀏覽與下單前置 ==========
T('訪客瀏覽', '看商品列表', 'ALLOW', guest, 'list', '/products/p1');
T('訪客瀏覽', '看單一商品', 'ALLOW', guest, 'get', '/products/p1');
T('訪客瀏覽', '讀分類設定', 'ALLOW', guest, 'get', '/settings/categories');
T('訪客瀏覽', '讀首頁輪播', 'ALLOW', guest, 'get', '/settings/bulletin');
T('訪客瀏覽', '讀栽培小知識', 'ALLOW', guest, 'get', '/settings/knowledge');
T('訪客瀏覽', '讀免運設定', 'ALLOW', guest, 'get', '/shippingSettings/freeShipping');
T('訪客瀏覽', '讀運費計算模式', 'ALLOW', guest, 'get', '/shippingSettings/calculationMode');
T('訪客瀏覽', '讀固定運費', 'ALLOW', guest, 'get', '/shippingRates/fixedRates');
T('訪客瀏覽', '讀階梯運費', 'ALLOW', guest, 'list', '/tieredRates/t1');

// ========== 訪客：訂單完成頁 ==========
T('訪客訂單', '用訂單ID讀自己剛下的單（訂單完成頁必須能讀）', 'ALLOW', guest, 'get', '/orders/o-guest', guestOrder);
T('訪客訂單', '不能列出所有訂單', 'DENY', guest, 'list', '/orders/o-guest', guestOrder);
T('訪客訂單', '不能直接建立訂單（必須走 createOrder）', 'DENY', guest, 'create', '/orders/o-new', null, guestOrder);
T('訪客訂單', '不能直接改備註（已修正的漏洞）', 'DENY', guest, 'update', '/orders/o-guest', guestOrder, { ...guestOrder, notes: '被覆寫' });
T('訪客訂單', '不能偽造已付款', 'DENY', guest, 'update', '/orders/o-guest', guestOrder, { ...guestOrder, paymentConfirmed: true });
T('訪客訂單', '不能刪訂單', 'DENY', guest, 'delete', '/orders/o-guest', guestOrder);

// ========== 訪客：聯絡我們 ==========
T('聯絡我們', '訪客送出諮詢', 'ALLOW', guest, 'create', '/messages/m1', null, { name: '王', email: 'a@b.c', subject: 's', message: 'm', read: false });
T('聯絡我們', '不能自己標成已讀', 'DENY', guest, 'create', '/messages/m1', null, { name: '王', email: 'a@b.c', message: 'm', read: true });
T('聯絡我們', '不能自己塞商家回覆', 'DENY', guest, 'create', '/messages/m1', null, { name: '王', email: 'a@b.c', message: 'm', read: false, reply: '假回覆' });
T('聯絡我們', '不能冒用他人 userId 送訊息', 'DENY', guest, 'create', '/messages/m1', null, { name: '王', message: 'm', read: false, userId: 'cust-1' });
T('聯絡我們', '訪客不能讀訊息', 'DENY', guest, 'get', '/messages/m1', { userId: 'cust-1', message: 'm' });

// ========== 訪客：不該碰的 ==========
T('訪客禁區', '不能改商品', 'DENY', guest, 'update', '/products/p1', { name: 'x', price: 100 }, { name: 'x', price: 1 });
T('訪客禁區', '不能改運費', 'DENY', guest, 'update', '/shippingRates/fixedRates', { home: 130 }, { home: 0 });
T('訪客禁區', '不能改網站設定', 'DENY', guest, 'update', '/settings/categories', { items: [] }, { items: [] });
T('訪客禁區', '不能讀會員資料', 'DENY', guest, 'get', '/users/cust-1', { name: '王', phone: '0911' });
T('訪客禁區', '不能讀未知集合', 'DENY', guest, 'get', '/secretStuff/x', { a: 1 });
T('訪客禁區', '不能寫未知集合', 'DENY', guest, 'create', '/secretStuff/x', null, { a: 1 });

// ========== 登入會員：訂單記錄頁 ==========
T('會員訂單', '用 userId 列出自己的訂單', 'ALLOW', cust, 'list', '/orders/o-mine', myOrder);
T('會員訂單', '用已驗證信箱列出以訪客身分下的單', 'ALLOW', cust, 'list', '/orders/o-byemail', { ...guestOrder, customer: { ...guestOrder.customer, email: 'cust@example.com' } });
T('會員訂單', '不能列出別人的訂單', 'DENY', cust, 'list', '/orders/o-others', othersOrder);
T('會員訂單', '信箱未驗證不能用信箱查單', 'DENY', custUnverified, 'list', '/orders/o-x', { ...guestOrder, customer: { ...guestOrder.customer, email: 'cust2@example.com' } });
T('會員訂單', '手機登入用電話查自己的單', 'ALLOW', custPhone, 'list', '/orders/o-phone', myPhoneOrder);
T('會員訂單', '不能直接改自己訂單的備註（改走 appendOrderNote）', 'DENY', cust, 'update', '/orders/o-mine', myOrder, { ...myOrder, notes: '直接寫' });
T('會員訂單', '不能改別人訂單的備註', 'DENY', cust, 'update', '/orders/o-others', othersOrder, { ...othersOrder, notes: '亂改' });
T('會員訂單', '不能改自己訂單的金額', 'DENY', cust, 'update', '/orders/o-mine', myOrder, { ...myOrder, total: 1 });
T('會員訂單', '不能刪自己的訂單', 'DENY', cust, 'delete', '/orders/o-mine', myOrder);

// ========== 登入會員：會員資料頁 ==========
T('會員資料', '讀自己的資料', 'ALLOW', cust, 'get', '/users/cust-1', { name: '王', phone: '0911' });
T('會員資料', '改自己的資料', 'ALLOW', cust, 'update', '/users/cust-1', { name: '王' }, { name: '王大明', phone: '0922' });
T('會員資料', '建立自己的資料', 'ALLOW', cust, 'create', '/users/cust-1', null, { name: '王', email: 'cust@example.com' });
T('會員資料', '不能讀別人的資料', 'DENY', cust, 'get', '/users/other-9', { name: '李' });
T('會員資料', '不能改別人的資料', 'DENY', cust, 'update', '/users/other-9', { name: '李' }, { name: '被改' });

// ========== 登入會員：我的訊息 ==========
T('會員訊息', '讀自己送的訊息', 'ALLOW', cust, 'get', '/messages/m-mine', { userId: 'cust-1', message: 'm' });
T('會員訊息', '列出自己送的訊息', 'ALLOW', cust, 'list', '/messages/m-mine', { userId: 'cust-1', message: 'm' });
T('會員訊息', '不能讀別人的訊息', 'DENY', cust, 'get', '/messages/m-others', { userId: 'other-9', message: 'm' });
T('會員訊息', '帶自己 userId 送訊息', 'ALLOW', cust, 'create', '/messages/m2', null, { name: '王', message: 'm', read: false, userId: 'cust-1' });
T('會員訊息', '不能自己改訊息', 'DENY', cust, 'update', '/messages/m-mine', { userId: 'cust-1', message: 'm' }, { userId: 'cust-1', message: '改' });

// ========== 管理員：後台所有操作 ==========
T('管理員訂單', '列出所有訂單', 'ALLOW', admin, 'list', '/orders/o-any', guestOrder);
T('管理員訂單', '讀任一訂單', 'ALLOW', admin, 'get', '/orders/o-any', guestOrder);
T('管理員訂單', '改狀態為已付款', 'ALLOW', admin, 'update', '/orders/o-any', guestOrder, { ...guestOrder, status: 'confirmed', paymentConfirmed: true });
T('管理員訂單', '改回未付款並清除 paymentConfirmed', 'ALLOW', admin, 'update', '/orders/o-any', { ...guestOrder, paymentConfirmed: true }, { ...guestOrder, status: 'pending', paymentConfirmed: false });
T('管理員訂單', '編輯收件人與運費', 'ALLOW', admin, 'update', '/orders/o-any', guestOrder, { ...guestOrder, shippingFee: 130, total: 1380 });
T('管理員訂單', '加管理員備註', 'ALLOW', admin, 'update', '/orders/o-any', guestOrder, { ...guestOrder, notes: '原本的備註\n[管理員] 已出貨' });
T('管理員訂單', '刪除訂單', 'ALLOW', admin, 'delete', '/orders/o-any', guestOrder);
T('管理員訂單', '仍然不能直接建立訂單（一律走 createOrder）', 'DENY', admin, 'create', '/orders/o-new', null, guestOrder);

T('管理員商品', '新增商品', 'ALLOW', admin, 'create', '/products/p-new', null, { name: '百合', price: 120, stock: 10, status: 'active' });
T('管理員商品', '改商品（含庫存）', 'ALLOW', admin, 'update', '/products/p1', { stock: 10 }, { stock: 5 });
T('管理員商品', '刪商品', 'ALLOW', admin, 'delete', '/products/p1', { name: 'x' });

T('管理員設定', '改分類', 'ALLOW', admin, 'update', '/settings/categories', { items: [] }, { items: [{ id: 'lily', name: '百合' }] });
T('管理員設定', '改輪播', 'ALLOW', admin, 'update', '/settings/bulletin', { items: [] }, { items: [{ imageUrl: 'x' }] });
T('管理員設定', '改栽培小知識', 'ALLOW', admin, 'update', '/settings/knowledge', { articles: [] }, { articles: [{ id: 'k1', title: 't' }] });
T('管理員設定', '改免運門檻', 'ALLOW', admin, 'update', '/shippingSettings/freeShipping', { enabled: false }, { enabled: true, threshold: 1000 });
T('管理員設定', '改固定運費', 'ALLOW', admin, 'update', '/shippingRates/fixedRates', { home: 130 }, { home: 150, store: 60 });
T('管理員設定', '新增階梯運費', 'ALLOW', admin, 'create', '/tieredRates/t-new', null, { method: 'store', category: 'bulbs', minQuantity: 1, maxQuantity: 5, fee: 60 });
T('管理員設定', '刪階梯運費', 'ALLOW', admin, 'delete', '/tieredRates/t1', { fee: 60 });

T('管理員會員', '讀任一會員資料', 'ALLOW', admin, 'get', '/users/cust-1', { name: '王' });
T('管理員會員', '列出所有會員', 'ALLOW', admin, 'list', '/users/cust-1', { name: '王' });
T('管理員會員', '改會員資料', 'ALLOW', admin, 'update', '/users/cust-1', { name: '王' }, { name: '王大明' });

T('管理員訊息', '讀所有訊息', 'ALLOW', admin, 'list', '/messages/m1', { message: 'm' });
T('管理員訊息', '回覆訊息', 'ALLOW', admin, 'update', '/messages/m1', { message: 'm', read: false }, { message: 'm', read: true, reply: '感謝來訊' });
T('管理員訊息', '刪訊息', 'ALLOW', admin, 'delete', '/messages/m1', { message: 'm' });

T('管理員其他', '商品頁寫入測試', 'ALLOW', admin, 'create', '/test_writes/t1', null, { at: 1 });
T('管理員其他', '未知集合一樣拒絕', 'DENY', admin, 'get', '/secretStuff/x', { a: 1 });

// ---- 送出 ----
const H = { Authorization: 'Bearer ' + TOKEN, 'x-goog-user-project': PROJECT, 'Content-Type': 'application/json' };
const body = {
    source: { files: [{ name: 'firestore.rules', content: RULES }] },
    testSuite: { testCases: cases.map((c) => c.tc) }
};

const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, {
    method: 'POST', headers: H, body: JSON.stringify(body)
}).then((r) => r.json());

if (res.error) {
    console.error('API 錯誤:', res.error.message);
    process.exit(1);
}
if (res.issues && res.issues.length) {
    console.log('⚠️ 規則本身有問題：');
    res.issues.forEach((i) => console.log('  ', i.severity, i.description, JSON.stringify(i.sourcePosition || {})));
}

const results = res.testResults || [];
let pass = 0, fail = 0, lastGroup = '';
const failures = [];
results.forEach((r, i) => {
    const c = cases[i];
    const ok = r.state === 'SUCCESS';
    if (c.group !== lastGroup) { console.log(`\n【${c.group}】`); lastGroup = c.group; }
    const mark = ok ? 'PASS' : 'FAIL';
    console.log(`  ${mark}  [${c.tc.expectation}] ${c.name}`);
    if (ok) pass++; else { fail++; failures.push({ c, r }); }
});

console.log(`\n${'='.repeat(60)}`);
console.log(`共 ${results.length} 項：${pass} 通過，${fail} 失敗`);
if (fail) {
    console.log('\n失敗明細：');
    failures.forEach(({ c, r }) => {
        console.log(`  - 【${c.group}】${c.name}`);
        console.log(`    預期 ${c.tc.expectation}，實際相反`);
        (r.debugMessages || []).slice(0, 2).forEach((m) => console.log('    ' + m.replace(/\n/g, ' ')));
    });
}
process.exit(fail ? 1 : 0);
