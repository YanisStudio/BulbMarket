// 商品詳細介紹彈窗：「商品描述」「詳細介紹」兩個分頁
// - 讀商品時要帶上 detailDescription（以前漏了，後台寫的詳細介紹永遠看不到）
// - 兩種都有才顯示分頁；只有一種就直接顯示那一種
// - 點選、左右鍵切換；Tab 鍵鎖在彈窗裡時略過隱藏的分頁標籤
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

let pass = 0, fail = 0;
async function t(name, fn) {
    try { await fn(); pass++; console.log('  PASS  ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}

function open(page) {
    const html = read(page);
    const dom = new JSDOM('<!DOCTYPE html><html><head></head>' + html.slice(html.indexOf('<body>')),
        { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://flowerbulb.tw/' + page });
    const { window } = dom;
    window.console.log = () => {};
    window.matchMedia = () => ({ matches: false, addEventListener() {} });
    window.eval(read('js/common.js'));
    window.__productDataCache = {
        both: { id: 'both', name: '百合', description: '短描述', detailDescription: '很長的詳細介紹\n第二行', price: 100, unit: '球', stock: 5, status: 'active', tags: [] },
        onlyDesc: { id: 'onlyDesc', name: '鬱金香', description: '只有描述', detailDescription: '', price: 80, unit: '球', stock: 5, status: 'active', tags: [] },
        onlyDetail: { id: 'onlyDetail', name: '孤挺花', description: '', detailDescription: '只有詳細介紹', price: 90, unit: '球', stock: 5, status: 'active', tags: [] },
    };
    window.initProductDetailModal();
    const $ = (id) => window.document.getElementById(id);
    return { window, $ };
}

for (const page of ['products.html', 'index.html']) {
    console.log(`\n【${page}】`);

    await t('兩種都有：顯示分頁，預設「商品描述」，點「詳細介紹」切換', async () => {
        const { window, $ } = open(page);
        window.openProductDetailModal('both');
        assert.strictEqual($('pd-tabs').hidden, false, '應該顯示分頁');
        assert.strictEqual($('pd-panel-desc').hidden, false);
        assert.strictEqual($('pd-detail-desc-wrap').hidden, true);
        assert.strictEqual($('pd-tab-desc').getAttribute('aria-selected'), 'true');
        $('pd-tab-detail').click();
        assert.strictEqual($('pd-panel-desc').hidden, true);
        assert.strictEqual($('pd-detail-desc-wrap').hidden, false);
        assert.strictEqual($('pd-detail-desc').textContent, '很長的詳細介紹\n第二行');
        assert.strictEqual($('pd-tab-detail').getAttribute('aria-selected'), 'true');
    });

    await t('重新打開另一個商品時回到「商品描述」', async () => {
        const { window, $ } = open(page);
        window.openProductDetailModal('both');
        $('pd-tab-detail').click();
        window.closeProductDetailModal();
        window.openProductDetailModal('both');
        assert.strictEqual($('pd-panel-desc').hidden, false);
    });

    await t('只有描述：不顯示分頁，直接顯示描述', async () => {
        const { window, $ } = open(page);
        window.openProductDetailModal('onlyDesc');
        assert.strictEqual($('pd-tabs').hidden, true);
        assert.strictEqual($('pd-panel-desc').hidden, false);
        assert.strictEqual($('pd-desc').textContent, '只有描述');
    });

    await t('只有詳細介紹：不顯示分頁，直接顯示詳細介紹', async () => {
        const { window, $ } = open(page);
        window.openProductDetailModal('onlyDetail');
        assert.strictEqual($('pd-tabs').hidden, true);
        assert.strictEqual($('pd-detail-desc-wrap').hidden, false);
        assert.strictEqual($('pd-panel-desc').hidden, true);
    });

    await t('左右鍵在兩個分頁間切換', async () => {
        const { window, $ } = open(page);
        window.openProductDetailModal('both');
        $('pd-tab-desc').focus();
        $('pd-tab-desc').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        assert.strictEqual($('pd-detail-desc-wrap').hidden, false);
        assert.strictEqual(window.document.activeElement.id, 'pd-tab-detail');
    });

    await t('只有一種文字時，Tab 鍵不會停在隱藏的分頁標籤上', async () => {
        const { window, $ } = open(page);
        window.openProductDetailModal('onlyDesc');
        // 從最後一個可聚焦元素按 Tab，要繞回第一個（關閉按鈕），而不是隱藏的分頁
        const wish = $('pd-wish-btn');
        wish.focus();
        wish.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        assert.ok(window.document.activeElement.classList.contains('product-detail-close'),
            '焦點跑到：' + window.document.activeElement.id);
    });
}

console.log('\n讀取商品資料');
await t('loadProducts 有帶上 detailDescription', async () => {
    const src = read('js/common.js');
    const block = src.slice(src.indexOf('async loadProducts('), src.indexOf('return products;', src.indexOf('async loadProducts(')));
    assert.ok(/detailDescription: data\.detailDescription/.test(block), 'loadProducts 沒有讀 detailDescription');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
