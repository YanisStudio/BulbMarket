// 在訂單備註後面接上一段文字（顧客回報匯款、補充需求）的 Callable Function
//
// 為什麼要經過伺服器，不讓網頁端直接寫 orders.notes：
//
// 訂單完成頁（order-success.html）要讓「還沒登入的訪客」也能回報匯款，所以
// Firestore 規則以前有一條「沒有 userId 的訂單，只改 notes 就放行」的例外。
// 但那條例外沒有要求登入，等於任何人只要知道某張訪客訂單的 ID（20 碼隨機字串，
// 不好猜，但會從瀏覽紀錄、截圖外流）就能「整段覆寫」該訂單的備註——
// 把顧客填好的匯款資訊抹掉，或反過來塞一個假的【匯款確認】標記進去。
//
// 改成走這支函式之後：
//   1. 規則收緊成「只有管理員能改訂單」（見 firestore.rules）
//   2. 這裡只會「往後接」，永遠不會覆蓋或刪除既有備註
//   3. 備註格式（【匯款確認】等標記、時間戳）由伺服器產生，不是網頁端說了算
//   4. 會員訂單（有 userId）的「一般備註」要求呼叫者就是該會員本人。
//      「回報匯款」則跟訪客訂單一樣，知道訂單 ID 就能回報（見下面的說明）
//   5. 讀取與寫入在同一個 transaction 裡，兩個人同時送出不會有人的備註被蓋掉
//
// 「知道訂單 ID」仍然是訪客能回報匯款的依據，這跟規則裡 `allow get: if true`
// （訂單完成頁要讓剛下單的訪客讀得到自己的訂單）是同一套假設，沒有變得更寬鬆。

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const MAX_ORDERS_PER_CALL = 20;
// 單次追加與整個 notes 欄位的長度上限。Firestore 單一文件上限是 1MiB，
// 備註無上限成長的話，有人反覆送出就能把訂單文件撐爆、讓訂單頁再也讀不出來
const MAX_NOTE_LENGTH = 1000;
const MAX_TOTAL_NOTES_LENGTH = 20000;

