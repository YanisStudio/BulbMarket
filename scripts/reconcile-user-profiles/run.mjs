// 比對 Firebase Authentication 與 Firestore 的 users 集合，
// 補上 Firestore 裡缺漏（完全空白）的 email / phone 欄位。
// 也會列出「帳號已被刪除，但 Firestore 還留著資料」的孤兒紀錄（只記錄，不會自動刪除）。
//
// 這支腳本可以手動執行，也會被 .github/workflows/user-sync.yml 排程自動執行（每天一次，帶 --apply）。
//
// 手動用法（兩種登入方式擇一）：
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

// Authentication 的 creationTime / lastSignInTime 是權威時間來源，
// 不會受網站前端的寫入競爭（例如兩個頁面同時寫 Firestore）影響
function getAuthTimes(user) {
    const creationTime = user.metadata?.creationTime
        ? Timestamp.fromDate(new Date(user.metadata.creationTime))
        : Timestamp.now();
    const lastSignInTime = user.metadata?.lastSignInTime
        ? Timestamp.fromDate(new Date(user.metadata.lastSignInTime))
        : creationTime;
    return { creationTime, lastSignInTime };
}

function toMillis(value) {
    if (!value) return null;
    if (typeof value.toMillis === 'function') return value.toMillis();
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed.getTime();
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
            const { creationTime, lastSignInTime } = getAuthTimes(user);

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

        // createdAt / lastLoginAt 缺欄位，或註冊時間比最後登入時間還晚
        // （邏輯上不可能發生，通常是網站前端兩個頁面同時搶寫 Firestore 造成的），
        // 用 Authentication 的權威時間補上/校正回去
        // 注意：admin/users.html 顯示「今天」不代表資料庫裡真的有這個值——
        // 那邊在 createdAt 缺欄位時會直接 fallback 顯示今天的日期，實際上欄位是空的
        const createdMs = toMillis(data.createdAt);
        const lastLoginMs = toMillis(data.lastLoginAt);
        const isReversed = createdMs !== null && lastLoginMs !== null && createdMs > lastLoginMs;
        const missingCreatedAt = createdMs === null;
        const missingLastLoginAt = lastLoginMs === null;
        let dateReason = null;
        if (isReversed || missingCreatedAt || missingLastLoginAt) {
            const { creationTime, lastSignInTime } = getAuthTimes(user);
            if (isReversed || missingCreatedAt) changes.createdAt = creationTime;
            if (isReversed || missingLastLoginAt) changes.lastLoginAt = lastSignInTime;
            dateReason = isReversed ? '時間顛倒' : '缺日期欄位';
        }

        if (Object.keys(changes).length > 0) {
            plannedUpdates.push({ uid: user.uid, identifier, isNewDoc: false, changes, dateReason });
        }
    }

    console.log('比對 Firestore users 集合，找出帳號已被刪除但資料還留著的孤兒紀錄...');
    const authUidSet = new Set(authUsers.map((u) => u.uid));
    const allDocsSnap = await db.collection('users').get();
    const orphanDocs = [];
    allDocsSnap.forEach((docSnap) => {
        if (!authUidSet.has(docSnap.id)) {
            const data = docSnap.data() || {};
            orphanDocs.push({ uid: docSnap.id, identifier: data.email || data.phone || docSnap.id });
        }
    });
    if (orphanDocs.length > 0) {
        console.log(`發現 ${orphanDocs.length} 筆孤兒資料（Authentication 帳號已不存在，僅記錄、不會自動刪除）：`);
        orphanDocs.forEach((o) => console.log(`[孤兒資料] ${o.identifier} (${o.uid})`));
    } else {
        console.log('沒有發現孤兒資料。');
    }
    console.log('');

    if (plannedUpdates.length === 0) {
        console.log('沒有發現需要補上的缺漏欄位，Firestore 資料跟 Authentication 一致。');
        return;
    }

    console.log(`發現 ${plannedUpdates.length} 筆需要補資料：\n`);
    plannedUpdates.forEach((u) => {
        const tag = u.isNewDoc
            ? '[缺整份文件]'
            : (u.dateReason ? `[${u.dateReason}]` : '[補欄位]');
        const changeText = Object.entries(u.changes)
            .filter(([k]) => ['email', 'phone', 'createdAt', 'lastLoginAt'].includes(k))
            .map(([k, v]) => {
                if ((k === 'createdAt' || k === 'lastLoginAt') && v?.toDate) {
                    return `${k}=${v.toDate().toISOString()}`;
                }
                return `${k}=${v}`;
            })
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
