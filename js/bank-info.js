/**
 * 銀行轉帳的收款帳戶（付款頁 pay.html、訂單完成頁 order-success.html 共用）。
 *
 * 要換帳戶時，這裡跟 functions/index.js 的 BANK_TRANSFER_INFO（訂單成立通知信裡的帳戶）要一起改。
 */
(function() {
    const info = {
        accountName: '林瑞青',
        bankName: '玉山銀行',
        bankCode: '808',
        account: '1023-979-097466'
    };

    function escape(value) {
        return String(value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /**
     * 匯款帳戶資訊區塊（含「複製帳號」按鈕）。
     * @param {number} [amount] 應付金額，有給才顯示
     */
    function html(amount) {
        return `
            <div class="bank-transfer-box">
                ${typeof amount === 'number' ? `<p class="bank-transfer-amount">應付金額：<strong>NT$ ${escape(amount.toLocaleString('zh-TW'))}</strong></p>` : ''}
                <dl>
                    <dt>銀行</dt><dd>${escape(info.bankName)}（代碼 ${escape(info.bankCode)}）</dd>
                    <dt>帳號</dt><dd><span class="bank-transfer-account">${escape(info.account)}</span>
                        <button type="button" class="bank-transfer-copy" data-copy="${escape(info.account.replace(/-/g, ''))}">複製帳號</button></dd>
                    <dt>戶名</dt><dd>${escape(info.accountName)}</dd>
                </dl>
            </div>
        `;
    }

    // 「複製帳號」：用事件代理，任何時候插入的區塊都能用
    document.addEventListener('click', function(event) {
        const button = event.target.closest && event.target.closest('.bank-transfer-copy');
        if (!button) return;
        const text = button.dataset.copy;
        const done = function() {
            button.textContent = '已複製';
            setTimeout(function() { button.textContent = '複製帳號'; }, 2000);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, function() { window.prompt('請複製帳號：', text); });
        } else {
            window.prompt('請複製帳號：', text);
        }
    });

    // 共用樣式，只注入一次
    if (!document.getElementById('bank-transfer-styles')) {
        const style = document.createElement('style');
        style.id = 'bank-transfer-styles';
        style.textContent = `
            .bank-transfer-box { background: #f1f8f2; border: 1px solid #cfe5d3; border-radius: 10px; padding: 1rem 1.25rem; margin: 1rem 0; }
            .bank-transfer-box dl { display: grid; grid-template-columns: auto 1fr; gap: .45rem 1rem; margin: 0; align-items: center; }
            .bank-transfer-box dt { color: #5c6b60; }
            .bank-transfer-box dd { margin: 0; font-weight: 600; color: #22382a; }
            .bank-transfer-account { font-size: 1.15em; letter-spacing: .03em; white-space: nowrap; }
            .bank-transfer-amount { margin: 0 0 .75rem; font-size: 1.05em; }
            .bank-transfer-amount strong { color: #c0392b; font-size: 1.2em; }
            .bank-transfer-copy { margin-left: .5rem; padding: .2rem .7rem; border: 1px solid #2e7d4f; background: #fff; color: #2e7d4f; border-radius: 999px; cursor: pointer; font-size: .85em; }
            .bank-transfer-copy:hover { background: #2e7d4f; color: #fff; }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    window.BankTransferInfo = { info: info, html: html };
})();
