// BulbMarket 商品排程上下架
//
// .github/workflows/product-scheduler.yml 裡的 cron 設定是每 15 分鐘，
// 但 GitHub Actions 的排程觸發是 best-effort，實際觀察大約每 3 小時才會真的執行一次。
// 檢查 Firestore 的 products 集合裡，誰的 scheduledPublishAt / scheduledUnpublishAt
// 已經到了，就把 status 改成對應的值，並清掉已經用過的排程欄位（避免重複觸發）。
//
// 需要環境變數 FIREBASE_SERVICE_ACCOUNT（完整的服務帳戶 JSON 內容）。

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { planTransition } from './plan.mjs';

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

// 上架、下架兩種到期的排程一起處理：同一個商品兩個都到期時，以時間比較晚的為準
//（規則見 plan.mjs）。以前是先把所有到期的上架做完、再做下架，
// 「先下架、之後重新上架」的設定會被留在下架狀態
async function processScheduledTransitions(db) {
    const now = Timestamp.now();
    const [publishSnap, unpublishSnap] = await Promise.all([
        db.collection('products').where('scheduledPublishAt', '<=', now).get(),
        db.collection('products').where('scheduledUnpublishAt', '<=', now).get(),
    ]);

    // 兩個查詢可能撈到同一個商品，用 id 去重
    const docsById = new Map();
    [...publishSnap.docs, ...unpublishSnap.docs].forEach((doc) => docsById.set(doc.id, doc));

    const updates = [];
    docsById.forEach((doc) => {
        const plan = planTransition(doc.data(), now.toMillis());
        if (plan) updates.push({ doc, plan });
    });

    if (updates.length === 0) {
        console.log('沒有需要處理的商品');
        return { published: 0, unpublished: 0 };
    }

    // Firestore 單一 batch 最多 500 筆寫入，超過要分批送出
    const BATCH_LIMIT = 500;
    for (let start = 0; start < updates.length; start += BATCH_LIMIT) {
        const batch = db.batch();
        updates.slice(start, start + BATCH_LIMIT).forEach(({ doc, plan }) => {
            const fields = { status: plan.status };
            plan.clearFields.forEach((field) => { fields[field] = FieldValue.delete(); });
            batch.update(doc.ref, fields);
        });
        await batch.commit();
    }

    let published = 0;
    let unpublished = 0;
    updates.forEach(({ doc, plan }) => {
        if (plan.status === 'active') published++; else unpublished++;
        console.log(`  - ${doc.id}（${doc.data().name || '未命名商品'}）→ ${plan.status === 'active' ? '上架' : '下架'}`);
    });
    return { published, unpublished };
}

async function main() {
    const serviceAccount = loadServiceAccount();
    initializeApp({ credential: cert(serviceAccount) });
    const db = getFirestore();

    const { published, unpublished } = await processScheduledTransitions(db);

    console.log(`完成。上架 ${published} 項，下架 ${unpublished} 項。`);
}

main().catch((error) => {
    console.error('排程腳本執行失敗:', error);
    process.exitCode = 1;
});
