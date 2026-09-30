// 建立訂單（結帳頁 payment.html 呼叫的 Callable Function）
//
// 訂單一律由這裡建立：單價、小計、運費、總額都用 Firestore 上的商品資料與運費設定
// 在伺服器端計算，不相信瀏覽器送來的金額。建訂單與扣庫存放在同一個 transaction，
// 避免兩個人同時下單造成超賣。Firestore 規則禁止顧客直接寫入 orders、直接改商品庫存，
// 所以繞過網站、自己送一筆低價訂單的做法行不通。
//
// 運費計算跟 payment.html 的 calculateShipping() 是同一套邏輯（固定運費／階梯運費、
// 滿額免運、7-11 取貨／宅配到府），修改運費規則時兩邊要一起改。
//
// 建立訂單後，index.js 的 sendOrderConfirmationEmail 會照常寄出訂單成立通知信。

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const crypto = require("crypto");

const MAX_ITEMS = 50;
const MAX_QUANTITY = 999;
const ORDER_NUMBER_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// 字串欄位：去頭尾空白並限制長度；required 時空字串直接擋下
function textField(value, label, maxLength, required) {
    const text = typeof value === "string" ? value.trim() : "";
    if (required && !text) throw new HttpsError("invalid-argument", `請填寫${label}`);
    if (text.length > maxLength) throw new HttpsError("invalid-argument", `${label}最多 ${maxLength} 個字`);
    return text;
}

// 台灣時區的今天，YYYYMMDD（Cloud Functions 主機是 UTC，不能直接用 new Date()）
function taipeiDateStamp() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date()).replace(/-/g, "");
}

// 訂單編號：BG + 台灣日期 + 4 碼隨機英數。不查詢既有訂單，也不會因為同時下單而重複
function generateOrderNumber() {
    let random = "";
    crypto.randomBytes(4).forEach((b) => { random += ORDER_NUMBER_CHARS[b % ORDER_NUMBER_CHARS.length]; });
    return `BG${taipeiDateStamp()}-${random}`;
}

// 同一個商品在購物車出現多次時合併數量；數量必須是正整數
function mergeRequestedItems(rawItems) {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
        throw new HttpsError("invalid-argument", "購物車是空的");
    }
    const merged = new Map();
    rawItems.forEach((item) => {
        const id = typeof item?.id === "string" ? item.id : "";
        const quantity = Number(item?.quantity);
        if (!id || id.includes("/") || !Number.isInteger(quantity) || quantity < 1) {
            throw new HttpsError("invalid-argument", "購物車資料有誤，請回到購物車重新確認");
        }
        const existing = merged.get(id);
        merged.set(id, {
            id,
            quantity: (existing ? existing.quantity : 0) + quantity,
            // 顧客在畫面上看到的單價，只用來判斷「價格是否已更新」，不會拿來計算金額
            expectedPrice: existing ? existing.expectedPrice : Number(item.price)
        });
    });
    const items = [...merged.values()];
    if (items.length > MAX_ITEMS) throw new HttpsError("invalid-argument", `一次最多訂購 ${MAX_ITEMS} 種商品`);
    if (items.some((item) => item.quantity > MAX_QUANTITY)) {
        throw new HttpsError("invalid-argument", `單一商品一次最多訂購 ${MAX_QUANTITY} 件`);
    }
    return items;
}

