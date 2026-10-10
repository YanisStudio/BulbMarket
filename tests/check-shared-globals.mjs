// 這個站靠「傳統 <script> 共用全域函式」運作，所以常見的壞法是：
// 某頁用了 escapeHtml / showToast / AdminCommon…，但沒有載入定義它的那支 js。
// 這裡把每支共用 js 提供的全域名稱列出來，再比對每個頁面實際用到哪些。
import fs from 'node:fs';
import path from 'node:path';

// repo 根目錄（這支程式放在 tests/ 底下）
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

// 讀檔時統一行尾，理由同 check-firebase-services.mjs
const read = (f) => fs.readFileSync(f, 'utf8').split('\r\n').join('\n');

// 每支共用腳本提供的全域名稱（頂層 function 宣告 + window.X = 指派 + 頂層 const/class）
function providedBy(file) {
    const src = read(path.join(ROOT, file));
    const names = new Set();
    for (const m of src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
    for (const m of src.matchAll(/^\s*window\.([A-Za-z_$][\w$]*)\s*=/gm)) names.add(m[1]);
    for (const m of src.matchAll(/^(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
    return names;
}

const JS_FILES = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => 'js/' + f);
const provides = new Map(JS_FILES.map((f) => [f, providedBy(f)]));

// 只檢查這些「真的是共用全域」的名稱，避免把頁面自己的函式或瀏覽器內建誤判
const SHARED = new Map();
for (const [file, names] of provides) {
    for (const n of names) {
        if (!SHARED.has(n)) SHARED.set(n, new Set());
        SHARED.get(n).add(file);
    }
}

// 明顯不是共用 API 的內部名稱，不納入檢查（只在自己檔案裡用）
const IGNORE = new Set([
    'firebaseConfig', 'firebaseApp', 'currentUser', 'authReadyPromise', 'styles', 'dialog',
    'app', 'auth', 'db', 'storage', 'cart', 'products', 'name', 'style', 'input', 'result',
    'data', 'modal', 'user', 'order', 'item', 'items', 'total', 'notes', 'code', 'text',
    'now', 'today', 'firebaseServices', 'load', 'str', 'get', 'files', 'src', 'keys', 'line', 'parts', 'counts'
]);

function inlineNonModule(src) {
    let out = '';
    const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(src))) {
        if (!/type\s*=\s*["']module["']/i.test(m[1] || '')) out += '\n' + m[2];
    }
    return out;
}

const htmlFiles = [
    ...fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')),
    ...fs.readdirSync(path.join(ROOT, 'admin')).filter((f) => f.endsWith('.html')).map((f) => 'admin/' + f)
];

let problems = 0;
for (const rel of htmlFiles) {
    const src = read(path.join(ROOT, rel));
    const loaded = [...src.matchAll(/src="\/(js\/[^"]+\.js)"/g)].map((m) => m[1]);

    // 這個頁面能拿到的全域：自己 inline script 定義的 + 它載入的 js 提供的
    const inline = inlineNonModule(src);
    const available = new Set();
    for (const m of inline.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) available.add(m[1]);
    for (const m of inline.matchAll(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) available.add(m[1]);
    for (const f of loaded) for (const n of provides.get(f) || []) available.add(n);
    // admin-common.js 的方法也掛在 window.AdminCommon 上
    if (loaded.includes('js/admin-common.js')) available.add('AdminCommon');

    // 頁面 inline script 用到的共用名稱
    const missing = new Map();
    for (const [nameStr, owners] of SHARED) {
        if (IGNORE.has(nameStr)) continue;
        if (available.has(nameStr)) continue;
        // 以「被呼叫」或「被當物件用」的形式出現才算
        const used = new RegExp(`\\b${nameStr}\\s*[(.]`).test(inline);
        if (used) missing.set(nameStr, [...owners].join(', '));
    }

    if (missing.size > 0) {
        problems++;
        console.log(`\n[可能缺少載入] ${rel}`);
        console.log(`    已載入: ${loaded.join(', ') || '(無)'}`);
        for (const [n, owner] of missing) console.log(`    ${n}()  → 定義在 ${owner}`);
    }
}

console.log(problems === 0
    ? '\n每個頁面用到的共用全域，都有載入對應的腳本。'
    : `\n${problems} 個頁面可能缺少腳本。`);
process.exit(problems ? 1 : 0);
