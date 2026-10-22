// 商品排程上下架（Cloud Scheduler 每 5 分鐘觸發一次）
//
// 以前放在 GitHub Actions（scripts/product-scheduler，cron 每 15 分鐘），但 GitHub 的排程是
// best-effort：2026-10 統計 19 天只跑了 100 次（應該約 1800 次），兩次之間平均隔 4.5 小時、
// 最久近 10 小時，設定好時間的上下架常常晚好幾個小時才生效。改用 Cloud Scheduler 後準時到分鐘，
// 也不用再把服務帳戶金鑰交給 GitHub 保管。
//
// 檢查 products 集合裡，誰的 scheduledPublishAt / scheduledUnpublishAt 已經到了，
// 就把 status 改成對應的值，並清掉已經用過的排程欄位（避免重複觸發）。
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

function toMillis(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value.toMillis === "function") return value.toMillis();
    return null;
}

// 決定一個商品這次排程要變成什麼狀態（純函式，不碰資料庫，方便測試）。
//
// 上架時間、下架時間可能「兩個都已經到了」（例如排程暫停一陣子、或兩個時間設得很近），
// 這時要以「時間比較晚的那一個」為準：管理員設定「12:00 下架、14:00 重新上架」，
// 15:00 才處理到時，商品要是上架狀態。
// 回傳 null 代表沒有任何到期的排程；否則回傳 { status, clearFields }：
//   status      最後要設成的狀態（'active' 或 'inactive'）
//   clearFields 已經到期、要清掉的排程欄位
function planTransition(product, nowMs) {
    const due = [];
    const publishAt = toMillis(product.scheduledPublishAt);
    const unpublishAt = toMillis(product.scheduledUnpublishAt);
    if (publishAt !== null && publishAt <= nowMs) {
        due.push({ at: publishAt, status: "active", field: "scheduledPublishAt" });
    }
    if (unpublishAt !== null && unpublishAt <= nowMs) {
        due.push({ at: unpublishAt, status: "inactive", field: "scheduledUnpublishAt" });
    }
    if (due.length === 0) return null;

    // 時間相同時下架優先（排在後面、最後生效）
    due.sort((a, b) => a.at - b.at);
    return {
        status: due[due.length - 1].status,
        clearFields: due.map((d) => d.field),
    };
}

// 上架、下架兩種到期的排程一起處理（規則見 planTransition）。
// db、now、deleteField 由外面傳進來，測試時可以換成假的
async function processScheduledTransitions(db, now, deleteField) {
    const [publishSnap, unpublishSnap] = await Promise.all([
        db.collection("products").where("scheduledPublishAt", "<=", now).get(),
        db.collection("products").where("scheduledUnpublishAt", "<=", now).get(),
    ]);

    // 兩個查詢可能撈到同一個商品，用 id 去重
    const docsById = new Map();
    [...publishSnap.docs, ...unpublishSnap.docs].forEach((doc) => docsById.set(doc.id, doc));

    const updates = [];
    docsById.forEach((doc) => {
        const plan = planTransition(doc.data(), now.toMillis());
        if (plan) updates.push({ doc, plan });
    });

    // Firestore 單一 batch 最多 500 筆寫入，超過要分批送出
    const BATCH_LIMIT = 500;
    for (let start = 0; start < updates.length; start += BATCH_LIMIT) {
        const batch = db.batch();
        updates.slice(start, start + BATCH_LIMIT).forEach(({ doc, plan }) => {
            const fields = { status: plan.status };
            plan.clearFields.forEach((field) => { fields[field] = deleteField(); });
            batch.update(doc.ref, fields);
        });
        await batch.commit();
    }

    const changes = updates.map(({ doc, plan }) => ({
        id: doc.id,
        name: doc.data().name || "未命名商品",
        status: plan.status,
    }));
    return {
        published: changes.filter((c) => c.status === "active").length,
        unpublished: changes.filter((c) => c.status === "inactive").length,
        changes,
    };
}

exports.productScheduler = onSchedule({
    schedule: "*/5 * * * *",
    timeZone: "Asia/Taipei",
    region: "asia-east1",
    // 排程本身就會每 5 分鐘再跑一次，失敗了不用另外重試；同時只需要一個執行個體
    retryCount: 0,
    maxInstances: 1,
}, async () => {
    const result = await processScheduledTransitions(getFirestore(), Timestamp.now(), () => FieldValue.delete());
    if (result.changes.length === 0) {
        logger.debug("商品排程：沒有需要處理的商品");
        return;
    }
    result.changes.forEach((c) => logger.info(`商品排程：${c.name}（${c.id}）→ ${c.status === "active" ? "上架" : "下架"}`));
    logger.info(`商品排程完成：上架 ${result.published} 項，下架 ${result.unpublished} 項`);
});

exports._internal = { planTransition, processScheduledTransitions };
