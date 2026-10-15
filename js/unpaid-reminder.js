/**
 * 未付款訂單提醒：會員登入後，如果有還沒付款的訂單，彈出一次提醒，帶他到「訂單記錄」付款。
 *
 * - 同一個瀏覽器分頁工作階段只提醒一次（sessionStorage），不會每換一頁就跳
 * - 已經在付款相關頁面（訂單記錄、結帳、付款頁、訂單完成、購物車）就不跳
 * - 「已回報匯款、等待確認」的訂單不算未付款（見 js/common.js 的 isPaymentReported）
 * - 只查 userId 是自己的訂單（「稍後轉帳」一定要登入才能下單，所以都有 userId）
 *
 * 需要：js/common.js（escapeHtml、isPaymentReported），頁面的 window.firebaseServices
 * 要有 auth、onAuthStateChanged、db、collection、query、where、getDocs（或 getDocsFromServer）。
 * 少了任何一個就安靜地不做事，不影響頁面其他功能。
 */
(function() {
    const SKIP_PAGES = /\/(orders|pay|payment|order-success|cart)\.html$/;
    const SESSION_KEY = 'unpaidReminderShown_';

    function isUnpaid(order) {
        if (order.status !== 'pending' || order.paymentConfirmed === true) return false;
        return !(typeof isPaymentReported === 'function' && isPaymentReported(order));
    }

    async function check(user) {
        if (SKIP_PAGES.test(window.location.pathname) || window.location.pathname.indexOf('/admin/') === 0) return;
        try {
            if (sessionStorage.getItem(SESSION_KEY + user.uid)) return;
        } catch (e) { /* 無痕模式等情況讀不到 sessionStorage，照常檢查 */ }

        const s = window.firebaseServices;
        const getDocs = s && (s.getDocsFromServer || s.getDocs);
        if (!s || !s.db || !s.collection || !s.query || !s.where || !getDocs) return;

        let unpaid = [];
        try {
            const snap = await getDocs(s.query(s.collection(s.db, 'orders'), s.where('userId', '==', user.uid)));
            snap.forEach(function(doc) {
                const order = doc.data();
                if (isUnpaid(order)) unpaid.push(order);
            });
        } catch (error) {
            // 讀不到就算了，不要因為提醒功能打擾使用者；下次換頁會再試
            console.warn('檢查未付款訂單失敗:', error);
            return;
        }

        try { sessionStorage.setItem(SESSION_KEY + user.uid, '1'); } catch (e) { /* 忽略 */ }
        if (unpaid.length === 0) return;
        // 查詢期間使用者可能已經登出或換帳號
        if (!s.auth.currentUser || s.auth.currentUser.uid !== user.uid) return;
        show(unpaid);
    }

    function show(orders) {
        const total = orders.reduce(function(sum, order) { return sum + (Number(order.total) || 0); }, 0);
        const escape = typeof escapeHtml === 'function' ? escapeHtml : function(v) { return String(v); };
        const modal = document.createElement('div');
        modal.className = 'unpaid-reminder';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'unpaid-reminder-title');
        modal.innerHTML = `
            <div class="unpaid-reminder-overlay"></div>
            <div class="unpaid-reminder-box">
                <div class="unpaid-reminder-icon"><i class="fas fa-file-invoice-dollar" aria-hidden="true"></i></div>
                <h3 id="unpaid-reminder-title">您有 ${orders.length} 筆訂單尚未付款</h3>
                <p>合計 <strong>NT$ ${escape(total.toLocaleString('zh-TW'))}</strong>，請到「訂單記錄」查看匯款帳號並回報匯款，我們確認付款後就會安排出貨。</p>
                <div class="unpaid-reminder-actions">
                    <a href="/orders.html" class="btn btn-primary unpaid-reminder-go">前往付款</a>
                    <button type="button" class="btn btn-outline unpaid-reminder-later">稍後再說</button>
                </div>
            </div>
        `;
        injectStyles();
        document.body.appendChild(modal);

        const close = function() {
            modal.remove();
            document.removeEventListener('keydown', onKey);
        };
        const onKey = function(event) { if (event.key === 'Escape') close(); };
        modal.querySelector('.unpaid-reminder-later').addEventListener('click', close);
        modal.querySelector('.unpaid-reminder-overlay').addEventListener('click', close);
        document.addEventListener('keydown', onKey);
        modal.querySelector('.unpaid-reminder-go').focus();
    }

    function injectStyles() {
        if (document.getElementById('unpaid-reminder-styles')) return;
        const style = document.createElement('style');
        style.id = 'unpaid-reminder-styles';
        style.textContent = `
            .unpaid-reminder { position: fixed; inset: 0; z-index: 10050; display: flex; align-items: center; justify-content: center; padding: 1rem; }
            .unpaid-reminder-overlay { position: absolute; inset: 0; background: rgba(0,0,0,.45); }
            .unpaid-reminder-box { position: relative; background: #fff; border-radius: 14px; max-width: 400px; width: 100%; padding: 1.75rem 1.5rem 1.5rem; text-align: center; box-shadow: 0 15px 40px rgba(0,0,0,.25); }
            .unpaid-reminder-icon { font-size: 2.4rem; color: #e67e22; margin-bottom: .5rem; }
            .unpaid-reminder-box h3 { margin: 0 0 .75rem; color: #2c3e50; font-size: 1.25rem; }
            .unpaid-reminder-box p { margin: 0 0 1.25rem; color: #555; line-height: 1.7; }
            .unpaid-reminder-box strong { color: #c0392b; }
            .unpaid-reminder-actions { display: flex; gap: .75rem; justify-content: center; flex-wrap: wrap; }
        `;
        document.head.appendChild(style);
    }

    function start() {
        const s = window.firebaseServices;
        if (!s || !s.auth || !s.onAuthStateChanged) return;
        s.onAuthStateChanged(s.auth, function(user) {
            if (user) check(user);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    window.UnpaidReminder = { isUnpaid: isUnpaid };
})();