// 顧客填的資料（不含金額）
function parseCustomerInput(data, request) {
    const name = textField(data.customer?.name, "姓名", 50, true);
    const phone = textField(data.customer?.phone, "聯絡電話", 20, true);
    const email = textField(data.customer?.email, "電子郵件", 100, false);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new HttpsError("invalid-argument", "請輸入正確的電子郵件");
    }

    const shipping = data.shipping === "home" || data.shipping === "store" ? data.shipping : null;
    if (!shipping) throw new HttpsError("invalid-argument", "請選擇配送方式");

    let address;
    if (shipping === "store") {
        // 7-11 取貨：地址欄位填的是門市名稱
        address = textField(data.address?.detail, "7-11門市名稱", 100, true);
    } else {
        const city = textField(data.address?.city, "縣市", 10, true);
        const district = textField(data.address?.district, "鄉鎮市區", 10, true);
        const detail = textField(data.address?.detail, "詳細地址", 100, true);
        address = city + district + detail;
    }

    const payment = data.payment === "transfer" || data.payment === "transfer_later" ? data.payment : null;
    if (!payment) throw new HttpsError("invalid-argument", "請選擇付款方式");
    // 「稍後轉帳」要先登入，之後才能在訂單記錄裡找到、合併付款
    if (payment === "transfer_later" && !request.auth) {
        throw new HttpsError("failed-precondition", "「稍後轉帳」需要先登入會員才能使用，請先登入");
    }

    return {
        customer: { name, phone, email, address },
        shipping,
        payment,
        notes: textField(data.notes, "備註", 1000, false)
    };
}

// ---------- 運費：跟 payment.html 的 loadShippingSettings / calculateShipping 同一套邏輯 ----------

async function loadShippingSettings(db) {
    const [freeShippingSnap, calculationModeSnap, fixedRatesSnap, tieredSnap] = await Promise.all([
        db.doc("shippingSettings/freeShipping").get(),
        db.doc("shippingSettings/calculationMode").get(),
        db.doc("shippingRates/fixedRates").get(),
        db.collection("tieredRates").get()
    ]);

    const freeShipping = freeShippingSnap.exists ? freeShippingSnap.data() : {};
    const fixed = fixedRatesSnap.exists ? fixedRatesSnap.data() : {};

    return {
        freeShipping: {
            enabled: freeShipping.enabled === true,
            threshold: Number(freeShipping.threshold) || 0
        },
        calculationMode: (calculationModeSnap.exists && calculationModeSnap.data().mode) || "fixed",
        fixedRates: {
            // 舊格式 store 是物件時視為 0（跟前台一致）
            store: typeof fixed.store === "object" ? 0 : (Number(fixed.store) || 0),
            // 後台設成 0 元時要保留 0；完全沒設定才用預設 130
            home: typeof fixed.home === "number" ? fixed.home : 130
        },
        tieredRates: tieredSnap.docs
            .map((doc) => doc.data())
            .sort((a, b) => (a.minQuantity || 0) - (b.minQuantity || 0))
    };
}

// 階梯運費：從最高階梯開始套用，超出最高階梯的數量再重新套一次
function calculateTieredShipping(quantity, rates) {
    const sorted = rates.slice().sort((a, b) => (a.minQuantity || 0) - (b.minQuantity || 0));
    let totalFee = 0;
    let remaining = quantity;
    while (remaining > 0) {
        let handled = false;
        for (let i = sorted.length - 1; i >= 0; i--) {
            const rate = sorted[i];
            if (remaining >= (rate.minQuantity || 0)) {
                const useQuantity = Math.min(remaining, Number(rate.maxQuantity) || remaining);
                totalFee += Number(rate.fee) || 0;
                remaining -= useQuantity;
                handled = true;
                break;
            }
        }
        if (!handled) break;
    }
    return totalFee;
}

// items: [{ quantity, category }]
function calculateShipping(settings, items, subtotal, method) {
    if (settings.freeShipping.enabled && subtotal >= settings.freeShipping.threshold) {
        return {
            fee: 0,
            isFreeShipping: true,
            description: `購滿 ${settings.freeShipping.threshold} 元享免運優惠`
        };
    }

    if (settings.calculationMode === "fixed") {
        if (method === "home") {
            return { fee: settings.fixedRates.home, isFreeShipping: false, description: "宅配到府運費" };
        }
        return {
            fee: items.length > 0 ? settings.fixedRates.store : 0,
            isFreeShipping: false,
            description: "超商取貨運費"
        };
    }

    const categoryTotals = {};
    items.forEach((item) => {
        categoryTotals[item.category] = (categoryTotals[item.category] || 0) + item.quantity;
    });
    const applicableRates = settings.tieredRates.filter((r) => r.method === method);
    let fee = 0;
    Object.keys(categoryTotals).forEach((category) => {
        const categoryRates = applicableRates.filter((r) => r.category === category);
        if (categoryRates.length > 0) fee += calculateTieredShipping(categoryTotals[category], categoryRates);
    });
    return {
        fee,
        isFreeShipping: false,
        description: method === "home" ? "宅配到府運費 (階梯計算)" : "超商取貨運費 (階梯計算)"
    };
}

