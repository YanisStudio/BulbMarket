const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const logger = require("firebase-functions/logger");
const { sendEmail } = require("./brevo");

initializeApp();

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

/**
 * 訂單建立時，寄送訂單確認信給顧客。
 */
exports.sendOrderConfirmationEmail = onDocumentCreated(
    { document: "orders/{orderId}", secrets: [BREVO_API_KEY] },
    async (event) => {
        const order = event.data?.data();
        if (!order || !order.customer?.email) {
            logger.warn("訂單缺少顧客信箱，略過寄信", { orderId: event.params.orderId });
            return;
        }

        const itemsHtml = (order.items || [])
            .map(
                (item) =>
                    `<tr>
                        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(item.name)}</td>
                        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">x${item.quantity}</td>
                        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${formatCurrency(item.price * item.quantity)}</td>
                    </tr>`
            )
            .join("");

        const html = `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#333;">
                <h2 style="color:#2e7d4f;">感謝您的訂購，${escapeHtml(order.customer.name)}！</h2>
                <p>我們已經收到您的訂單，以下是訂單明細：</p>
                <p><b>訂單編號：</b>${escapeHtml(order.orderNumber)}</p>
                <table style="width:100%;border-collapse:collapse;margin:12px 0;">
                    <thead>
                        <tr style="background:#f5f5f5;">
                            <th style="padding:6px 8px;text-align:left;">商品</th>
                            <th style="padding:6px 8px;text-align:center;">數量</th>
                            <th style="padding:6px 8px;text-align:right;">小計</th>
                        </tr>
                    </thead>
                    <tbody>${itemsHtml}</tbody>
                </table>
                <p>商品小計：${formatCurrency(order.subtotal)}</p>
                <p>運費：${formatCurrency(order.shippingFee)}</p>
                <p style="font-size:1.1em;"><b>訂單總額：${formatCurrency(order.total)}</b></p>
                <p style="margin-top:24px;color:#777;font-size:0.9em;">如有任何問題，歡迎透過網站的聯絡我們與我們聯繫。</p>
            </div>
        `;

        try {
            await sendEmail({
                apiKey: BREVO_API_KEY.value(),
                toEmail: order.customer.email,
                toName: order.customer.name,
                subject: `【球根花卉團購】訂單確認 - ${order.orderNumber}`,
                html
            });
            logger.info("訂單確認信已寄出", { orderId: event.params.orderId });
        } catch (error) {
            logger.error("訂單確認信寄送失敗", { orderId: event.params.orderId, error: error.message });
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
