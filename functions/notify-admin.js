// 有新訂單時寄通知信給管理員（跟寄給顧客的「訂單成立通知信」分開，
// 其中一封寄失敗不會影響另一封）。
//
// 要增減收件人，改下面的 ADMIN_ORDER_NOTIFY_EMAILS 再重新部署 functions 即可：
//   firebase deploy --only functions:notifyAdminNewOrder

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { sendEmail } = require("./brevo");

const ADMIN_ORDER_NOTIFY_EMAILS = ["vincentsayhello@gmail.com"];

// 後台訂單管理頁支援 ?id=訂單ID，打開後會直接選到這筆訂單
const ADMIN_ORDER_URL = "https://flowerbulb.tw/admin/orders.html?id=";

const BREVO_API_KEY = defineSecret("BREVO_API_KEY");

function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatCurrency(amount) {
    return `NT$ ${Number(amount || 0).toLocaleString("zh-TW")}`;
}

// 訂單時間用台灣時區顯示（Cloud Functions 主機是 UTC），格式固定為 YYYY/MM/DD HH:mm。
// 自己組字串而不是直接用 format()：不同 Node 版本的語系資料，日期和時間中間
// 可能是特殊空白（例如 U+2009），結果不穩定
function formatTaipeiTime(timestamp) {
    const date = timestamp && typeof timestamp.toDate === "function" ? timestamp.toDate() : new Date();
    const parts = {};
    new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Taipei",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(date).forEach((part) => { parts[part.type] = part.value; });
    return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

const SHIPPING_TEXT = { store: "7-11 取貨", home: "宅配到府" };
const PAYMENT_TEXT = { transfer: "銀行轉帳", transfer_later: "稍後轉帳", credit: "信用卡" };

function buildAdminOrderEmail(order, orderId) {
    const customer = order.customer || {};
    const items = Array.isArray(order.items) ? order.items : [];
    const row = (label, value) =>
        `<tr><td style="padding:4px 8px;color:#777;white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:4px 8px;">${value}</td></tr>`;
    const itemRows = items.map((item) => `
        <tr>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(item.name)}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">x${escapeHtml(item.quantity)}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${formatCurrency(Number(item.price) * Number(item.quantity))}</td>
        </tr>`).join("");

    const subject = `【新訂單】${order.orderNumber || orderId}｜${customer.name || "顧客"}｜${formatCurrency(order.total)}`;
    const html = `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#333;">
            <h2 style="color:#2e7d4f;margin-bottom:4px;">有一筆新訂單</h2>
            <p style="margin-top:0;color:#777;">${escapeHtml(formatTaipeiTime(order.orderDate))}</p>
            <table style="border-collapse:collapse;margin:8px 0;">
                ${row("訂單編號", `<b>${escapeHtml(order.orderNumber || orderId)}</b>`)}
                ${row("顧客", escapeHtml(customer.name))}
                ${row("電話", escapeHtml(customer.phone))}
                ${row("Email", escapeHtml(customer.email) || "（未填）")}
                ${row("會員", order.userId ? "是" : "否（訪客結帳）")}
                ${row("配送", escapeHtml(SHIPPING_TEXT[order.shipping] || order.shipping))}
                ${row(order.shipping === "home" ? "地址" : "門市", escapeHtml(customer.address))}
                ${row("付款", escapeHtml(PAYMENT_TEXT[order.payment] || order.payment))}
            </table>
            <table style="width:100%;border-collapse:collapse;margin:12px 0;">
                <thead>
                    <tr style="background:#f5f5f5;">
                        <th style="padding:6px 8px;text-align:left;">商品</th>
                        <th style="padding:6px 8px;text-align:center;">數量</th>
                        <th style="padding:6px 8px;text-align:right;">小計</th>
                    </tr>
                </thead>
                <tbody>${itemRows}</tbody>
            </table>
            <p style="margin:4px 0;">商品小計：${formatCurrency(order.subtotal)}</p>
            <p style="margin:4px 0;">運費：${formatCurrency(order.shippingFee)}</p>
            <p style="margin:4px 0;font-size:1.1em;"><b>訂單總額：${formatCurrency(order.total)}</b></p>
            ${order.notes ? `<div style="background:#fff8e1;padding:10px 12px;border-radius:6px;margin:12px 0;"><b>顧客備註：</b><br>${escapeHtml(order.notes).replace(/\n/g, "<br>")}</div>` : ""}
            <p style="margin-top:20px;">
                <a href="${ADMIN_ORDER_URL}${encodeURIComponent(orderId)}"
                   style="display:inline-block;background:#2e7d4f;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">到後台查看這筆訂單</a>
            </p>
            <p style="color:#999;font-size:0.85em;">這是網站自動寄出的管理員通知。</p>
        </div>`;
    return { subject, html };
}

exports.notifyAdminNewOrder = onDocumentCreated(
    { document: "orders/{orderId}", secrets: [BREVO_API_KEY] },
    async (event) => {
        const order = event.data?.data();
        const orderId = event.params.orderId;
        if (!order) return;

        const { subject, html } = buildAdminOrderEmail(order, orderId);
        // 一位收件人寄失敗不影響其他人；錯誤只記 log，不丟出去（不讓 Cloud Functions 重試，避免重複寄信）
        for (const toEmail of ADMIN_ORDER_NOTIFY_EMAILS) {
            try {
                await sendEmail({ apiKey: BREVO_API_KEY.value(), toEmail, subject, html });
                logger.info("新訂單管理員通知信已寄出", { orderId, toEmail });
            } catch (error) {
                logger.error("新訂單管理員通知信寄送失敗", { orderId, toEmail, error: error.message });
            }
        }
    }
);

exports._internal = { buildAdminOrderEmail, ADMIN_ORDER_NOTIFY_EMAILS };
