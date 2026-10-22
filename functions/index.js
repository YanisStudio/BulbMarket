const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const logger = require("firebase-functions/logger");
const { sendEmail } = require("./brevo");

initializeApp();

// 建立訂單（結帳頁呼叫）：金額、運費、庫存都在伺服器端計算與檢查，見 create-order.js
exports.createOrder = require("./create-order").createOrder;

// 顧客追加訂單備註／回報匯款：只能往後接、不能覆蓋既有內容，見 append-order-note.js
exports.appendOrderNote = require("./append-order-note").appendOrderNote;

// 有新訂單時寄通知信給管理員，收件人寫在 notify-admin.js 的 ADMIN_ORDER_NOTIFY_EMAILS
exports.notifyAdminNewOrder = require("./notify-admin").notifyAdminNewOrder;

// 商品排程上下架：Cloud Scheduler 每 5 分鐘檢查一次（以前在 GitHub Actions，見 product-scheduler.js）
exports.productScheduler = require("./product-scheduler").productScheduler;

const BREVO_API_KEY = defineSecret("BREVO_API_KEY");

function formatCurrency(amount) {
    return `NT$ ${Number(amount || 0).toLocaleString("zh-TW")}`;
}

function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// 共用的信件外框樣式，避免每個範本重複寫一樣的 CSS
function emailShell(bodyHtml) {
    return `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#333;">${bodyHtml}</div>`;
}

