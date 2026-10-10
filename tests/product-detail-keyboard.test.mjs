// 用 jsdom 載入真正的 products.html + js/common.js，驗證鍵盤真的能開啟／關閉商品詳細介紹彈窗
import fs from 'node:fs';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
const html = fs.readFileSync(ROOT + '/products.html', 'utf8');
const commonJs = fs.readFileSync(ROOT + '/js/common.js', 'utf8');

// 只要 <body> 的結構（含彈窗），不要執行頁面自己的 Firebase 模組
const bodyOnly = '<!DOCTYPE html><html lang="zh-TW"><head><meta charset="utf-8"></head>'
    + html.slice(html.indexOf('<body>'));

// 要給 url，否則 jsdom 的 origin 是 opaque，localStorage 一碰就丟 SecurityError
//（openProductDetailModal 會讀 wishlist）
const dom = new JSDOM(bodyOnly, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://flowerbulb.tw/products.html'
});
const { window } = dom;
const { document } = window;

// common.js 會用到的最小環境
window.matchMedia = () => ({ matches: false, addEventListener() {} });
window.eval(commonJs);

// 取出 products.html 裡真正的卡片 HTML 產生器，確認它產生的是 <button>
const fnSrc = html.slice(html.indexOf('function buildProductCardHTML'));
const fnBody = fnSrc.slice(0, fnSrc.indexOf('\n// 把指定頁碼'));
window.eval(fnBody);

const product = {
    id: 'p1', name: '香水百合 <測試>', description: '描述', price: 120, unit: '球',
    stock: 10, status: 'active', tags: ['熱門'], imageUrl: '/images/x.jpg',
    category: 'bulbs', categoryIds: ['lily']
};

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  PASS  ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}

const grid = document.getElementById('products-grid');
const rawCardHTML = window.buildProductCardHTML(product);
grid.innerHTML = rawCardHTML;
window.initProductDetailModal();
window.initAddToCartButtons();

const modal = document.getElementById('product-detail-modal');
const hint = grid.querySelector('.product-detail-hint');
const closeBtn = modal.querySelector('.product-detail-close');

function press(key, opts = {}) {
    // cancelable: true 是必要的——瀏覽器真實的 keydown 可以被 preventDefault，
    // 少了這個旗標 defaultPrevented 永遠是 false，會誤判成焦點陷阱沒作用
    const ev = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
    (document.activeElement || document.body).dispatchEvent(ev);
    return ev;
}

console.log('商品詳細介紹彈窗 — 鍵盤操作');

t('「查看詳細介紹」是真的 <button>（Tab 走得到）', () => {
    assert.ok(hint, '找不到 .product-detail-hint');
    assert.strictEqual(hint.tagName, 'BUTTON', '還是 ' + hint.tagName);
    assert.strictEqual(hint.getAttribute('type'), 'button', '缺少 type="button"，在表單裡會變成送出鈕');
});

