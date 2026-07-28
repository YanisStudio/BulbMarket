// BulbMarket 商品排程上下架
//
// 由 .github/workflows/product-scheduler.yml 每 15 分鐘觸發一次。
// 檢查 Firestore 的 products 集合裡，誰的 scheduledPublishAt / scheduledUnpublishAt
// 已經到了，就把 status 改成對應的值，並清掉已經用過的排程欄位（避免重複觸發）。
//
// 需要環境變數 FIREBASE_SERVICE_ACCOUNT（完整的服務帳戶 JSON 內容）。

import { initializeApp, cert } from 'firebase-admin/app';
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

async function processBatchTransition(db, field, newStatus) {
    const now = Timestamp.now();
    const snapshot = await db.collection('products').where(field, '<=', now).get();

    if (snapshot.empty) {
        console.log(`[${field}] 沒有需要處理的商品`);
        return 0;
    }

    const batch = db.batch();
    const names = [];
    snapshot.forEach((doc) => {
        const data = doc.data();
        names.push(`${doc.id}（${data.name || '未命名商品'}）`);
        batch.update(doc.ref, {
            status: newStatus,
            [field]: FieldValue.delete(),
        });
    });
    await batch.commit();

    console.log(`[${field}] 已將 ${snapshot.size} 項商品的 status 改成 "${newStatus}"：`);
    names.forEach((n) => console.log(`  - ${n}`));
    return snapshot.size;
}

async function main() {
    const serviceAccount = loadServiceAccount();
    initializeApp({ credential: cert(serviceAccount) });
    const db = getFirestore();

    const publishedCount = await processBatchTransition(db, 'scheduledPublishAt', 'active');
    const unpublishedCount = await processBatchTransition(db, 'scheduledUnpublishAt', 'inactive');

    console.log(`完成。上架 ${publishedCount} 項，下架 ${unpublishedCount} 項。`);
}

main().catch((error) => {
    console.error('排程腳本執行失敗:', error);
    process.exitCode = 1;
});
