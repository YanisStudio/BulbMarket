// 聯絡我們（contact.html）
// - 送出的欄位、長度要跟 Firestore 規則（firestore.rules 的 validNewMessage）一致，
//   不然顧客按送出會被規則擋下、只看到「發送諮詢時出錯」
// - 會員送出後保留姓名／信箱／電話，成功視窗有「我的訊息」連結而且不會自動關掉
// - 訪客送出後整份清空
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const rules = read('firestore.rules');
const ruleFn = rules.slice(rules.indexOf('function validNewMessage'), rules.indexOf('match /messages/'));
const allowedKeys = JSON.parse(ruleFn.match(/hasOnly\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
const ruleMax = (field) => Number(ruleFn.match(new RegExp(`d(?:\\.${field}|\\.get\\('${field}', ''\\))\\.size\\(\\) <= (\\d+)`))[1]);

function loadContact({ user = null } = {}) {
    const html = read('contact.html');
    const body = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' + html.slice(html.indexOf('<body>'));
    const dom = new JSDOM(body, { runScripts: 'outside-only', url: 'https://flowerbulb.tw/contact.html', virtualConsole: new VirtualConsole() });
    const { window } = dom;
    const written = [];
    window.firebaseServices = {
        db: {}, auth: { currentUser: user },
        onAuthStateChanged: (a, cb) => { setTimeout(() => cb(user), 0); return () => {}; },
        doc: (db, col, id) => ({ col, id }),
        getDoc: async () => ({ exists: () => true, data: () => ({ name: '王小明', phone: '0912345678' }) }),
        collection: (db, name) => ({ name }),
        serverTimestamp: () => '__serverTimestamp__',
        addDoc: async (col, data) => { written.push({ col: col.name, data }); return { id: 'm1' }; },
    };
    window.eval(read('js/common.js'));
    window.initCommonFeatures = () => {};
    window.showToast = () => {};
    window.eval(html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1]);
    if (window.document.readyState !== 'loading') window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    const $ = (id) => window.document.getElementById(id);
    const submit = () => $('contact-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    const fill = () => { $('name').value = '王小明'; $('email').value = 'a@b.c'; $('phone').value = '0912345678'; $('subject').value = '商品訂購'; $('message').value = '請問什麼時候到貨？'; };
    return { window, $, written, submit, fill };
}

let pass = 0, fail = 0;
async function t(name, fn) {
    try { await fn(); pass++; console.log('  PASS  ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}

console.log('聯絡我們');

await t('表單欄位的 maxlength 跟 Firestore 規則的長度上限一致', async () => {
    const { $ } = loadContact();
    for (const field of ['name', 'email', 'phone', 'message']) {
        assert.strictEqual(Number($(field).getAttribute('maxlength')), ruleMax(field), `${field}：表單 ${$(field).getAttribute('maxlength')}，規則 ${ruleMax(field)}`);
    }
});

await t('訪客送出：寫入的欄位都在規則允許的清單裡，read=false、用伺服器時間', async () => {
    const page = loadContact();
    await wait(20); // 等頁面初始化（綁定送出事件）
    page.fill();
    page.submit();
    await wait(20);
    assert.strictEqual(page.written.length, 1);
    const { col, data } = page.written[0];
    assert.strictEqual(col, 'messages');
    Object.keys(data).forEach((k) => assert.ok(allowedKeys.includes(k), `欄位 ${k} 不在規則允許的清單（${allowedKeys.join('、')}）`));
    assert.strictEqual(data.read, false);
    assert.strictEqual(data.createdAt, '__serverTimestamp__');
    assert.ok(!('userId' in data), '訪客不能帶 userId');
});

await t('訪客送出後整份清空，成功視窗沒有「我的訊息」，會自動關閉', async () => {
    const page = loadContact();
    await wait(20); // 等頁面初始化（綁定送出事件）
    page.fill();
    page.submit();
    await wait(20);
    assert.strictEqual(page.$('name').value, '');
    assert.strictEqual(page.$('message').value, '');
    const dialog = page.window.document.querySelector('.contact-success-message');
    assert.ok(dialog && !dialog.querySelector('a[href="/messages.html"]'));
});

await t('會員送出：帶自己的 userId；保留姓名／信箱／電話，只清主題和內容；成功視窗有「我的訊息」', async () => {
    const page = loadContact({ user: { uid: 'u1', email: 'a@b.c' } });
    await wait(20); // 等自動帶入
    page.fill();
    page.submit();
    await wait(20);
    assert.strictEqual(page.written[0].data.userId, 'u1');
    assert.strictEqual(page.$('name').value, '王小明');
    assert.strictEqual(page.$('email').value, 'a@b.c');
    assert.strictEqual(page.$('phone').value, '0912345678');
    assert.strictEqual(page.$('subject').value, '');
    assert.strictEqual(page.$('message').value, '');
    const dialog = page.window.document.querySelector('.contact-success-message');
    assert.ok(dialog.querySelector('a[href="/messages.html"]'), '沒有「我的訊息」連結');
});

await t('手機版表單一欄一個（兩欄時「諮詢主題」會被切掉）', async () => {
    const css = read('css/style.css');
    assert.ok(/@media \(max-width: 600px\) \{\s*\.contact-form \{\s*grid-template-columns: 1fr;/.test(css));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