t('aria-label 含商品名稱，且名稱在原始 HTML 裡有跳脫', () => {
    const label = hint.getAttribute('aria-label');
    assert.ok(label && label.includes('香水百合 <測試>'), 'aria-label 不含商品名稱: ' + label);
    // 檢查「產生出來的原始字串」而不是 jsdom 重新序列化的 outerHTML：
    // 屬性值裡的 < > 依規格不需要重新轉義，所以 outerHTML 看起來會像沒跳脫
    assert.ok(rawCardHTML.includes('aria-label="查看 香水百合 &lt;測試&gt; 的詳細介紹"'),
        '商品名稱沒有跳脫，惡意名稱可能跳出屬性: ' + rawCardHTML.match(/aria-label="[^"]*"/));
});

t('裝飾性圖示對讀螢幕隱藏', () => {
    const icon = hint.querySelector('i');
    assert.strictEqual(icon.getAttribute('aria-hidden'), 'true');
});

t('彈窗有對話框語意', () => {
    assert.strictEqual(modal.getAttribute('role'), 'dialog');
    assert.strictEqual(modal.getAttribute('aria-modal'), 'true');
    assert.strictEqual(modal.getAttribute('aria-labelledby'), 'pd-name');
});

t('初始狀態是關閉的', () => {
    assert.notStrictEqual(modal.style.display, 'flex');
});

t('按 Enter 在提示鈕上會開啟彈窗（原生按鈕的 Enter → click）', () => {
    hint.focus();
    assert.strictEqual(document.activeElement, hint, 'Tab 焦點進不去提示鈕');
    hint.click(); // 原生 button 的 Enter/Space 會產生 click，jsdom 不模擬所以直接觸發
    assert.strictEqual(modal.style.display, 'flex', '彈窗沒有開啟');
    assert.strictEqual(document.getElementById('pd-name').textContent, product.name, '彈窗沒帶入商品名稱');
});

t('開窗後焦點移進彈窗（不會留在被遮住的卡片上）', () => {
    assert.strictEqual(document.activeElement, closeBtn, '焦點在 ' + (document.activeElement && document.activeElement.className));
});

t('Tab 被鎖在彈窗裡：最後一個元素往後 Tab 會回到第一個', () => {
    const focusables = modal.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    assert.ok(focusables.length >= 2, '彈窗裡可聚焦元素太少: ' + focusables.length);
    const last = focusables[focusables.length - 1];
    last.focus();
    const ev = press('Tab');
    assert.ok(ev.defaultPrevented, 'Tab 沒有被攔下來');
    assert.strictEqual(document.activeElement, focusables[0], '沒有繞回第一個元素');
});

t('Shift+Tab 從第一個元素往前會跳到最後一個', () => {
    const focusables = modal.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    focusables[0].focus();
    const ev = press('Tab', { shiftKey: true });
    assert.ok(ev.defaultPrevented, 'Shift+Tab 沒有被攔下來');
    assert.strictEqual(document.activeElement, focusables[focusables.length - 1]);
});

t('按 Escape 關閉彈窗，焦點回到原本的提示鈕', () => {
    press('Escape');
    assert.strictEqual(modal.style.display, 'none', '彈窗沒關掉');
    assert.strictEqual(document.activeElement, hint, '焦點沒有還回去，而是在 ' + (document.activeElement && document.activeElement.tagName));
});

t('彈窗關閉後 Tab 不再被攔截（焦點陷阱只在開窗時生效）', () => {
    hint.focus();
    const ev = press('Tab');
    assert.ok(!ev.defaultPrevented, '關窗後 Tab 還是被攔住了');
});

t('滑鼠點卡片空白處也能開窗（原本的行為沒壞）', () => {
    const card = grid.querySelector('.product-card');
    card.querySelector('h3').click();
    assert.strictEqual(modal.style.display, 'flex');
    press('Escape');
});

t('點「加入購物車」不會誤開彈窗（原本的排除邏輯沒壞）', () => {
    const addBtn = grid.querySelector('.add-to-cart-btn');
    addBtn.click();
    assert.notStrictEqual(modal.style.display, 'flex', '點加入購物車竟然開了彈窗');
});

t('重新渲染商品格後，彈窗裡的按鈕仍可運作（上一輪修的 cloneNode 問題）', () => {
    grid.innerHTML = window.buildProductCardHTML(product);
    window.initAddToCartButtons();
    const pdAdd = document.getElementById('pd-add-to-cart');
    const pdWish = document.getElementById('pd-wish-btn');
    assert.ok(pdAdd && pdWish, '彈窗按鈕不見了');
    grid.querySelector('.product-detail-hint').click();
    assert.strictEqual(modal.style.display, 'flex');
    assert.strictEqual(typeof document.getElementById('pd-add-to-cart').onclick, 'function', '彈窗的加入購物車 onclick 被清掉了');
    assert.strictEqual(typeof document.getElementById('pd-wish-btn').onclick, 'function', '彈窗的收藏 onclick 被清掉了');
    press('Escape');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
