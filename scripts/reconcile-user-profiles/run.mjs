// 一次性工具：比對 Firebase Authentication 與 Firestore 的 users 集合，
// 補上 Firestore 裡缺漏（完全空白）的 email / phone 欄位。
//
// 用法：
//   FIREBASE_SERVICE_ACCOUNT 環境變數放服務帳戶 JSON 全文
//   node run.mjs            → 只印出「會改什麼」，不會真的寫入資料庫（預設，安全）
//   node run.mjs --apply    → 真的把上面預覽過的內容寫進 Firestore
//
// 只補完全空白的欄位，Firestore 裡已經有值的一律不動（不管跟 Authentication
// 是否一致），避免蓋掉你手動改過的資料。

import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';

function loadServiceAccount() {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
        throw new Error('缺少環境變數 FIREBASE_SERVICE_ACCOUNT（Firebase 服務帳戶金鑰 JSON）');
    }
    try {
        return JSON.parse(raw);
    } catch (error) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT 不是合法的 JSON：' + error.message);
    }
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

    const serviceAccount = loadServiceAccount();
    initializeApp({ credential: cert(serviceAccount) });
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