// 台灣時間的 YYYY/MM/DD HH:mm:ss（Cloud Functions 主機是 UTC，不能直接用 toLocaleString）
function taipeiTimestamp() {
    const parts = new Intl.DateTimeFormat("zh-TW", {
        timeZone: "Asia/Taipei",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    }).formatToParts(new Date());
    const get = (type) => (parts.find((p) => p.type === type) || {}).value || "";
    return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

function textField(value, label, maxLength, required) {
    const text = typeof value === "string" ? value.trim() : "";
    if (required && !text) throw new HttpsError("invalid-argument", `請填寫${label}`);
    if (text.length > maxLength) throw new HttpsError("invalid-argument", `${label}最多 ${maxLength} 個字`);
    return text;
}

function parseOrderIds(raw) {
    const ids = Array.isArray(raw) ? raw : [];
    const cleaned = [...new Set(ids.filter((id) => typeof id === "string" && id && !id.includes("/")))];
    if (cleaned.length === 0) throw new HttpsError("invalid-argument", "缺少訂單編號");
    if (cleaned.length > MAX_ORDERS_PER_CALL) {
        throw new HttpsError("invalid-argument", `一次最多只能處理 ${MAX_ORDERS_PER_CALL} 筆訂單`);
    }
    return cleaned;
}

// 匯款資訊欄位。金額不換算、不驗證對不對（實際匯款金額可能跟訂單金額不同，
// 由管理員對帳時判斷），只確保是合理長度的文字
function parsePaymentFields(payment) {
    const data = payment || {};
    return {
        remitterName: textField(data.remitterName, "匯款人姓名", 50, true),
        bank: textField(data.bank, "匯款銀行", 50, true),
        amount: textField(data.amount, "匯款金額", 20, true),
        lastFiveDigits: textField(data.lastFiveDigits, "對帳後五碼", 20, true),
        date: textField(data.date, "匯款時間", 20, true),
        note: textField(data.note, "備註", 200, false)
    };
}

// 備註文字一律由伺服器組出來，網頁端只送欄位值。
// 訂單記錄頁靠 notes 裡的【匯款確認】/【合併匯款確認】標記顯示「已回報匯款・待確認」
//（見 js/common.js 的 isPaymentReported），所以這段格式兩邊要一致
function buildPaymentNote(fields, kind, orderNumbers) {
    const marker = kind === "mergePayment" ? "【合併匯款確認】" : "【匯款確認】";
    const segments = [
        `匯款人姓名: ${fields.remitterName}`,
        `匯款銀行: ${fields.bank}`,
        `匯款金額: ${fields.amount}`,
        `對帳後五碼: ${fields.lastFiveDigits}`,
        `匯款時間: ${fields.date}`
    ];
    if (kind === "mergePayment") {
        segments.push(`合併訂單: ${orderNumbers.length > 0 ? orderNumbers.join("、") : "無"}`);
    }
    segments.push(`備註: ${fields.note || "無"}`);
    segments.push(`確認時間: ${taipeiTimestamp()}`);
    return marker + segments.join(", ");
}

exports.appendOrderNote = onCall({ region: "asia-east1" }, async (request) => {
    const data = request.data || {};
    const db = getFirestore();
    const uid = request.auth?.uid || null;

    const orderIds = parseOrderIds(data.orderIds);
    const kind = ["note", "payment", "mergePayment"].includes(data.kind) ? data.kind : null;
    if (!kind) throw new HttpsError("invalid-argument", "備註類型有誤");

    if (kind === "note" && orderIds.length !== 1) {
        throw new HttpsError("invalid-argument", "新增備註一次只能針對一筆訂單");
    }

    // 顧客自己打的備註先在這裡擋長度，匯款資訊的格式則在 parsePaymentFields 檢查
    const freeText = kind === "note" ? textField(data.text, "備註", MAX_NOTE_LENGTH, true) : "";
    const paymentFields = kind === "note" ? null : parsePaymentFields(data.payment);

    const orderRefs = orderIds.map((id) => db.collection("orders").doc(id));

    const updated = await db.runTransaction(async (transaction) => {
        const snaps = await transaction.getAll(...orderRefs);

        // 先全部檢查過再寫，避免「前幾筆寫進去了、後面才發現有一筆不能改」
        snaps.forEach((snap) => {
            if (!snap.exists) throw new HttpsError("not-found", "找不到訂單資料");
            const order = snap.data();
            // 一般備註：會員訂單只有本人能加。
            //
            // 回報匯款（payment / mergePayment）：不論會員或訪客訂單，知道訂單 ID 就能回報。
            // 訂單成立通知信的「前往付款」連結就帶著訂單 ID，顧客常常是在手機上點信、
            // 而手機沒有登入，以前會員訂單會卡在「請先登入」。放寬是安全的：
            //   - 回報只會「往後接」一段匯款資訊，不會改成已付款，最後一定要管理員核對才算數
            //   - 訂單 ID 是 20 碼隨機字串，跟訪客訂單一直以來的假設相同
            if (kind === "note" && order.userId && order.userId !== uid) {
                throw new HttpsError("permission-denied", "這筆訂單不屬於目前登入的帳號");
            }
            if ((order.notes || "").length >= MAX_TOTAL_NOTES_LENGTH) {
                throw new HttpsError("resource-exhausted", "這筆訂單的備註已經太長，請改用聯絡我們告知我們");
            }
        });

        const orderNumbers = snaps.map((snap) => snap.data().orderNumber).filter(Boolean);
        const noteText = kind === "note"
            ? `[${taipeiTimestamp()}] ${freeText}`
            : buildPaymentNote(paymentFields, kind, orderNumbers);

        snaps.forEach((snap) => {
            const existing = snap.data().notes || "";
            // 只往後接，不覆蓋。匯款資訊跟既有內容空一行隔開，比較好讀
            const separator = existing ? (kind === "note" ? "\n" : "\n\n") : "";
            transaction.update(snap.ref, { notes: existing + separator + noteText });
        });

        return snaps.length;
    });

    logger.info("訂單備註已追加", { kind, orderIds, updated, uid });
    return { updated };
});
