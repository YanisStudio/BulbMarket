// 設定/移除/列出管理員權限（Firebase Auth custom claim: admin）。
//
// 取代原本寫死在 js/firebase-config.js（window.ADMIN_EMAILS）、js/member.js、
// Firestore 規則、Storage 規則裡各一份、要新增管理員得同時改四個地方的做法。
// 改用 custom claim 之後，前端程式碼跟安全規則都只檢查
// request.auth.token.admin === true，新增/移除管理員只要跑這支腳本，
// 不用再改程式碼、不用重新部署規則。
//
// 用法（兩種登入方式擇一，見下方 buildAppOptions）：
//   node run.mjs add some.admin@gmail.com
//   node run.mjs add first@gmail.com,second@gmail.com   （一次設定多個，用逗號分隔）
//   node run.mjs remove some.admin@gmail.com
//   node run.mjs list                                   （列出目前所有擁有 admin claim 的帳號）
//
// 設定/移除 claim 後，該帳號要「登出再登入一次」（或等 ID Token 自動過期刷新，
// 最長約 1 小時）才會生效——瀏覽器目前記住的登入狀態不會馬上更新。

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const PROJECT_ID = 'bulb-market-217c4';

function buildAppOptions() {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (raw) {
        let serviceAccount;
        try {
            serviceAccount = JSON.parse(raw);
        } catch (error) {
            throw new Error('FIREBASE_SERVICE_ACCOUNT 不是合法的 JSON：' + error.message);
        }
        console.log('使用 FIREBASE_SERVICE_ACCOUNT 金鑰登入');
        return { credential: cert(serviceAccount), projectId: PROJECT_ID };
    }

    console.log('沒有偵測到 FIREBASE_SERVICE_ACCOUNT，改用目前的 Google 帳號登入身分（適用 Cloud Shell）');
    return { credential: applicationDefault(), projectId: PROJECT_ID };
}

async function listAllAuthUsers(auth) {
    const users = [];
    let pageToken;
    do {
        const result = await auth.listUsers(1000, pageToken);
        users.push(...result.users);
        pageToken = result.pageToken;
    } while (pageToken);
    return users;
}

function parseEmails(raw) {
    return (raw || '')
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean);
}

async function setAdminClaim(auth, email, isAdmin) {
    let user;
    try {
        user = await auth.getUserByEmail(email);
    } catch (error) {
        console.error(`✗ ${email}：找不到這個帳號（確認信箱有沒有打錯、這個人是否已經用這個信箱註冊過）`);
        return false;
    }

    const existingClaims = user.customClaims || {};
    const nextClaims = { ...existingClaims };
    if (isAdmin) {
        nextClaims.admin = true;
    } else {
        delete nextClaims.admin;
    }

    await auth.setCustomUserClaims(user.uid, nextClaims);
    console.log(`✓ ${email}（uid: ${user.uid}）已${isAdmin ? '設定為管理員' : '移除管理員權限'}`);
    return true;
}

async function main() {
    const action = process.argv[2];
    const emails = parseEmails(process.argv[3]);

    initializeApp(buildAppOptions());
    const auth = getAuth();

    if (action === 'list') {
        console.log('讀取所有使用者，篩選出目前擁有 admin claim 的帳號...\n');
        const users = await listAllAuthUsers(auth);
        const admins = users.filter((user) => user.customClaims?.admin === true);
        if (admins.length === 0) {
            console.log('目前沒有任何帳號擁有 admin claim。');
        } else {
            console.log(`目前共有 ${admins.length} 位管理員：`);
            admins.forEach((user) => console.log(`  - ${user.email || '(無 email)'}（uid: ${user.uid}）`));
        }
        return;
    }

    if (action !== 'add' && action !== 'remove') {
        console.error('用法：node run.mjs add|remove <email1,email2,...>  或  node run.mjs list');
        process.exitCode = 1;
        return;
    }

    if (emails.length === 0) {
        console.error('請提供至少一個 email（用逗號分隔多個）');
        process.exitCode = 1;
        return;
    }

    console.log(`準備${action === 'add' ? '設定' : '移除'}管理員權限：${emails.join(', ')}\n`);

    let successCount = 0;
    for (const email of emails) {
        const ok = await setAdminClaim(auth, email, action === 'add');
        if (ok) successCount += 1;
    }

    console.log(`\n完成：${successCount}/${emails.length} 筆成功。`);
    console.log('提醒：剛被設定/移除的帳號，需要登出再登入一次，權限才會實際生效。');
}

main().catch((error) => {
    console.error('執行失敗:', error);
    process.exitCode = 1;
});
