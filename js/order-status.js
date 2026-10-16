/**
 * 訂單狀態：名稱、順序、算不算已付款，全站共用這一份
 *（前台訂單記錄、付款頁、後台訂單管理與管理首頁）。
 *
 * 資料庫裡存的是英文代碼（orders.status），畫面上顯示 label。
 * 新增或改名狀態只要改這裡；代碼一旦用了就不要改，舊訂單存的是代碼。
 *
 *   awaitingPayment  還在等顧客付款：顯示付款頁、未付款提醒、訂單記錄的勾選框
 *   paid             已經收到款項：後台改成這些狀態時會同時把 paymentConfirmed 設為 true，
 *                    第一次變成已付款時 Cloud Function 會寄「付款已確認」通知信
 *   restorable       商品還沒寄出：取消或刪除訂單時會詢問要不要把庫存加回去
 */
(function() {
    const LIST = [
        { value: 'pending',         label: '未付款',         awaitingPayment: true,  paid: false, restorable: true },
        { value: 'order_confirmed', label: '訂單確認',       awaitingPayment: true,  paid: false, restorable: true },
        { value: 'confirmed',       label: '已付款',         awaitingPayment: false, paid: true,  restorable: true },
        { value: 'preparing',       label: '確認收款備貨中', awaitingPayment: false, paid: true,  restorable: true },
        { value: 'shipped',         label: '已出貨',         awaitingPayment: false, paid: true,  restorable: false },
        { value: 'completed',       label: '已完成',         awaitingPayment: false, paid: true,  restorable: false },
        { value: 'cancelled',       label: '已取消',         awaitingPayment: false, paid: false, restorable: false }
    ];
    const byValue = {};
    LIST.forEach(function(s) { byValue[s.value] = s; });

    // 沒有狀態或不認得的狀態，一律當成「未付款」（跟以前的行為一致）
    function get(value) {
        return byValue[value] || byValue.pending;
    }

    window.OrderStatus = {
        LIST: LIST,
        get: get,
        label: function(value) { return get(value).label; },
        // 給 CSS class 用的代碼（不認得的狀態用 pending 的樣式）
        cssKey: function(value) { return get(value).value; },
        isAwaitingPayment: function(value) { return get(value).awaitingPayment; },
        isPaid: function(value) { return get(value).paid; },
        isRestorable: function(value) { return get(value).restorable; },
        AWAITING_PAYMENT: LIST.filter(function(s) { return s.awaitingPayment; }).map(function(s) { return s.value; }),
        PAID: LIST.filter(function(s) { return s.paid; }).map(function(s) { return s.value; })
    };
})();