function buildItemsTable(items) {
    const rows = (Array.isArray(items) ? items : [])
        .map(
            (item) =>
                `<tr>
                    <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(item.name)}</td>
                    <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">x${escapeHtml(item.quantity)}</td>
                    <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${formatCurrency(item.price * item.quantity)}</td>
                </tr>`
        )
        .join("");

    return `
        <table style="width:100%;border-collapse:collapse;margin:12px 0;">
            <thead>
                <tr style="background:#f5f5f5;">
                    <th style="padding:6px 8px;text-align:left;">商品</th>
                    <th style="padding:6px 8px;text-align:center;">數量</th>
                    <th style="padding:6px 8px;text-align:right;">小計</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

// 收款帳戶。要換帳戶時，js/bank-info.js 也要一起改（網站上的付款頁、訂單完成頁讀那一份）
const BANK_TRANSFER_INFO = { accountName: "林瑞青", bankName: "玉山銀行", bankCode: "808", account: "1023-979-097466" };

// 付款頁：打開就看得到應付金額、匯款帳號，並可直接回報匯款（不用登入；會員訂單回報時要登入）
const PAY_URL = "https://flowerbulb.tw/pay.html?id=";

const PAYMENT_TEXT = { transfer: "銀行轉帳", transfer_later: "稍後轉帳", credit: "信用卡" };

// 訂單成立通知信的付款區塊：匯款帳號 + 「前往付款」按鈕。
// 以前只有一句「請回到訂單記錄完成匯款確認」，選「稍後轉帳」的顧客反映不知道要匯到哪裡
function paymentBlockHtml(order, orderId) {
    const url = PAY_URL + encodeURIComponent(orderId);
    const intro = order?.payment === "transfer_later"
        ? "您選擇了「稍後轉帳」，方便時請轉帳到以下帳戶（也可以登入網站，在「訂單記錄」把多筆未付款訂單合併一起匯款）。"
        : "請於訂單成立後 24 小時內轉帳到以下帳戶，我們確認付款後會盡快為您安排出貨。";
    const row = (label, value) =>
        `<tr><td style="padding:3px 12px 3px 0;color:#777;white-space:nowrap;">${label}</td><td style="padding:3px 0;font-weight:bold;">${value}</td></tr>`;
    return `
        <div style="background:#fff8e1;padding:14px 16px;border-radius:8px;margin:16px 0;">
            <p style="margin:0 0 10px;"><b>尚未付款：</b>${intro}</p>
            <table style="border-collapse:collapse;margin:0 0 10px;">
                ${row("應付金額", `<span style="color:#c0392b;">${formatCurrency(order?.total)}</span>`)}
                ${row("銀行", `${escapeHtml(BANK_TRANSFER_INFO.bankName)}（代碼 ${escapeHtml(BANK_TRANSFER_INFO.bankCode)}）`)}
                ${row("帳號", escapeHtml(BANK_TRANSFER_INFO.account))}
                ${row("戶名", escapeHtml(BANK_TRANSFER_INFO.accountName))}
            </table>
            <p style="margin:0 0 12px;">轉帳後請點下面的按鈕回報匯款資訊（帳號後五碼），我們核對後會寄出「付款已確認」通知信。</p>
            <a href="${url}" style="display:inline-block;background:#2e7d4f;color:#ffffff;padding:11px 22px;border-radius:6px;text-decoration:none;font-weight:bold;">前往付款／回報匯款</a>
            <p style="margin:12px 0 0;color:#888;font-size:0.85em;">按鈕無法點選時，請複製這個網址到瀏覽器開啟：<br><a href="${url}" style="color:#2e7d4f;word-break:break-all;">${url}</a></p>
        </div>`;
}

function buildOrderConfirmationEmail(order, orderId) {
    const bodyHtml = `
            <h2 style="color:#2e7d4f;">感謝您的訂購，${escapeHtml(order?.customer?.name)}！</h2>
            <p>我們已經收到您的訂單，以下是訂單明細：</p>
            <p><b>訂單編號：</b>${escapeHtml(order?.orderNumber)}</p>
            <p><b>付款方式：</b>${escapeHtml(PAYMENT_TEXT[order?.payment] || order?.payment || "")}</p>
            ${buildItemsTable(order?.items)}
            <p>商品小計：${formatCurrency(order?.subtotal)}</p>
            <p>運費：${formatCurrency(order?.shippingFee)}</p>
            <p style="font-size:1.1em;"><b>訂單總額：${formatCurrency(order?.total)}</b></p>
            ${paymentBlockHtml(order, orderId)}
            <p style="margin-top:24px;color:#777;font-size:0.9em;">如有任何問題，歡迎透過網站的聯絡我們與我們聯繫。</p>
        `;
    return {
        subject: `【球根花卉團購】訂單成立，請留意付款 - ${order?.orderNumber}`,
        bodyHtml
    };
}

async function sendOrderEmail({ order, subject, bodyHtml, logLabel, orderId }) {
    if (!order?.customer?.email) {
        logger.warn(`${logLabel}：訂單缺少顧客信箱，略過寄信`, { orderId });
        return;
    }
    try {
        await sendEmail({
            apiKey: BREVO_API_KEY.value(),
            toEmail: order.customer.email,
            toName: order.customer.name,
            subject,
            html: emailShell(bodyHtml)
        });
        logger.info(`${logLabel}已寄出`, { orderId });
    } catch (error) {
        logger.error(`${logLabel}寄送失敗`, { orderId, error: error.message });
    }
}

/**
 * 訂單建立時，寄送訂單明細＋付款提醒信給顧客。
 * 目前所有付款方式都是先建立訂單、之後才轉帳，所以一律提醒付款。
 */
exports.sendOrderConfirmationEmail = onDocumentCreated(
    { document: "orders/{orderId}", secrets: [BREVO_API_KEY] },
    async (event) => {
        const order = event.data?.data();
        const orderId = event.params.orderId;

        const { subject, bodyHtml } = buildOrderConfirmationEmail(order, orderId);

        await sendOrderEmail({
            order,
            subject,
            bodyHtml,
            logLabel: "訂單成立通知信",
            orderId
        });
    }
);

/**
 * 訂單更新時：
 * - paymentConfirmed 第一次從 false/undefined 變 true → 寄付款確認信
 * - status 第一次變成 shipped → 寄出貨通知信
 * 兩個條件各自獨立判斷，同一次更新如果剛好兩個條件都成立，兩封都會寄。
 *
 * 各自用一個 xxxEmailSentAt 欄位記錄「這封信寄過了」，避免管理員後台把狀態
 * 改來改去（例如已出貨改回已付款、又改回已出貨）時同一封信被重複寄送。
 * 這裡會反寫回同一張訂單，寫回本身也會再觸發這個函式一次，但那次的 before
 * 已經是「改過的狀態」，判斷條件會正確評估成 false，不會無限觸發。
 */
exports.sendOrderStatusEmail = onDocumentUpdated(
    { document: "orders/{orderId}", secrets: [BREVO_API_KEY] },
    async (event) => {
        const before = event.data?.before?.data();
        const after = event.data?.after?.data();
        const orderId = event.params.orderId;
        if (!after) return;

        const sentMarkers = {};

        const justPaid =
            before?.paymentConfirmed !== true &&
            after.paymentConfirmed === true &&
            !after.paymentConfirmedEmailSentAt;
        if (justPaid) {
            const bodyHtml = `
                <h2 style="color:#2e7d4f;">我們已收到您的付款</h2>
                <p>${escapeHtml(after.customer?.name)} 您好，訂單 <b>${escapeHtml(after.orderNumber)}</b> 的款項已確認收到，我們會盡快為您安排出貨，出貨後會再寄信通知您。</p>
                <p style="font-size:1.1em;"><b>訂單總額：${formatCurrency(after.total)}</b></p>
            `;
            await sendOrderEmail({
                order: after,
                subject: `【球根花卉團購】付款已確認 - ${after.orderNumber}`,
                bodyHtml,
                logLabel: "付款確認信",
                orderId
            });
            sentMarkers.paymentConfirmedEmailSentAt = new Date();
        }

        const justShipped =
            before?.status !== "shipped" &&
            after.status === "shipped" &&
            !after.shippedEmailSentAt;
        if (justShipped) {
            const bodyHtml = `
                <h2 style="color:#2e7d4f;">您的訂單已出貨</h2>
                <p>${escapeHtml(after.customer?.name)} 您好，訂單 <b>${escapeHtml(after.orderNumber)}</b> 已經出貨囉！</p>
                ${buildItemsTable(after.items)}
                <p style="margin-top:24px;color:#777;font-size:0.9em;">如有任何問題，歡迎透過網站的聯絡我們與我們聯繫。</p>
            `;
            await sendOrderEmail({
                order: after,
                subject: `【球根花卉團購】訂單已出貨 - ${after.orderNumber}`,
                bodyHtml,
                logLabel: "出貨通知信",
                orderId
            });
            sentMarkers.shippedEmailSentAt = new Date();
        }

        if (Object.keys(sentMarkers).length > 0) {
            try {
                await event.data.after.ref.set(sentMarkers, { merge: true });
            } catch (error) {
                logger.error("標記寄信時間失敗", { orderId, error: error.message });
            }
        }
    }
);

/**
 * 商家第一次回覆訊息時，通知顧客。更新既有回覆內容不會重複寄信。
 */
exports.sendMessageReplyEmail = onDocumentUpdated(
    { document: "messages/{messageId}", secrets: [BREVO_API_KEY] },
    async (event) => {
        const before = event.data?.before?.data();
        const after = event.data?.after?.data();
        if (!after || !after.email) return;

        const isFirstReply = !before?.reply && !!after.reply;
        if (!isFirstReply) return;

        const html = `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#333;">
                <h2 style="color:#2e7d4f;">您在球根花卉團購的訊息已獲得回覆</h2>
                <p><b>您的訊息主旨：</b>${escapeHtml(after.subject || "（無主旨）")}</p>
                <div style="background:#f5f5f5;padding:12px;border-radius:6px;margin:12px 0;">
                    <p style="margin:0 0 6px;color:#777;">您原本的訊息：</p>
                    <p style="margin:0;">${escapeHtml(after.message)}</p>
                </div>
                <div style="background:#e8f5e9;padding:12px;border-radius:6px;">
                    <p style="margin:0 0 6px;color:#2e7d4f;"><b>商家回覆：</b></p>
                    <p style="margin:0;">${escapeHtml(after.reply)}</p>
                </div>
                <p style="margin-top:24px;color:#777;font-size:0.9em;">登入網站的「我的訊息」可以看到完整對話紀錄。</p>
            </div>
        `;

        try {
            await sendEmail({
                apiKey: BREVO_API_KEY.value(),
                toEmail: after.email,
                toName: after.name,
                subject: "【球根花卉團購】您的訊息已獲得回覆",
                html
            });
            logger.info("訊息回覆通知信已寄出", { messageId: event.params.messageId });
        } catch (error) {
            logger.error("訊息回覆通知信寄送失敗", { messageId: event.params.messageId, error: error.message });
        }
    }
);

// 給測試用：信件內容組字串
exports._emailInternal = { buildOrderConfirmationEmail, BANK_TRANSFER_INFO };