// ---------- 建立訂單 ----------

exports.createOrder = onCall({ region: "asia-east1" }, async (request) => {
    const data = request.data || {};
    const db = getFirestore();

    const input = parseCustomerInput(data, request);
    const requestedItems = mergeRequestedItems(data.items);
    const shippingSettings = await loadShippingSettings(db);

    const orderRef = db.collection("orders").doc();
    const orderNumber = generateOrderNumber();
    const userId = request.auth?.uid || null;

    // 讀商品、算金額、建訂單、扣庫存放在同一個 transaction，避免同時下單超賣
    const total = await db.runTransaction(async (transaction) => {
        const productRefs = requestedItems.map((item) => db.collection("products").doc(item.id));
        const snaps = await transaction.getAll(...productRefs);

        const problems = [];
        const priceChanges = [];
        const items = [];
        const shippingItems = [];
        snaps.forEach((snap, index) => {
            const requested = requestedItems[index];
            const product = snap.exists ? snap.data() : null;
            if (!product || product.status !== "active") {
                problems.push(`${product?.name || "部分商品"}（已下架）`);
                return;
            }
            const stock = Number(product.stock) || 0;
            const price = Number(product.price) || 0;
            const productName = product.name || "商品";
            if (stock < requested.quantity) problems.push(`${productName}（剩 ${stock} 件）`);
            if (requested.expectedPrice !== price) {
                priceChanges.push(`${productName}：NT$ ${requested.expectedPrice} → NT$ ${price}`);
            }
            items.push({ id: requested.id, name: productName, price, quantity: requested.quantity });
            shippingItems.push({ quantity: requested.quantity, category: product.category || "other" });
        });
        if (problems.length > 0) {
            throw new HttpsError("failed-precondition", `以下商品已售完或下架：${problems.join("、")}，請返回購物車調整數量`);
        }
        if (priceChanges.length > 0) {
            throw new HttpsError("failed-precondition", `以下商品價格已更新：${priceChanges.join("、")}。請返回購物車確認最新金額後再提交訂單`);
        }

        const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const shippingResult = calculateShipping(shippingSettings, shippingItems, subtotal, input.shipping);
        const orderData = {
            customer: input.customer,
            shipping: input.shipping,
            shippingFee: shippingResult.fee,
            shippingDetails: shippingResult,
            payment: input.payment,
            items,
            subtotal,
            total: subtotal + shippingResult.fee,
            notes: input.notes,
            orderDate: FieldValue.serverTimestamp(),
            status: "pending",
            orderNumber,
            // 是否已完成匯款確認；訂單記錄頁靠這個欄位判斷要不要顯示「未付款」
            paymentConfirmed: false
        };
        if (userId) orderData.userId = userId;

        transaction.set(orderRef, orderData);
        productRefs.forEach((ref, index) => {
            transaction.update(ref, {
                stock: FieldValue.increment(-items[index].quantity),
                lastUpdated: FieldValue.serverTimestamp()
            });
        });
        return orderData.total;
    });

    logger.info("訂單已建立", { orderId: orderRef.id, orderNumber, total });
    return { orderId: orderRef.id, orderNumber, total, itemCount: requestedItems.length };
});

// 給測試用：運費計算純函式
exports._internal = { calculateShipping, calculateTieredShipping, mergeRequestedItems };
