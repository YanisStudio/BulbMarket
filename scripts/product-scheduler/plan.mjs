// 決定一個商品這次排程要變成什麼狀態（純函式，不碰資料庫，方便測試）。
//
// 上架時間、下架時間可能「兩個都已經到了」：排程實際上大約每 3 小時才跑一次，
// 例如上架設 10:00、下架設 12:00，13:00 才跑到時兩個都到期。
// 這時要以「時間比較晚的那一個」為準——以前的寫法是固定先處理上架、再處理下架，
// 所以當管理員設定「12:00 下架、14:00 重新上架」，15:00 跑到時商品會被留在下架狀態。
//
// 參數 timestamps 只需要有 toMillis()（Firestore Timestamp）或是 Date / 毫秒數。
// 回傳 null 代表沒有任何到期的排程；否則回傳 { status, clearFields }：
//   status      最後要設成的狀態（'active' 或 'inactive'）
//   clearFields 已經到期、要清掉的排程欄位（避免下次重複觸發）

function toMillis(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value.toMillis === 'function') return value.toMillis();
    return null;
}

export function planTransition(product, nowMs) {
    const due = [];
    const publishAt = toMillis(product.scheduledPublishAt);
    const unpublishAt = toMillis(product.scheduledUnpublishAt);
    if (publishAt !== null && publishAt <= nowMs) {
        due.push({ at: publishAt, status: 'active', field: 'scheduledPublishAt' });
    }
    if (unpublishAt !== null && unpublishAt <= nowMs) {
        due.push({ at: unpublishAt, status: 'inactive', field: 'scheduledUnpublishAt' });
    }
    if (due.length === 0) return null;

    // 時間相同時維持原本的行為：下架優先（排在後面、最後生效）
    due.sort((a, b) => a.at - b.at);
    return {
        status: due[due.length - 1].status,
        clearFields: due.map((d) => d.field),
    };
}
