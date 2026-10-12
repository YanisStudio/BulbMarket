// 連線失敗時，畫面不能顯示成「沒有資料」或「運費 0」。
//
// getDocs() 連不上後端時不會丟錯，它會悄悄改讀本地快取、回傳「技術上成功但是空」
// 的結果。頁面既有的 catch 因此永遠不會觸發，畫面就理直氣壯地顯示 0 / 空列表。
// 這支測試用「全部讀取都失敗」的假 Firestore 驅動真實頁面程式碼，
// 確認它走的是錯誤路徑而不是「沒有資料」路徑。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  PASS  ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}

// ---- 靜態檢查：這幾個讀取點一定要用 getDocsFromServer ----
console.log('讀取方式（連不上時必須 throw，不能靜默回傳空值）');

const mustUseFromServer = [
    ['cart.html', 'tieredRates', '購物車的階梯運費'],
    ['payment.html', 'tieredRates', '結帳頁的階梯運費'],
    ['orders.html', 'userIdQuery', '訂單記錄的 userId 查詢'],
    ['orders.html', 'fieldQuery', '訂單記錄的信箱/電話查詢'],
    ['messages.html', 'querySnapshot = await', '我的訊息列表'],
];
for (const [file, needle, label] of mustUseFromServer) {
    t(`${label}（${file}）`, () => {
        const src = read(file);
        const line = src.split('\n').find((l) => l.includes(needle) && /getDocs(FromServer)?\(/.test(l));
        assert.ok(line, `找不到含有 ${needle} 的讀取`);
        assert.ok(/getDocsFromServer\(/.test(line), '還在用 getDocs()：' + line.trim());
    });
}

t('後台 8 個頁面沒有殘留的 getDocs() 呼叫', () => {
    const files = fs.readdirSync(path.join(ROOT, 'admin')).filter((f) => f.endsWith('.html'));
    const bad = [];
    for (const f of files) {
        read('admin/' + f).split('\n').forEach((l, i) => {
            if (/\bgetDocs\(/.test(l) && !l.trim().startsWith('//')) bad.push(`admin/${f}:${i + 1}`);
        });
    }
    assert.deepStrictEqual(bad, [], '仍在用 getDocs(): ' + bad.join(', '));
});

t('前台沒有殘留的 getDocs() 呼叫', () => {
    const files = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
    const bad = [];
    for (const f of files) {
        read(f).split('\n').forEach((l, i) => {
            if (/\bgetDocs\(/.test(l) && !l.trim().startsWith('//')) bad.push(`${f}:${i + 1}`);
        });
    }
    assert.deepStrictEqual(bad, [], '仍在用 getDocs(): ' + bad.join(', '));
});

// ---- 行為檢查：購物車在運費設定讀不到時，不能顯示金額 ----
console.log('\n購物車：運費設定讀不到時的行為');

function runCart({ failShipping }) {
    const html = read('cart.html');
    const body = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' + html.slice(html.indexOf('<body>'));
    const dom = new JSDOM(body, { runScripts: 'outside-only', url: 'https://flowerbulb.tw/cart.html' });
    const { window } = dom;
    const { document } = window;

    window.localStorage.setItem('cart', JSON.stringify([
        { id: 'p1', name: '百合', price: 100, quantity: 2, stock: 10 }
    ]));

    const offline = () => { const e = new Error('Failed to get documents from server.'); e.code = 'unavailable'; throw e; };
    window.firebaseServices = {
        db: {}, auth: { currentUser: null },
        collection: () => ({}), doc: () => ({}), query: () => ({}), where: () => ({}), orderBy: () => ({}),
        onAuthStateChanged: (a, cb) => { cb(null); return () => {}; },
        getDoc: async () => (failShipping ? offline() : { exists: () => true, data: () => ({}) }),
        getDocsFromServer: async () => (failShipping ? offline() : { forEach: () => {} }),
    };
    // 被測程式碼在錯誤路徑上本來就會 console.error，測試輸出不需要那些堆疊
    window.console.error = () => {};
    // common.js 提供的全域
    window.eval(read('js/common.js'));
    window.initCommonFeatures = () => {};

    // 執行頁面自己的 inline script
    const inline = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
    window.eval(inline[1]);
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    return { window, document };
}

// initializeCart() 是 async，要等它跑完才能驗畫面，所以不能用上面同步的 t()
async function tAsync(name, fn) {
    try { await fn(); pass++; console.log('  PASS  ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}

await tAsync('運費設定讀不到時顯示連線錯誤，不顯示運費 0，並藏起結帳區', async () => {
    const { document } = runCart({ failShipping: true });
    await new Promise((r) => setTimeout(r, 150));
    const text = document.getElementById('cart-container').textContent;
    assert.ok(/網路連線不穩定/.test(text),
        '應顯示連線錯誤，實際內容: ' + text.trim().slice(0, 80));
    assert.ok(!/NT\$\s*0/.test(text), '不應該出現金額 0');
    assert.strictEqual(document.getElementById('cart-summary').style.display, 'none',
        '結帳區應被隱藏，避免用沒確認過的金額結帳');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
