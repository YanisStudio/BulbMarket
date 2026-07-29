// 一次性工具：比對 Firebase Authentication 與 Firestore 的 users 集合，
// 補上 Firestore 裡缺漏（完全空白）的 email / phone 欄位。
//
// 用法（兩種登入方式擇一）：
//   1. 本機執行：設定 FIREBASE_SERVICE_ACCOUNT 環境變數（服務帳戶 JSON 全文）
//   2. Google Cloud Shell：不用設定金鑰，直接用你自己 Google 帳號的權限
//      （Cloud Shell 已經幫你登入好，這裡會自動偵測、不需要额外設定）
//
//   node run.mjs            → 只印出「會改什麼」，不會真的寫入資料庫（預設，安全）
//   node run.mjs --apply    → 真的把上面預覽過的內容寫進 Firestore
//
// 只補完全空白的欄位，Firestore 裡已經有值的一律不動（不管跟 Authentication
// 是否一致），避免蓋掉你手動改過的資料。

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';

const PROJECT_ID = 'bulb-market-217c4';

function buildAppOptions() {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (raw) {
        // 本機執行：用貼進來的服務帳戶金鑰
        let serviceAccount;
        try {
            serviceAccount = JSON.parse(raw);
        } catch (error) {
            throw new Error('FIREBASE_SERVICE_ACCOUNT 不是合法的 JSON：' + error.message);
        }
        console.log('使用 FIREBASE_SERVICE_ACCOUNT 金鑰登入');
        return { credential: cert(serviceAccount), projectId: PROJECT_ID };
    }

    // 沒設金鑰：假設是在 Google Cloud Shell（或其他已經用 gcloud 登入過的環境）
    // 執行，改用「應用程式預設憑證」，會自動用目前登入的 Google 帳號權限
    console.log('沒有偵測到 FIREBASE_SERVICE_ACCOUNT，改用目前的 Google 帳號登入身分（適用 Cloud Shell）');
    return { credential: applicationDefault(), projectId: PROJECT_ID };
}

function normalizePhone(phoneNumber) {
    // 跟 js/member.js 的 saveUserToFirestore 用同一套格式：+886 開頭轉成 0 開頭
    if (!phoneNumber) return '';
    return phoneNumber.replace(/^\+886/, '0');
}

function detectProvider(user) {
    const providerId = user.providerData?.[0]?.providerId;
    if (providerId === 'google.com') return 'google';
    if (providerId === 'facebook.com') return 'facebook';
    if (providerId === 'phone' || user.phoneNumber) return 'phone';
    return 'unknown';
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

async function main() {
    const applyChanges = process.argv.includes('--apply');

    initializeApp(buildAppOptions());
    const auth = getAuth();
    const db = getFirestore();

    console.log('讀取 Authentication 使用者清單...');
    const authUsers = await listAllAuthUsers(auth);
    console.log(`共 ${authUsers.length} 位 Authentication 使用者\n`);

    const plannedUpdates = []; // { uid, identifier, changes: {field: value}, isNewDoc }

    for (const user of authUsers) {
        const userRef = db.collection('users').doc(user.uid);
        const docSnap = await userRef.get();

        const authEmail = user.email || '';
        const authPhone = normalizePhone(user.phoneNumber);
        const identifier = user.email || user.phoneNumber || user.uid;

        if (!docSnap.exists) {
            // Firestore 裡完全沒有這位使用者的個人資料文件
            // （例如先前 redirect 登入沒有寫入資料的那個 bug）
            const provider = detectProvider(user);
            const creationTime = user.metadata?.creationTime
                ? Timestamp.fromDate(new Date(user.metadata.creationTime))
                : Timestamp.now();
            const lastSignInTime = user.metadata?.lastSignInTime
                ? Timestamp.fromDate(new Date(user.metadata.lastSignInTime))
                : creationTime;

            plannedUpdates.push({
                uid: user.uid,
                identifier,
                isNewDoc: true,
                changes: {
                    name: provider === 'phone' ? '' : (user.displayName || ''),
                    email: authEmail,
                    phone: authPhone,
                    provider,
                    city: '',
                    district: '',
                    address: '',
                    createdAt: creationTime,
                    lastLoginAt: lastSignInTime
                }
            });
            continue;
        }

        const data = docSnap.data();
        const changes = {};

        if ((!data.email || data.email === '') && authEmail) {
            changes.email = authEmail;
        }
        if ((!data.phone || data.phone === '') && authPhone) {
            changes.phone = authPhone;
        }

        if (Object.keys(changes).length > 0) {
            plannedUpdates.push({ uid: user.uid, identifier, isNewDoc: false, changes });
        }
    }

    if (plannedUpdates.length === 0) {
        console.log('沒有發現需要補上的缺漏欄位，Firestore 資料跟 Authentication 一致。');
        return;
    }

    console.log(`發現 ${plannedUpdates.length} 筆需要補資料：\n`);
    plannedUpdates.forEach((u) => {
        const tag = u.isNewDoc ? '[缺整份文件]' : '[補欄位]';
        const changeText = Object.entries(u.changes)
            .filter(([k]) => k === 'email' || k === 'phone')
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');
        console.log(`${tag} ${u.identifier} (${u.uid}) -> ${changeText || '(建立基本資料文件)'}`);
    });

    if (!applyChanges) {
        console.log('\n這是預覽結果，尚未寫入資料庫。確認沒問題後，加上 --apply 參數重新執行才會真的寫入：');
        console.log('  node run.mjs --apply');
        return;
    }

    console.log('\n開始寫入 Firestore...');
    const batch = db.batch();
    plannedUpdates.forEach((u) => {
        const userRef = db.collection('users').doc(u.uid);
        if (u.isNewDoc) {
            batch.set(userRef, u.changes);
        } else {
            batch.update(userRef, u.changes);
        }
    });
    await batch.commit();
    console.log(`完成，已更新 ${plannedUpdates.length} 筆會員資料。`);
}

main().catch((error) => {
    console.error('執行失敗:', error);
    process.exitCode = 1;
});
