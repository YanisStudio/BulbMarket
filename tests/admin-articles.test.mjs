// 後台「內容管理」的兩個文章分頁（栽培小知識、加入會員）共用 js/admin-knowledge.js 的編輯器。
// 驗證兩份編輯器各自讀寫自己的文件（settings/knowledge、settings/membership），
// 元素 id 不會互相干擾，也不會把文章寫到另一個分頁去。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const html = read('admin/bulletin.html');
const body = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' + html.slice(html.indexOf('<body>'));
const dom = new JSDOM(body, { runScripts: 'outside-only', url: 'https://flowerbulb.tw/admin/bulletin.html' });
const { window } = dom;
const { document } = window;
window.console.error = () => {};
window.confirm = () => true;
window.HTMLElement.prototype.scrollIntoView = () => {}; // jsdom 沒有實作捲動

const db = {
    knowledge: { articles: [{ id: 'k1', title: '孤挺花栽培指南', category: '種植指南', date: '2026-09-29', sections: [{ heading: '', text: '內文', imageUrl: '' }] }] },
    membership: { articles: [{ id: 'm1', title: '加入會員與購物須知', category: '', date: '2026-10-08', sections: [{ heading: '註冊', text: '內文', imageUrl: '' }] }] },
};
const writes = [];
window.firebaseServices = {
    db: {}, doc: (d, col, id) => ({ col, id }),
    getDoc: async (ref) => ({ exists: () => !!db[ref.id], data: () => db[ref.id] }),
    setDoc: async (ref, data) => { writes.push(ref.id); db[ref.id] = data; },
    serverTimestamp: () => 'TS',
};
const toasts = [];
window.AdminCommon = {
    showToast: (m) => toasts.push(m), showLoading() {}, hideLoading() {}, handleError: (e) => toasts.push('ERR ' + e.message),
};
window.escapeHtml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
window.ImageUpload = { compress: async (f) => f, metadataFor: () => ({}) };
window.eval(read('js/knowledge.js'));
window.eval(read('js/admin-knowledge.js'));
window.AdminKnowledge.init();
window.AdminMembership.init();
await wait(50);

let pass = 0, fail = 0;
async function t(name, fn) {
    try { await fn(); pass++; console.log('  PASS  ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}

await t('兩個分頁各自列出自己的文章', async () => {
    assert.ok(/孤挺花栽培指南/.test(document.getElementById('knowledge-admin-list').textContent));
    assert.ok(!/加入會員與購物須知/.test(document.getElementById('knowledge-admin-list').textContent), '栽培小知識列出了會員文章');
    assert.ok(/加入會員與購物須知/.test(document.getElementById('membership-admin-list').textContent));
    assert.ok(!/孤挺花/.test(document.getElementById('membership-admin-list').textContent), '加入會員列出了栽培文章');
});

await t('加入會員的「前台」連結指向 membership.html', async () => {
    const link = document.querySelector('#membership-admin-list a[href*="?id="]');
    assert.ok(link && link.getAttribute('href').startsWith('/membership.html?id=m1'), link && link.getAttribute('href'));
});

await t('兩個編輯器同時打開，欄位 id 不重複', async () => {
    document.getElementById('knowledge-new-btn').click();
    document.getElementById('membership-new-btn').click();
    const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepStrictEqual(dup, [], '重複的 id：' + dup.join(', '));
    assert.ok(document.getElementById('membership-f-title'), '找不到加入會員的標題欄位');
});

await t('在「加入會員」新增文章，只寫入 settings/membership', async () => {
    writes.length = 0;
    const editor = document.getElementById('membership-editor');
    const title = document.getElementById('membership-f-title');
    title.value = '運送與付款';
    title.dispatchEvent(new window.Event('input', { bubbles: true }));
    const text = editor.querySelector('textarea[data-section-field="text"]');
    text.value = '說明內容';
    text.dispatchEvent(new window.Event('input', { bubbles: true }));
    editor.querySelector('[data-editor-action="save"]').click();
    await wait(50);
    assert.deepStrictEqual(writes, ['membership'], '寫入了：' + writes.join(','));
    assert.deepStrictEqual(db.membership.articles.map((a) => a.title).sort(), ['加入會員與購物須知', '運送與付款'].sort());
    assert.strictEqual(db.knowledge.articles.length, 1, '栽培小知識被動到了');
    assert.ok(db.membership.articles.find((a) => a.title === '運送與付款').id.startsWith('m'), '新文章 id 應以 m 開頭');
});

await t('栽培小知識的分類建議已經沒有「加入會員」', async () => {
    const options = Array.from(document.querySelectorAll('#knowledge-f-category-list option')).map((o) => o.value);
    assert.ok(options.length > 0, '沒有分類建議');
    assert.ok(!options.includes('加入會員'), '還有加入會員：' + options.join(','));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
