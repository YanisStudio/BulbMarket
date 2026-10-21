// 會員中心三頁（會員資料／訂單記錄／我的訊息）
// - 我的訊息：卡片內容（主題、狀態、您的訊息、商家回覆）、沒有訊息、讀取失敗可重試
// - 登入後內容區不能設成 display: block（會蓋掉 CSS 的 flex，電腦版選單獨佔一整排）
// - 三頁都引入共用的 css/member-center.css；<main> 裡的 div 開闔數量要對得上
//   （訂單記錄以前多一層 div，「需要幫助？」被包進左右兩欄變成第三欄）
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = (iso) => ({ toDate: () => new Date(iso) });

function fakeServices(messages) {
    const state = { failReads: false, reads: 0 };
    const user = { uid: 'u1' };
    return {
        state,
        services: {
            db: {}, auth: { currentUser: user },
            collection: (db, name) => ({ name }), query: (col, ...cs) => ({ col, cs }),
            where: (field, op, value) => ({ field, op, value }),
            onAuthStateChanged: (a, cb) => { setTimeout(() => cb(user), 0); return () => {}; },
            getDocsFromServer: async (q) => {
                state.reads++;
                if (state.failReads) { const e = new Error('offline'); e.code = 'unavailable'; throw e; }
                const mine = messages.filter((m) => m.userId === q.cs[0].value);
                return { empty: mine.length === 0, forEach: (fn) => mine.forEach((m, i) => fn({ id: 'm' + i, data: () => m })) };
            },
        },
    };
}

function loadMessages(fake) {
    const html = read('messages.html');
    const body = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' + html.slice(html.indexOf('<body>'));
    const dom = new JSDOM(body, { runScripts: 'outside-only', url: 'https://flowerbulb.tw/messages.html' });
    const { window } = dom;
    window.console.error = () => {};
    window.console.log = () => {};
    window.firebaseServices = fake.services;
    window.eval(read('js/common.js'));
    window.initCommonFeatures = () => {};
    window.eval(html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1]);
    if (window.document.readyState !== 'loading') window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    return { window, $: (id) => window.document.getElementById(id), document: window.document };
}

const SAMPLE = [
    { userId: 'u1', subject: '種植技術', message: '請問鬱金香要冷藏嗎？\n要多久？', createdAt: ts('2026-10-21T20:15:00+08:00') },
    { userId: 'u1', subject: '商品訂購', message: '孤挺花什麼時候到貨？', reply: '預計 11 月中旬。\n到貨會公告。', createdAt: ts('2026-10-18T09:30:00+08:00'), repliedAt: ts('2026-10-18T14:05:00+08:00') },
    { userId: 'other', subject: '別人的', message: '不應該出現', createdAt: ts('2026-10-22T09:00:00+08:00') },
    { userId: 'u1', subject: '<b>壞掉的主旨</b>', message: '<img src=x onerror=alert(1)>', createdAt: ts('2026-10-01T09:00:00+08:00') },
];

