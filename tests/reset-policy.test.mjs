// 什麼時候才該重建 Firestore 連線。
//
// terminate() 會中止所有進行中的作業。如果連線其實只是慢、正要成功，
// 一失敗就重建等於把它砍掉重練，新連線又得從頭握手——實測看到的就是
// 「重建完的新連線一樣等滿 10 秒」，反而更久。
//
// 所以政策是：讓 SDK 自己先重連，只有「持續失敗夠久」才動用重建。
// 這支測試鎖住那個門檻，避免日後有人又改回「一失敗就重建」。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

let pass = 0, fail = 0;
const t = (n, f) => {
    try { f(); pass++; console.log('  PASS  ' + n); }
    catch (e) { fail++; console.log('  FAIL  ' + n + '\n        ' + e.message); }
};

// 載入指定檔案，並把時間換成可控的假時鐘
function load(file) {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: 'outside-only', url: 'https://flowerbulb.tw/' });
    const { window } = dom;
    window.console.log = () => {};
    window.console.warn = () => {};
    window.console.error = () => {};

    let now = 1_000_000;
    window.Date.now = () => now;

    const rebuilds = [];
    // 讓真正的重建變成可觀測的假動作
    window.__fakeRebuild = () => { rebuilds.push(now); return Promise.resolve(true); };

    let src = read(file);
    // 把 resetFirestoreConnection 的實作換掉，只保留政策邏輯
    src = src.replace(/async function resetFirestoreConnection\(\)\s*\{/,
        'async function resetFirestoreConnection() { return window.__fakeRebuild(); } \nasync function __unused_resetFirestoreConnection() {');
    window.eval(src);

    return {
        rebuilds,
        advance: (ms) => { now += ms; },
        fail: async () => window.maybeResetFirestoreConnection
            ? window.maybeResetFirestoreConnection()
            : window.AdminCommon.maybeResetFirestoreConnection(),
        success: () => (window.noteFirestoreSuccess || window.AdminCommon.noteFirestoreSuccess)()
    };
}

for (const file of ['js/common.js', 'js/admin-common.js']) {
    console.log(`\n【${file}】`);

    {
        const m = load(file);
        await t('第一次失敗不重建（SDK 自己會重連，砍掉反而更久）', async () => {
            await m.fail();
            assert.strictEqual(m.rebuilds.length, 0, '第一次失敗就重建了');
        });
    }
    {
        const m = load(file);
        await m.fail();
        m.advance(10000);
        await m.fail();
        m.advance(10000);
        await m.fail();
        t('失敗 20 秒內仍然不重建', () => {
            assert.strictEqual(m.rebuilds.length, 0, '太早重建了（' + m.rebuilds.length + ' 次）');
        });
    }
    {
        const m = load(file);
        await m.fail();
        m.advance(31000);
        await m.fail();
        t('持續失敗超過 30 秒才重建', () => {
            assert.strictEqual(m.rebuilds.length, 1, '應該重建 1 次，實際 ' + m.rebuilds.length);
        });
    }
    {
        const m = load(file);
        await m.fail();
        m.advance(31000);
        await m.fail();          // 第 1 次重建
        m.advance(5000);
        await m.fail();
        m.advance(5000);
        await m.fail();
        t('重建之後有冷卻，不會連續重建', () => {
            assert.strictEqual(m.rebuilds.length, 1, '冷卻沒生效，重建了 ' + m.rebuilds.length + ' 次');
        });
        m.advance(61000);
        await m.fail();
        t('冷卻過了才允許第二次重建', () => {
            assert.strictEqual(m.rebuilds.length, 2, '冷卻過後沒有重建');
        });
    }
    {
        const m = load(file);
        await m.fail();
        m.advance(25000);
        m.success();             // 中間成功一次
        await m.fail();          // 重新開始算
        m.advance(25000);
        await m.fail();
        t('中途成功會把計時歸零（偶發失敗不會累積成重建）', () => {
            assert.strictEqual(m.rebuilds.length, 0, '成功後沒有歸零，仍重建了 ' + m.rebuilds.length + ' 次');
        });
    }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
