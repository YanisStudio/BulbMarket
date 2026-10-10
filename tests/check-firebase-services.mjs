// 檢查每個頁面用到的 window.firebaseServices.X 是否真的有被暴露出來。
// 這個站的所有 Firebase 呼叫都走 window.firebaseServices，漏暴露一個方法
// 就會在執行時變成 "is not a function"，而且只在走到那條路徑時才爆。
import fs from 'node:fs';
import path from 'node:path';

// repo 根目錄（這支程式放在 tests/ 底下）
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

// 讀檔時統一行尾：Windows 上 git 會把檔案 checkout 成 CRLF，
// 殘留的 \r 會讓逐行解析抓不到最後一個 token，造成假的「缺少暴露」警告
const read = (f) => fs.readFileSync(f, 'utf8').split('\r\n').join('\n');

// admin-common.js 會把這些 key 合併進 window.firebaseServices（後台頁面共用）
const ADMIN_COMMON_KEYS = new Set([
    'app', 'auth', 'db', 'storage', 'getAuth', 'onAuthStateChanged', 'signOut',
    'collection', 'addDoc', 'getDoc', 'getDocs', 'doc', 'updateDoc', 'deleteDoc',
    'setDoc', 'query', 'orderBy', 'where', 'limit', 'serverTimestamp',
    'writeBatch', 'deleteField', 'increment', 'storageRef', 'uploadBytes', 'getDownloadURL'
]);

function inlineModuleBlocks(src) {
    const out = [];
    const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(src))) {
        if (/type\s*=\s*["']module["']/i.test(m[1] || '')) out.push(m[2]);
    }
    return out;
}

// 從 `window.firebaseServices = { ... };` 取出 key 名稱
function exposedKeys(moduleSrc) {
    const keys = new Set();
    const start = moduleSrc.indexOf('window.firebaseServices');
    if (start === -1) return keys;
    const braceStart = moduleSrc.indexOf('{', start);
    if (braceStart === -1) return keys;
    let depth = 0, end = -1;
    for (let i = braceStart; i < moduleSrc.length; i++) {
        if (moduleSrc[i] === '{') depth++;
        else if (moduleSrc[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) return keys;
    const body = moduleSrc.slice(braceStart + 1, end);
    // 逐行抓 `key:` 或簡寫 `key,`
    for (const rawLine of body.split('\n')) {
        const line = rawLine.replace(/\/\/.*$/, '').trim();
        if (!line) continue;
        let mm = line.match(/^([A-Za-z_$][\w$]*)\s*:/);
        if (mm) { keys.add(mm[1]); continue; }
        mm = line.match(/^([A-Za-z_$][\w$]*)\s*,?$/);
        if (mm) keys.add(mm[1]);
    }
    return keys;
}

// 頁面（含它載入的 /js/*.js）用到哪些 firebaseServices 成員
function usedKeys(sources) {
    const used = new Map(); // key -> 第一個出現的位置描述
    const re = /(?:window\.)?firebaseServices(?:\?)?\.([A-Za-z_$][\w$]*)/g;
    const destructureRe = /const\s*\{([^}]*)\}\s*=\s*(?:window\.)?firebaseServices/g;
    for (const { label, text } of sources) {
        let m;
        while ((m = re.exec(text))) {
            if (!used.has(m[1])) {
                const line = text.slice(0, m.index).split('\n').length;
                used.set(m[1], `${label}:${line}`);
            }
        }
        while ((m = destructureRe.exec(text))) {
            for (const part of m[1].split(',')) {
                const name = part.split(':')[0].trim();
                if (/^[A-Za-z_$][\w$]*$/.test(name) && !used.has(name)) {
                    used.set(name, `${label} (destructure)`);
                }
            }
        }
    }
    return used;
}

const htmlFiles = [
    ...fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).map((f) => f),
    ...fs.readdirSync(path.join(ROOT, 'admin')).filter((f) => f.endsWith('.html')).map((f) => 'admin/' + f)
];

let problems = 0;
for (const rel of htmlFiles) {
    const full = path.join(ROOT, rel);
    const src = read(full);

    const modules = inlineModuleBlocks(src);
    if (modules.length === 0) continue; // 沒有 Firebase 的頁面（例如驗證檔）

    const exposed = new Set();
    for (const mod of modules) for (const k of exposedKeys(mod)) exposed.add(k);

    const isAdmin = rel.startsWith('admin/');
    if (isAdmin) for (const k of ADMIN_COMMON_KEYS) exposed.add(k);
    if (exposed.size === 0) continue;

    // 這個頁面載入的本地 js 檔也要算進來
    const sources = [{ label: rel, text: src }];
    for (const m of src.matchAll(/src="\/(js\/[^"]+\.js)"/g)) {
        const p = path.join(ROOT, m[1]);
        if (fs.existsSync(p)) sources.push({ label: m[1], text: read(p) });
    }

    const used = usedKeys(sources);
    const missing = [...used.keys()].filter((k) => !exposed.has(k));

    if (missing.length > 0) {
        problems++;
        console.log(`\n[缺少暴露] ${rel}`);
        for (const k of missing) console.log(`    .${k}   (用在 ${used.get(k)})`);
    }
}

console.log(problems === 0
    ? '\n所有頁面用到的 firebaseServices 成員都有被暴露。'
    : `\n${problems} 個頁面有缺少暴露的成員。`);
process.exit(problems ? 1 : 0);