let pass = 0, fail = 0;
async function t(name, fn) {
    try { await fn(); pass++; console.log('  PASS  ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}

console.log('我的訊息');

await t('登入後內容區清掉 display（交給 CSS 的 flex），不是設成 block', async () => {
    const page = loadMessages(fakeServices(SAMPLE));
    await wait(50);
    assert.strictEqual(page.$('messages-content').style.display, '');
    assert.strictEqual(page.$('not-logged-in').style.display, 'none');
});

await t('訊息卡片：新到舊、只列自己的、主題／狀態／您的訊息／商家回覆', async () => {
    const page = loadMessages(fakeServices(SAMPLE));
    await wait(50);
    const cards = [...page.document.querySelectorAll('.message-card')];
    assert.strictEqual(cards.length, 3, '應該只有自己的 3 則');
    assert.ok(!page.$('message-list').textContent.includes('不應該出現'));
    const [first, second] = cards;
    assert.strictEqual(first.querySelector('h3').textContent, '種植技術');
    assert.ok(first.classList.contains('is-pending'));
    assert.strictEqual(first.querySelector('.message-status-badge').textContent, '待回覆');
    assert.strictEqual(first.querySelector('.message-bubble-mine p').textContent, '請問鬱金香要冷藏嗎？\n要多久？', '換行要保留（CSS pre-wrap）');
    assert.ok(/會寄 Email 通知您/.test(first.querySelector('.message-pending-hint').textContent));
    assert.ok(second.classList.contains('is-replied'));
    assert.strictEqual(second.querySelector('.message-status-badge').textContent, '已回覆');
    assert.strictEqual(second.querySelector('.message-bubble-reply p').textContent, '預計 11 月中旬。\n到貨會公告。');
    assert.ok(/2026\/10\/18/.test(second.querySelector('.message-bubble-time').textContent));
    assert.ok(!/:\d\d:\d\d/.test(first.querySelector('.message-card-date').textContent), '時間不要顯示到秒');
});

await t('內容一律跳脫，不會被當成 HTML', async () => {
    const page = loadMessages(fakeServices(SAMPLE));
    await wait(50);
    assert.strictEqual(page.document.querySelector('.message-list img, #message-list img'), null);
    assert.ok(page.$('message-list').textContent.includes('<b>壞掉的主旨</b>'));
});

await t('上方顯示訊息數量、待回覆數量和「傳送新訊息」', async () => {
    const page = loadMessages(fakeServices(SAMPLE));
    await wait(50);
    assert.strictEqual(page.$('messages-summary').textContent, '共 3 則訊息，2 則待回覆');
    assert.strictEqual(page.$('messages-toolbar').querySelector('a').getAttribute('href'), '/contact.html');
    assert.notStrictEqual(page.$('messages-toolbar').style.display, 'none');
});

await t('沒有訊息：顯示說明和「傳送訊息給我們」，上方那排收起來', async () => {
    const page = loadMessages(fakeServices([]));
    await wait(50);
    assert.ok(/還沒有傳送過訊息/.test(page.$('message-list').textContent));
    assert.strictEqual(page.$('message-list').querySelector('a.btn').getAttribute('href'), '/contact.html');
    assert.strictEqual(page.$('messages-toolbar').style.display, 'none');
});

await t('讀取失敗：顯示連線問題＋重新載入，按下去重讀成功', async () => {
    const fake = fakeServices(SAMPLE);
    fake.state.failReads = true;
    const page = loadMessages(fake);
    await wait(50);
    assert.ok(/網路連線不穩定/.test(page.$('message-list').textContent));
    fake.state.failReads = false;
    page.$('messages-retry-btn').click();
    await wait(50);
    assert.strictEqual(page.document.querySelectorAll('.message-card').length, 3);
    assert.strictEqual(fake.state.reads, 2);
});

console.log('\n三頁共用');

await t('訂單記錄：登入後內容區也是清掉 display，不是設成 block', async () => {
    const src = read('orders.html');
    assert.ok(src.includes("ordersContentSection.style.display = '';"));
    assert.ok(!src.includes("ordersContentSection.style.display = 'block'"));
});

await t('三頁都在 storefront.css 之後引入 css/member-center.css', async () => {
    for (const f of ['profile.html', 'orders.html', 'messages.html']) {
        const src = read(f);
        const a = src.indexOf('href="/css/storefront.css"'), b = src.indexOf('href="/css/member-center.css"');
        assert.ok(a > 0 && b > a, f);
    }
    const css = read('css/member-center.css');
    ['.profile-content,\n.orders-content', '.product-hero.profile-banner', '.profile-menu ul'].forEach((s) => assert.ok(css.includes(s), s));
});

await t('<main> 裡的 div 開闔數量對得上（說明區塊不會被包進左右兩欄）', async () => {
    for (const f of ['profile.html', 'orders.html', 'messages.html']) {
        const src = read(f);
        const main = src.slice(src.indexOf('<main>'), src.indexOf('</main>')).replace(/<!--[\s\S]*?-->/g, '');
        const open = (main.match(/<div\b/g) || []).length, close = (main.match(/<\/div>/g) || []).length;
        assert.strictEqual(open, close, `${f}：${open} 個 <div>、${close} 個 </div>`);
    }
    // 實際用瀏覽器解析：訂單記錄的「需要幫助？」不能在內容區裡面
    const html = read('orders.html');
    const doc = new JSDOM(html.slice(html.indexOf('<body>'))).window.document;
    assert.strictEqual(doc.querySelector('#orders-content .help-section'), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
