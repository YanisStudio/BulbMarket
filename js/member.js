// 會員系統 + 瀏覽器檢測整合版本

// 清除舊版 bug 遺留下來、字面值為 "undefined"/"null" 的 localStorage 髒資料
// （localStorage 只能存字串，過去把 undefined 直接存進去會變成字面字串 "undefined"，
//   而這個字串是 truthy，會被誤判成「有效的使用者名稱」一直卡住）
(function cleanupCorruptedLocalStorage() {
    ['userName', 'username'].forEach((key) => {
        const value = localStorage.getItem(key);
        if (value === 'undefined' || value === 'null') {
            localStorage.removeItem(key);
        }
    });
})();

// 修改 CSS 樣式部分
function injectBrowserWarningStyles() {
    if (document.querySelector('#browser-warning-styles')) return;
    
    const styles = document.createElement('style');
    styles.id = 'browser-warning-styles';
    styles.textContent = `
        /* 瀏覽器檢測相關樣式 */
        .browser-warning {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.9);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            box-sizing: border-box;
        }

        .browser-warning-content {
            background: white;
            border-radius: 15px;
            padding: 30px;
            text-align: center;
            max-width: 420px;
            width: 100%;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
            animation: browserSlideIn 0.3s ease-out;
            position: relative;
        }

        .browser-warning-icon {
            font-size: 3rem;
            color: #4caf50;
            margin-bottom: 20px;
        }

        .browser-warning-content h2 {
            color: #333;
            margin: 0 0 15px 0;
            font-size: 1.5rem;
        }

        .browser-warning-content p {
            color: #666;
            line-height: 1.6;
            margin: 10px 0;
        }

        .browser-buttons {
            display: flex;
            flex-direction: column;
            gap: 12px;
            margin-top: 25px;
        }

        .browser-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            border: none;
            border-radius: 10px;
            font-weight: 600;
            text-decoration: none;
            transition: all 0.3s ease;
            cursor: pointer;
            font-family: inherit;
        }

        .browser-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
        }

        /* Chrome 按鈕 - 主要行動按鈕 */
        .chrome-btn {
            background: linear-gradient(135deg, #4caf50, #2e7d32);
            color: white;
            padding: 18px 25px;
            font-size: 1.1rem;
            box-shadow: 0 4px 15px rgba(76, 175, 80, 0.3);
        }

        .chrome-btn:hover {
            background: linear-gradient(135deg, #43a047, #1b5e20);
            box-shadow: 0 6px 20px rgba(76, 175, 80, 0.4);
            transform: translateY(-3px);
        }

        .chrome-btn i {
            margin-right: 12px;
            font-size: 1.3rem;
        }

        /* 繼續使用按鈕 - 次要選項 */
        .continue-btn {
            background: transparent;
            color: #999;
            border: 1px solid #ddd;
            padding: 10px 15px;
            font-size: 0.85rem;
            margin-top: 15px;
        }

        .continue-btn:hover {
            background: #f5f5f5;
            color: #666;
            transform: translateY(-1px);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .continue-btn i {
            margin-right: 8px;
            font-size: 0.9rem;
        }

        @keyframes browserSlideIn {
            from { opacity: 0; transform: scale(0.9) translateY(-20px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
        }

        /* 添加說明文字 */
        .chrome-benefits {
            background: #e8f5e9;
            border-left: 4px solid #4caf50;
            padding: 12px 15px;
            margin: 15px 0;
            border-radius: 5px;
            text-align: left;
            font-size: 0.9rem;
        }

        .chrome-benefits h4 {
            margin: 0 0 8px 0;
            color: #2e7d32;
            font-size: 1rem;
        }

        .chrome-benefits p {
            margin: 0;
            color: #555;
            line-height: 1.4;
        }

        @media (max-width: 480px) {
            .browser-warning-content {
                padding: 20px;
                margin: 10px;
            }
            
            .browser-warning-content h2 {
                font-size: 1.3rem;
            }
            
            .chrome-btn {
                padding: 16px 20px;
                font-size: 1rem;
            }
            
            .continue-btn {
                padding: 8px 12px;
                font-size: 0.8rem;
            }
        }
    `;
    document.head.appendChild(styles);
}

// 修改 HTML 內容部分
function injectBrowserWarningHTML() {
    if (document.querySelector('#browser-warning')) return;
    
    const warningHTML = `
        <div id="browser-warning" class="browser-warning" style="display: none;">
            <div class="browser-warning-content">
                <div class="browser-warning-icon">
                    <i class="fas fa-exclamation-triangle"></i>
                </div>
                
                <h2>建議使用外部瀏覽器</h2>
                <p>您目前使用的是 ${window.BrowserDetection ? window.BrowserDetection.getBrowserName() : 'LINE'} 內建瀏覽器，某些功能可能無法正常使用。</p>
                
                <div class="chrome-benefits">
                    <h4>使用外部瀏覽器的優勢：</h4>
                    <p>• 完整功能支援，登入更順暢<br>• 更快的載入速度<br>• 更安全的瀏覽體驗</p>
                </div>

                <div class="browser-buttons">
                    <button class="browser-btn chrome-btn" onclick="window.BrowserDetection.openInGoogleChrome()">
                        <i class="fab fa-chrome"></i>
                        立即使用 Google Chrome 開啟
                    </button>
                    <button class="browser-btn continue-btn" onclick="window.BrowserDetection.continueWithCurrentBrowser()">
                        <i class="fas fa-forward"></i>
                        略過並繼續
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', warningHTML);
}

// 瀏覽器檢測功能（使用會話級記憶）
const BrowserDetection = {
    // 檢測是否為 LINE 瀏覽器
    isLINEBrowser() {
        const userAgent = navigator.userAgent.toLowerCase();
        return userAgent.includes('line/') || 
               userAgent.includes('linewebview') ||
               userAgent.includes('linelite');
    },

    // 檢測是否為手機
    isMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    },

    // 檢測其他常見的內建瀏覽器
    isInAppBrowser() {
        const userAgent = navigator.userAgent.toLowerCase();
        return userAgent.includes('fbav') ||     // Facebook
               userAgent.includes('fban') ||     // Facebook
               userAgent.includes('instagram') || // Instagram
               userAgent.includes('twitter') ||   // Twitter
               userAgent.includes('tiktok') ||    // TikTok
               userAgent.includes('micromessenger') || // WeChat
               userAgent.includes('line/') ||     // LINE
               userAgent.includes('kakaotalk');   // KakaoTalk
    },

    // 檢測具體的瀏覽器類型
    getBrowserName() {
        const userAgent = navigator.userAgent.toLowerCase();
        
        if (userAgent.includes('line/') || userAgent.includes('linewebview') || userAgent.includes('linelite')) {
            return 'LINE';
        } else if (userAgent.includes('fbav') || userAgent.includes('fban')) {
            return 'Facebook';
        } else if (userAgent.includes('instagram')) {
            return 'Instagram';
        } else if (userAgent.includes('twitter')) {
            return 'Twitter';
        } else if (userAgent.includes('tiktok')) {
            return 'TikTok';
        } else if (userAgent.includes('micromessenger')) {
            return 'WeChat';
        } else if (userAgent.includes('kakaotalk')) {
            return 'KakaoTalk';
        } else {
            return '內建';
        }
    },

    // 新增：直接開啟 Google Chrome
    openInGoogleChrome() {
        const currentUrl = window.location.href;
        
        try {
            // 檢測平台並使用對應的方法
            if (this.isMobile()) {
                // 手機平台
                if (navigator.userAgent.match(/iPhone|iPad/)) {
                    // iOS 設備
                    // 嘗試使用 Chrome 的 URL scheme
                    const chromeUrl = `googlechrome://${currentUrl.replace(/^https?:\/\//, '')}`;
                    window.location.href = chromeUrl;
                    
                    // 如果 Chrome 沒有安裝，回退到 Safari
                    setTimeout(() => {
                        window.location.href = currentUrl;
                    }, 1500);
                } else if (navigator.userAgent.match(/Android/)) {
                    // Android 設備
                    // 使用 Intent 嘗試開啟 Chrome
                    const intentUrl = `intent://${currentUrl.replace(/^https?:\/\//, '')}#Intent;scheme=https;package=com.android.chrome;end`;
                    window.location.href = intentUrl;
                    
                    // 如果 Chrome 沒有安裝，回退到默認瀏覽器
                    setTimeout(() => {
                        window.location.href = currentUrl;
                    }, 1500);
                }
            } else {
                // 桌面平台 - 開啟新分頁
                window.open(currentUrl, '_blank');
            }
            
            // 關閉警告彈窗
            this.closeBrowserWarning();
            
        } catch (error) {
            console.error('開啟外部瀏覽器失敗:', error);
            // 如果所有方法都失敗，嘗試直接開啟連結
            try {
                window.open(currentUrl, '_blank');
            } catch (fallbackError) {
                console.error('備用方案也失敗:', fallbackError);
                alert('無法自動開啟外部瀏覽器，請手動複製網址到 Chrome 瀏覽器中開啟：\n\n' + currentUrl);
            }
        }
    },

    // 顯示瀏覽器警告（使用 sessionStorage 記憶）
    showBrowserWarning() {
        // 檢查會話期間是否已經顯示過警告
        const hasShownWarning = sessionStorage.getItem('browserWarningShown');
        
        // 如果這個會話中已經顯示過，就不再顯示
        if (hasShownWarning === 'true') {
            console.log('本次會話已顯示過瀏覽器警告，跳過顯示');
            return;
        }

        // 確保 HTML 已注入
        injectBrowserWarningHTML();

        const warningElement = document.getElementById('browser-warning');
        if (warningElement) {
            warningElement.style.display = 'flex';
            
            // 標記這個會話已經顯示過警告
            sessionStorage.setItem('browserWarningShown', 'true');
            console.log('已顯示瀏覽器警告，並標記會話狀態');
        }
    },

    // 關閉瀏覽器警告
    closeBrowserWarning() {
        const warningElement = document.getElementById('browser-warning');
        if (warningElement) {
            warningElement.style.display = 'none';
        }
    },

    // 繼續使用當前瀏覽器
    continueWithCurrentBrowser() {
        this.closeBrowserWarning();
    },

    // 修改登入按鈕行為，在 LINE 瀏覽器中優先引導使用電話登入
    handleLoginButtonClick(loginType) {
        if (this.isLINEBrowser() && (loginType === 'google' || loginType === 'facebook')) {
            // 在 LINE 瀏覽器中，如果用戶點擊 Google 或 Facebook 登入
            if (window.showMemberWarningModal) {
                window.showMemberWarningModal(
                    '建議使用其他登入方式',
                    '在 LINE 瀏覽器中，Google 和 Facebook 登入可能無法正常運作。建議您：\n\n1. 使用電話號碼登入\n2. 或在外部瀏覽器中開啟此網頁'
                );
            } else {
                alert('在 LINE 瀏覽器中，Google 和 Facebook 登入可能無法正常運作。建議您：\n\n1. 使用電話號碼登入\n2. 或在外部瀏覽器中開啟此網頁');
            }
            return false; // 阻止繼續執行登入
        }
        return true; // 允許繼續執行登入
    },

    // 初始化瀏覽器檢測
    init() {
        // 注入樣式
        injectBrowserWarningStyles();
        
        // 如果是 LINE 瀏覽器或其他內建瀏覽器，顯示警告
        if (this.isLINEBrowser() || this.isInAppBrowser()) {
            // 延遲 1 秒顯示，讓頁面有時間載入
            setTimeout(() => {
                this.showBrowserWarning();
            }, 1000);
        }
    },

    // 新增：重置會話記憶（供測試使用）
    resetSessionMemory() {
        sessionStorage.removeItem('browserWarningShown');
        console.log('已重置瀏覽器警告會話記憶');
    }
};

// 將 BrowserDetection 暴露給全域
window.BrowserDetection = BrowserDetection;

// 自定義彈窗樣式注入
function injectModalStyles() {
    if (document.querySelector('#member-modal-styles')) return;
    
    const styles = document.createElement('style');
    styles.id = 'member-modal-styles';
    styles.textContent = `
        /* 會員系統自定義彈窗樣式 */
        .member-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .member-modal-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            cursor: pointer;
        }
        
        .member-modal-content {
            background: white;
            padding: 2.5rem;
            border-radius: 15px;
            text-align: center;
            max-width: 450px;
            margin: 0 1rem;
            position: relative;
            z-index: 1;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
            border: 1px solid #e0e0e0;
        }
        
        .member-modal-icon {
            font-size: 3rem;
            margin-bottom: 1rem;
        }
        
        .member-modal-content h3 {
            margin: 0 0 1rem 0;
            font-size: 1.4rem;
        }
        
        .member-modal-content p {
            margin: 0.5rem 0 1.5rem 0;
            line-height: 1.6;
            color: #666;
        }
        
        .member-modal-actions {
            display: flex;
            gap: 1rem;
            justify-content: center;
            flex-wrap: wrap;
        }
        
        .member-modal-actions .btn {
            padding: 0.8rem 1.5rem;
            border-radius: 8px;
            text-decoration: none;
            font-weight: 600;
            transition: transform 0.2s ease;
            min-width: 120px;
            border: none;
            cursor: pointer;
        }
        
        .member-modal-actions .btn:hover {
            transform: translateY(-2px);
        }

        /* 成功彈窗樣式 */
        .member-success-modal .member-modal-icon {
            color: #4caf50;
            animation: memberCheckAnimation 0.6s ease-in-out;
        }

        .member-success-modal .member-modal-content h3 {
            color: #2c5530;
        }

        .member-success-modal .btn {
            background: linear-gradient(135deg, #66bb6a, #4caf50);
            color: white;
        }

        @keyframes memberCheckAnimation {
            0% { transform: scale(0); }
            50% { transform: scale(1.2); }
            100% { transform: scale(1); }
        }

        /* 錯誤彈窗樣式 */
        .member-error-modal .member-modal-icon {
            color: #f44336;
            animation: memberShakeAnimation 0.6s ease-in-out;
        }

        .member-error-modal .member-modal-content h3 {
            color: #c62828;
        }

        .member-error-modal .btn {
            background: linear-gradient(135deg, #f44336, #e53935);
            color: white;
        }

        @keyframes memberShakeAnimation {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-5px); }
            75% { transform: translateX(5px); }
        }

        /* 警告彈窗樣式 */
        .member-warning-modal .member-modal-icon {
            color: #ff9800;
            animation: memberPulseAnimation 1s ease-in-out infinite;
        }

        .member-warning-modal .member-modal-content h3 {
            color: #f57c00;
        }

        .member-warning-modal .btn {
            background: linear-gradient(135deg, #ff9800, #f57c00);
            color: white;
        }

        @keyframes memberPulseAnimation {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.1); }
        }

        @media (max-width: 768px) {
            .member-modal-actions {
                flex-direction: column;
                align-items: center;
            }
            
            .member-modal-actions .btn {
                width: 100%;
                max-width: 200px;
            }
        }
    `;
    document.head.appendChild(styles);
}

// 顯示成功彈窗
function showMemberSuccessModal(title, message) {
    injectModalStyles();
    
    const modal = document.createElement('div');
    modal.className = 'member-modal member-success-modal';
    modal.innerHTML = `
        <div class="member-modal-overlay"></div>
        <div class="member-modal-content">
            <div class="member-modal-icon">
                <i class="fas fa-check-circle"></i>
            </div>
            <h3>${title}</h3>
            <p>${message}</p>
            <div class="member-modal-actions">
                <button class="btn" onclick="closeMemberModal(this)">確定</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // 點擊背景關閉
    modal.querySelector('.member-modal-overlay').addEventListener('click', function() {
        closeMemberModal(modal);
    });
    
    // 3秒後自動關閉
    setTimeout(() => {
        if (document.body.contains(modal)) {
            closeMemberModal(modal);
        }
    }, 3000);
}

// 顯示錯誤彈窗
function showMemberErrorModal(title, message) {
    injectModalStyles();
    
    const modal = document.createElement('div');
    modal.className = 'member-modal member-error-modal';
    modal.innerHTML = `
        <div class="member-modal-overlay"></div>
        <div class="member-modal-content">
            <div class="member-modal-icon">
                <i class="fas fa-exclamation-triangle"></i>
            </div>
            <h3>${title}</h3>
            <p>${message}</p>
            <div class="member-modal-actions">
                <button class="btn" onclick="closeMemberModal(this)">確定</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // 點擊背景關閉
    modal.querySelector('.member-modal-overlay').addEventListener('click', function() {
        closeMemberModal(modal);
    });
}

// 顯示警告彈窗
function showMemberWarningModal(title, message) {
    injectModalStyles();
    
    const modal = document.createElement('div');
    modal.className = 'member-modal member-warning-modal';
    modal.innerHTML = `
        <div class="member-modal-overlay"></div>
        <div class="member-modal-content">
            <div class="member-modal-icon">
                <i class="fas fa-exclamation-triangle"></i>
            </div>
            <h3>${title}</h3>
            <p style="white-space: pre-line;">${message}</p>
            <div class="member-modal-actions">
                <button class="btn" onclick="closeMemberModal(this)">確定</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // 點擊背景關閉
    modal.querySelector('.member-modal-overlay').addEventListener('click', function() {
        closeMemberModal(modal);
    });
}

// 關閉彈窗的通用函數
function closeMemberModal(element) {
    let modal;
    if (element.classList && element.classList.contains('member-modal')) {
        modal = element;
    } else {
        modal = element.closest('.member-modal');
    }
    
    if (modal && document.body.contains(modal)) {
        modal.remove();
    }
}

// 將關閉函數設為全域，供 onclick 使用
window.closeMemberModal = closeMemberModal;
window.showMemberSuccessModal = showMemberSuccessModal;
window.showMemberErrorModal = showMemberErrorModal;
window.showMemberWarningModal = showMemberWarningModal;

// 管理員檢查函數：讀取 Firebase Auth custom claim（admin: true），
// 取代舊版寫死信箱清單的做法。新增/移除管理員改用
// scripts/set-admin-claims 那支腳本設定 claim，不用再改這裡的程式碼。
async function isAdmin(user) {
    if (!user) return false;
    try {
        const tokenResult = await user.getIdTokenResult();
        return tokenResult.claims.admin === true;
    } catch (error) {
        console.error('讀取管理員權限失敗:', error);
        return false;
    }
}

// 用戶登入狀態操作函數
async function saveUserState(user) {
    if (user) {
        localStorage.setItem('userIsLoggedIn', 'true');
        localStorage.setItem('userEmail', user.email || '');
        // 使用管理員檢查函數
        if (await isAdmin(user)) {
            localStorage.setItem('isAdmin', 'true');
        } else {
            localStorage.removeItem('isAdmin');
        }
    } else {
        localStorage.removeItem('userIsLoggedIn');
        localStorage.removeItem('userEmail');
        localStorage.removeItem('userName');
        localStorage.removeItem('isAdmin');
    }
}

document.addEventListener('DOMContentLoaded', function() {
    // 初始化瀏覽器檢測
    BrowserDetection.init();
    
    // 獲取各種元素
    const userActions = document.getElementById('user-actions');
    const userProfile = document.getElementById('user-profile');
    const usernameDisplay = document.getElementById('username-display');
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const userDropdownBtn = document.getElementById('user-dropdown-btn');
    const userMenu = document.getElementById('user-menu');
    
    // 獲取管理員按鈕元素
    const adminBtn = document.getElementById('admin-btn');
    const adminBtnMobile = document.getElementById('admin-btn-mobile');
    
    // 手機版元素
    const userActionsMobile = document.getElementById('user-actions-mobile');
    const userProfileMobile = document.getElementById('user-profile-mobile');
    const usernameDisplayMobile = document.getElementById('username-display-mobile');

    // 從window對象獲取Firebase服務
    const {
        auth,
        getAuth,
        signOut, 
        onAuthStateChanged,
        doc,
        setDoc,
        getDoc,
        collection,
        serverTimestamp,
        // Google 登入相關函數
        GoogleAuthProvider,
        signInWithPopup,
        signInWithRedirect,
        getRedirectResult,
        // Facebook 登入相關函數
        FacebookAuthProvider,
        // 電話號碼登入相關函數
        RecaptchaVerifier,
        signInWithPhoneNumber,
        PhoneAuthProvider,
        signInWithCredential
    } = window.firebaseServices || {};

    // 全局變量儲存確認結果
    let confirmationResult = null;

    // 檢查當前登入用戶是否為管理員
    const checkIfAdmin = async function(user) {
        if (user && await isAdmin(user)) {
            console.log('管理員登入:', user.email);
            if (adminBtn) adminBtn.style.display = 'block';
            if (adminBtnMobile) adminBtnMobile.style.display = 'block';
            localStorage.setItem('isAdmin', 'true');
        } else {
            if (adminBtn) adminBtn.style.display = 'none';
            if (adminBtnMobile) adminBtnMobile.style.display = 'none';
            localStorage.removeItem('isAdmin');
        }
    };

    // 台灣手機號碼格式驗證
    function isValidPhoneNumber(phoneNumber) {
        // 檢查手機號碼的長度是否為 10 碼
        if (phoneNumber.length !== 10) {
            return false;
        }

        // 檢查手機號碼的第一個數字是否為 0
        if (phoneNumber[0] !== "0") {
            return false;
        }

        // 使用正規表達式，檢查手機號碼是否符合全數字不帶任何符號的格式
        const regex = /^09\d{8}$/;
        return regex.test(phoneNumber);
    }

    // 設定 reCAPTCHA
    function setUpRecaptcha(phoneNumber) {
        if (window.recaptchaVerifier) {
            try {
                window.recaptchaVerifier.clear();
            } catch (e) {
                console.log('清除 reCAPTCHA 錯誤:', e);
            }
            window.recaptchaVerifier = null;
        }

        // 顯示 reCAPTCHA 容器
        if (window.authModals) {
            window.authModals.showRecaptchaContainer();
        }

        // 清空容器
        const container = document.getElementById('recaptcha-container');
        if (container) {
            container.innerHTML = '';
        }

        try {
            window.recaptchaVerifier = new RecaptchaVerifier(
                auth,
                "recaptcha-container",
                {
                    'size': 'normal',
                    'callback': (response) => {
                        console.log('reCAPTCHA 驗證成功');
                        if (window.authModals) {
                            window.authModals.showPhoneMessage('reCAPTCHA 驗證完成，正在發送驗證碼...', false);
                        }
                        // reCAPTCHA 完成後自動發送驗證碼
                        sendVerificationCode(phoneNumber);
                    },
                    'expired-callback': () => {
                        if (window.authModals) {
                            window.authModals.showPhoneMessage('reCAPTCHA 已過期，請重新驗證', true);
                        }
                        // 重新設定 reCAPTCHA
                        setTimeout(() => {
                            setUpRecaptcha(phoneNumber);
                        }, 1000);
                    }
                }
            );
            
            return window.recaptchaVerifier.render().then((widgetId) => {
                console.log('reCAPTCHA 渲染成功');
                if (window.authModals) {
                    window.authModals.showPhoneMessage('請完成 reCAPTCHA 驗證', false);
                }
                return widgetId;
            }).catch((error) => {
                console.error('reCAPTCHA 渲染錯誤:', error);
                
                let errorMessage = 'reCAPTCHA 載入失敗: ';
                if (error.code === 'auth/app-not-authorized') {
                    errorMessage += '網域未授權，請檢查 Firebase 控制台的授權網域設定';
                } else if (error.message.includes('network')) {
                    errorMessage += '網路連線問題';
                } else {
                    errorMessage += error.message;
                }
                
                if (window.authModals) {
                    window.authModals.showPhoneMessage(errorMessage, true);
                }
                throw error;
            });
            
        } catch (error) {
            console.error('建立 reCAPTCHA 錯誤:', error);
            if (window.authModals) {
                window.authModals.showPhoneMessage('無法初始化 reCAPTCHA，請檢查網域設定', true);
            }
            throw error;
        }
    }

    // 發送驗證碼
    async function sendVerificationCode(phoneNumber) {
        try {
            // 轉換為國際格式
            const internationalPhone = phoneNumber.replace(/^0/, '+886');
            console.log('發送驗證碼到:', internationalPhone);

            confirmationResult = await signInWithPhoneNumber(auth, internationalPhone, window.recaptchaVerifier);
            
            console.log('驗證碼已發送');
            
            if (window.authModals) {
                window.authModals.showPhoneMessage('驗證碼已發送至您的手機，請輸入驗證碼', false);
                window.authModals.showVerificationSection();
                // 隱藏 reCAPTCHA 容器
                window.authModals.hideRecaptchaContainer();
            }
            
        } catch (error) {
            console.error('發送簡訊錯誤:', error);
            let errorMessage = '發送失敗: ';
            
            switch (error.code) {
                case 'auth/invalid-phone-number':
                    errorMessage += '無效的手機號碼格式';
                    break;
                case 'auth/too-many-requests':
                    errorMessage += '請求過於頻繁，請稍後再試';
                    break;
                case 'auth/internal-error-encountered':
                    errorMessage += '系統內部錯誤，請檢查網域設定或稍後再試';
                    break;
                case 'auth/app-not-authorized':
                    errorMessage += '應用程式未獲授權，請檢查 Firebase 設定';
                    break;
                default:
                    errorMessage += error.message;
            }
            
            if (window.authModals) {
                window.authModals.showPhoneMessage(errorMessage, true);
            }
            
            // 重置 reCAPTCHA
            if (window.recaptchaVerifier) {
                window.recaptchaVerifier.clear();
                window.recaptchaVerifier = null;
            }
        }
    }

    // 電話號碼登入功能實現
    async function handlePhoneLogin(phoneNumber) {
        if (!RecaptchaVerifier || !signInWithPhoneNumber) {
            showMemberErrorModal('功能未啟用', '電話號碼登入功能未啟用，請聯繫網站管理員。');
            return;
        }

        // 驗證電話號碼格式
        if (!isValidPhoneNumber(phoneNumber)) {
            if (window.authModals) {
                window.authModals.showPhoneMessage('請輸入正確的台灣手機號碼格式（09開頭，共10位數字）', true);
            }
            return;
        }

        try {
            if (window.authModals) {
                window.authModals.showPhoneMessage('正在載入 reCAPTCHA...', false);
            }
            
            await setUpRecaptcha(phoneNumber);
            
        } catch (error) {
            console.error('設定 reCAPTCHA 錯誤:', error);
            if (window.authModals) {
                window.authModals.showPhoneMessage('目前無法驗證，請檢查網域設定或重新整理頁面', true);
            }
        }
    }

    // 驗證電話號碼驗證碼
    async function verifyPhoneCode(code) {
        if (!confirmationResult) {
            showMemberErrorModal('驗證錯誤', '請先發送驗證碼');
            return;
        }

        try {
            if (window.authModals) {
                window.authModals.showPhoneMessage('正在驗證...', false);
            }

            const result = await confirmationResult.confirm(code);
            const user = result.user;

            console.log('電話號碼登入成功:', user.uid);

            saveUserState(user);
            
            // 電話登入的用戶顯示為 "手機用戶"
            const displayName = '手機用戶';
            
            localStorage.setItem('userName', displayName);
            checkIfAdmin(user);

            // 保存或更新用戶資料到 Firestore
            await saveUserToFirestore(user, displayName, 'phone');

            if (window.authModals) {
                window.authModals.hideAllModals();
            }

            updateLoginUI(user);
            showMemberSuccessModal('登入成功', '電話號碼登入成功！');

        } catch (error) {
            console.error('驗證碼驗證失敗:', error);
            
            let errorMessage = '驗證失敗: ';
            if (error.code === 'auth/invalid-verification-code') {
                errorMessage += '驗證碼錯誤，請檢查並重新輸入';
            } else if (error.code === 'auth/code-expired') {
                errorMessage += '驗證碼已過期，請重新發送';
            } else {
                errorMessage += error.message;
            }
            
            if (window.authModals) {
                window.authModals.showPhoneMessage(errorMessage, true);
            }
        }
    }

    // 重新發送驗證碼
    async function resendVerificationCode() {
        const phoneNumber = document.getElementById('phone-number').value;
        if (!phoneNumber) {
            if (window.authModals) {
                window.authModals.showPhoneMessage('請輸入電話號碼', true);
            }
            return;
        }

        // 重置 reCAPTCHA 驗證器
        if (window.recaptchaVerifier) {
            window.recaptchaVerifier.clear();
            window.recaptchaVerifier = null;
        }

        await handlePhoneLogin(phoneNumber);
    }

    // 保存用戶資料到 Firestore
async function saveUserToFirestore(user, displayName, provider) {
    try {
        // 用 window.firebaseServices.db 即時讀取，而不是用外層 DOMContentLoaded
        // 一開始就解構快取住的 db：連線發生問題被重建後，快取住的舊 db 會失效，
        // 即時讀取才能自動用到重建後的新連線
        const userRef = doc(window.firebaseServices.db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        
        // 處理電話號碼格式 - 從 +886 轉換為 09
        let phoneNumber = '';
        if (user.phoneNumber) {
            phoneNumber = user.phoneNumber.replace(/^\+886/, '0');
        }
        
        if (!userSnap.exists()) {
            // 新用戶，創建用戶文檔
            const currentTime = serverTimestamp(); // 定義 currentTime 變數
            const userData = {
                email: user.email || '',
                photoURL: user.photoURL || '',
                provider: provider,
                createdAt: currentTime,        // 註冊時間
                lastLoginAt: currentTime,      // 初次登入時間（與註冊時間相同）
                city: '',
                district: '',
                address: ''
            };
            
            // 根據登入方式決定 name 和 phone 欄位
            if (provider === 'phone') {
                userData.name = ''; // 讓用戶自己填寫姓名
                userData.phone = phoneNumber; // 電話號碼放在 phone 欄位
            } else {
                userData.name = displayName; // Google/Facebook 的顯示名稱
                userData.phone = ''; // 其他登入方式 phone 欄位為空
            }
            
            await setDoc(userRef, userData);
            console.log('新用戶資料已保存:', userData);
            
            // 重要：設置更長時間的標記，並加上時間戳記
            const creationTime = Date.now();
            localStorage.setItem('newUserCreated_' + user.uid, creationTime.toString());
            localStorage.setItem('lastLoginUpdate_' + user.uid, creationTime.toString());
            
            console.log('新用戶創建完成，已設置保護標記');
            
            // 記錄是否有權限問題
            if ((provider === 'google' || provider === 'facebook') && !user.email) {
                console.warn(`${provider} 登入時未獲得 email 權限，用戶可能拒絕了權限請求`);
            }
            
        } else {
            // 現有用戶，檢查是否需要更新 lastLoginAt
            const existingData = userSnap.data();
            
            // 檢查是否為剛創建的新用戶（5分鐘內）
            const newUserCreationTime = localStorage.getItem('newUserCreated_' + user.uid);
            const now = Date.now();
            const isRecentlyCreated = newUserCreationTime && 
                (now - parseInt(newUserCreationTime)) < 300000; // 5分鐘
            
            if (isRecentlyCreated) {
                console.log('跳過新創建用戶的登入時間更新（5分鐘保護期）');
                
                // 如果 Firestore 中有更完整的用戶名，使用 Firestore 的
                const firestoreUserName = existingData.name;
                if (firestoreUserName) {
                    localStorage.setItem('userName', firestoreUserName);
                }
                
                return; // 直接返回，不做任何更新
            }
            
            // 檢查上次更新時間，避免頻繁更新
            const lastUpdate = localStorage.getItem('lastLoginUpdate_' + user.uid);
            const shouldUpdateLogin = !lastUpdate || (now - parseInt(lastUpdate)) > 300000; // 5分鐘內不重複更新
            
            const updateData = {};
            
            // 只有在需要時才更新 lastLoginAt
            if (shouldUpdateLogin) {
                updateData.lastLoginAt = serverTimestamp();
                localStorage.setItem('lastLoginUpdate_' + user.uid, now.toString());
                console.log('更新現有用戶最後登入時間');
            }
            
            // 只檢查並補充缺失的 email（僅限 Google/Facebook 登入）
            if ((provider === 'google' || provider === 'facebook') && user.email) {
                // 如果資料庫中沒有 email 或 email 為空，則更新
                if (!existingData.email || existingData.email === '') {
                    updateData.email = user.email;
                    console.log(`補充缺失的 email: ${user.email}`);
                }
                // 如果資料庫中的 email 與登入的 email 不同，也更新
                else if (existingData.email !== user.email) {
                    updateData.email = user.email;
                    console.log(`更新 email: ${existingData.email} -> ${user.email}`);
                }
            }
            
            // 如果是電話登入，更新電話號碼
            if (provider === 'phone') {
                updateData.phone = phoneNumber;
            }
            
            // 只有當有實際變更時才執行更新
            if (Object.keys(updateData).length > 0) {
                await setDoc(userRef, updateData, { merge: true });
                console.log('用戶資料已更新:', updateData);
            }
            
            // 如果 Firestore 中有更完整的用戶名，使用 Firestore 的
            const firestoreUserName = existingData.name;
            if (firestoreUserName) {
                localStorage.setItem('userName', firestoreUserName);
            }
            
            console.log('現有用戶處理完成');
            
            // 檢查是否仍有缺失的重要資料
            if ((provider === 'google' || provider === 'facebook') && !user.email && !existingData.email) {
                console.warn(`警告: ${provider} 登入用戶 ${user.uid} 仍然缺少 email 資訊，可能需要引導用戶重新授權`);
            }
        }
    } catch (error) {
        console.error('保存用戶資料到數據庫失敗:', error);
        
        // 更詳細的錯誤記錄
        console.error('錯誤詳情:', {
            uid: user.uid,
            provider: provider,
            hasEmail: !!user.email,
            hasDisplayName: !!displayName,
            errorCode: error.code,
            errorMessage: error.message
        });
        
        // 即使無法保存到數據庫，也不影響登入流程
        // 但可以考慮顯示警告給用戶
        if (error.code === 'permission-denied') {
            console.warn('數據庫權限被拒絕，請檢查 Firestore 安全規則');
        }
    }
}

    // 處理認證錯誤
    function handleAuthError(error, defaultMessage) {
        let errorMessage = defaultMessage || '登入失敗，請重試。';
        
        switch(error.code) {
            case 'auth/popup-closed-by-user':
                errorMessage = '登入已取消。';
                break;
            case 'auth/popup-blocked':
                errorMessage = '瀏覽器阻擋了登入彈窗，請允許彈窗後重試。';
                break;
            case 'auth/cancelled-popup-request':
                errorMessage = '登入請求已取消。';
                break;
            case 'auth/account-exists-with-different-credential':
                errorMessage = '此電子郵件已使用其他登入方式註冊，請使用原來的方式登入。';
                break;
            case 'auth/network-request-failed':
                errorMessage = '網路連線問題。請檢查您的網路連線並重試。';
                break;
            case 'auth/too-many-requests':
                errorMessage = '登入嘗試次數過多。請稍後再試。';
                break;
            default:
                errorMessage = defaultMessage + ': ' + error.message;
        }
        
        if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
            showMemberErrorModal('登入失敗', errorMessage);
        }
    }
    
    // Google 登入功能實現
    async function handleGoogleLogin() {
        if (!GoogleAuthProvider || !signInWithPopup) {
            showMemberErrorModal('功能未啟用', 'Google 登入功能未啟用，請聯繫網站管理員。');
            return;
        }

        // 檢查瀏覽器兼容性
        if (!BrowserDetection.handleLoginButtonClick('google')) {
            return; // 被瀏覽器檢測阻止
        }

        const clickedBtn = document.getElementById('google-login-btn');

        try {
            const provider = new GoogleAuthProvider();
            provider.setCustomParameters({
                'locale': 'zh_TW'
            });
            // Google 預設就會帶 email/profile，這裡明確要求一次，
            // 不依賴「目前剛好是預設行為」，跟 Facebook 那邊做法一致
            provider.addScope('email');
            provider.addScope('profile');

            if (clickedBtn) {
                const originalText = clickedBtn.innerHTML;
                clickedBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 登入中...';
                clickedBtn.disabled = true;
                
                try {
                    const result = await signInWithPopup(auth, provider);
                    const user = result.user;
                    
                    console.log('Google 登入成功:', user.uid);
                    
                    saveUserState(user);
                    const displayName = user.displayName || user.email?.split('@')[0] || 'Google用戶';
                    localStorage.setItem('userName', displayName);
                    checkIfAdmin(user);

                    // 保存或更新用戶資料到 Firestore
                    await saveUserToFirestore(user, displayName, 'google');
                    
                    if (window.authModals) {
                        window.authModals.hideAllModals();
                    }
                    
                    updateLoginUI(user);
                    showMemberSuccessModal('登入成功', 'Google 登入成功！');
                    
                } catch (popupError) {
                    if (popupError.code === 'auth/popup-blocked') {
                        console.log('彈窗被阻擋，嘗試重定向方式');
                        await signInWithRedirect(auth, provider);
                    } else {
                        throw popupError;
                    }
                } finally {
                    if (clickedBtn) {
                        clickedBtn.innerHTML = originalText;
                        clickedBtn.disabled = false;
                    }
                }
            }
            
        } catch (error) {
            console.error('Google 登入失敗:', error);
            
            if (clickedBtn) {
                clickedBtn.innerHTML = '<i class="fab fa-google"></i> 使用 Google 登入';
                clickedBtn.disabled = false;
            }
            
            handleAuthError(error, 'Google 登入失敗');
        }
    }

    // Facebook 登入功能實現
    async function handleFacebookLogin() {
        if (!FacebookAuthProvider || !signInWithPopup) {
            showMemberErrorModal('功能未啟用', 'Facebook 登入功能未啟用，請聯繫網站管理員。');
            return;
        }

        // 檢查瀏覽器兼容性
        if (!BrowserDetection.handleLoginButtonClick('facebook')) {
            return; // 被瀏覽器檢測阻止
        }

        const clickedBtn = document.getElementById('facebook-login-btn');

        try {
            const provider = new FacebookAuthProvider();
            provider.setCustomParameters({
                'locale': 'zh_TW'
            });
            // Facebook 登入不像 Google，預設不會自動要 email 權限，
            // 沒有明確要求的話，即使使用者同意也常常拿不到 email，
            // 這是先前空白會員資料的其中一個成因
            provider.addScope('email');

            if (clickedBtn) {
                const originalText = clickedBtn.innerHTML;
                clickedBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 登入中...';
                clickedBtn.disabled = true;
                
                try {
                    const result = await signInWithPopup(auth, provider);
                    const user = result.user;
                    
                    console.log('Facebook 登入成功:', user.uid);
                    
                    saveUserState(user);
                    const displayName = user.displayName || user.email?.split('@')[0] || 'Facebook用戶';
                    localStorage.setItem('userName', displayName);
                    checkIfAdmin(user);
                    
                    // 保存或更新用戶資料到 Firestore
                    await saveUserToFirestore(user, displayName, 'facebook');
                    
                    if (window.authModals) {
                        window.authModals.hideAllModals();
                    }
                    
                    updateLoginUI(user);
                    showMemberSuccessModal('登入成功', 'Facebook 登入成功！');
                    
                } catch (popupError) {
                    if (popupError.code === 'auth/popup-blocked') {
                        console.log('彈窗被阻擋，嘗試重定向方式');
                        await signInWithRedirect(auth, provider);
                    } else {
                        throw popupError;
                    }
                } finally {
                    if (clickedBtn) {
                        clickedBtn.innerHTML = originalText;
                        clickedBtn.disabled = false;
                    }
                }
            }
            
        } catch (error) {
            console.error('Facebook 登入失敗:', error);
            
            if (clickedBtn) {
                clickedBtn.innerHTML = '<i class="fab fa-facebook-f"></i> 使用 Facebook 登入';
                clickedBtn.disabled = false;
            }
            
            handleAuthError(error, 'Facebook 登入失敗');
        }
    }
    
    // 更新登入後的 UI 狀態
    function updateLoginUI(user) {
        const displayName = localStorage.getItem('userName') || user.displayName || user.email?.split('@')[0] || user.phoneNumber || '用戶';
        
        // 更新桌面版 UI
        if (userActions) userActions.style.display = 'none';
        if (userProfile) userProfile.style.display = 'flex';
        if (usernameDisplay) usernameDisplay.textContent = displayName;
        
        // 更新手機版 UI
        if (userActionsMobile) userActionsMobile.style.display = 'none';
        if (userProfileMobile) userProfileMobile.style.display = 'block';
        if (usernameDisplayMobile) usernameDisplayMobile.textContent = displayName;
    }
    
    // 初始化 UI 狀態
    function initializeUI() {
        // 首先隱藏所有用戶相關元素，防止閃現
        if (userActions) userActions.style.display = 'none';
        if (userProfile) userProfile.style.display = 'none';
        if (userActionsMobile) userActionsMobile.style.display = 'none';
        if (userProfileMobile) userProfileMobile.style.display = 'none';
        
        // 從 localStorage 讀取上次的登入狀態
        const isLoggedIn = localStorage.getItem('userIsLoggedIn') === 'true';
        const userName = localStorage.getItem('userName');
        const userEmail = localStorage.getItem('userEmail');
        const isAdminUser = localStorage.getItem('isAdmin') === 'true';
        
        if (isLoggedIn) {
            // 已登入狀態
            if (userActions) userActions.style.display = 'none';
            if (userProfile) userProfile.style.display = 'flex';
            if (userActionsMobile) userActionsMobile.style.display = 'none';
            if (userProfileMobile) userProfileMobile.style.display = 'block';
            
            const displayName = userName || (userEmail ? userEmail.split('@')[0] : '用戶');
            if (usernameDisplay) usernameDisplay.textContent = displayName;
            if (usernameDisplayMobile) usernameDisplayMobile.textContent = displayName;
            
            if (isAdminUser) {
                if (adminBtn) adminBtn.style.display = 'block';
                if (adminBtnMobile) adminBtnMobile.style.display = 'block';
            }
        } else {
            // 未登入狀態
            if (userActions) userActions.style.display = 'flex';
            if (userProfile) userProfile.style.display = 'none';
            if (userActionsMobile) userActionsMobile.style.display = 'block';
            if (userProfileMobile) userProfileMobile.style.display = 'none';
            
            if (adminBtn) adminBtn.style.display = 'none';
            if (adminBtnMobile) adminBtnMobile.style.display = 'none';
        }
    }
    
    // 立即初始化 UI 狀態
    initializeUI();

    try {
        console.log("Firebase 初始化成功");
        
        // 綁定登入按鈕事件
        document.addEventListener('click', function(e) {
            if (e.target.closest('#google-login-btn')) {
                e.preventDefault();
                e.stopPropagation();
                handleGoogleLogin();
            }
            
            if (e.target.closest('#facebook-login-btn')) {
                e.preventDefault();
                e.stopPropagation();
                handleFacebookLogin();
            }
        });

        // 綁定電話登入事件
        window.addEventListener('phoneLoginSubmit', function(e) {
            const phoneNumber = e.detail.phoneNumber;
            handlePhoneLogin(phoneNumber);
        });

        window.addEventListener('verifyCodeSubmit', function(e) {
            const code = e.detail.code;
            verifyPhoneCode(code);
        });

        window.addEventListener('resendCodeSubmit', function() {
            resendVerificationCode();
        });
        
        // 檢查重定向結果
        if (getRedirectResult) {
            getRedirectResult(auth)
                .then(async (result) => {
                    if (result) {
                        const user = result.user;
                        console.log('重定向登入成功:', user.uid);

                        const displayName = user.displayName || user.email?.split('@')[0] || '用戶';
                        saveUserState(user);
                        localStorage.setItem('userName', displayName);
                        checkIfAdmin(user);
                        updateLoginUI(user);

                        // 彈窗被瀏覽器擋下、改用重定向登入時，結果會從這裡回來，
                        // 之前這裡沒有呼叫 saveUserToFirestore，導致這條路徑登入的
                        // 使用者完全沒有寫入 Firestore 個人資料（不是欄位空白，是整份文件都沒建立）
                        const providerId = user.providerData?.[0]?.providerId;
                        const provider = providerId === 'facebook.com' ? 'facebook'
                            : providerId === 'google.com' ? 'google'
                            : null;
                        if (provider) {
                            await saveUserToFirestore(user, displayName, provider);
                        }

                        showMemberSuccessModal('登入成功', '登入成功！');
                    }
                })
                .catch((error) => {
                    console.error('重定向登入失敗:', error);
                    showMemberErrorModal('登入失敗', '重定向登入失敗，請重試。');
                });
        }

        // 下拉選單的開關已經由 js/common.js 的 initUserDropdown()（前台頁面）
        // 或 js/admin-common.js 的 initializeUserMenu()（後台頁面）負責綁定，
        // 這裡不要再重複綁一次——之前兩邊各綁一個 click 監聽器，同一次點擊
        // 會被兩個監聽器輪流切換 display，兩次切換互相抵銷，選單看起來完全
        // 打不開（後台頁面尤其明顯，因為 admin-common.js 沒有像 common.js
        // 那樣用 cloneNode 先清掉舊的監聽器）

        // 處理用戶登出 (通用函數)
        function handleLogout() {
            console.log("嘗試登出");
            signOut(auth)
                .then(() => {
                    console.log("登出成功");
                    
                    // 清除本地存儲中的用戶狀態
                    saveUserState(null);
                    
                    // 關閉用戶選單
                    if (userMenu) userMenu.style.display = 'none';
                    
                    // 確保UI更新為未登入狀態
                    if (userActions) userActions.style.display = 'flex';
                    if (userProfile) userProfile.style.display = 'none';
                    if (userActionsMobile) userActionsMobile.style.display = 'block';
                    if (userProfileMobile) userProfileMobile.style.display = 'none';
                    
                    // 確保管理員按鈕隱藏
                    if (adminBtn) adminBtn.style.display = 'none';
                    if (adminBtnMobile) adminBtnMobile.style.display = 'none';
                    
                    // 清除 reCAPTCHA 驗證器
                    if (window.recaptchaVerifier) {
                        window.recaptchaVerifier.clear();
                        window.recaptchaVerifier = null;
                    }
                    
                    // 清除確認結果
confirmationResult = null;

// 清除登入更新記錄
Object.keys(localStorage).forEach(key => {
    if (key.startsWith('lastLoginUpdate_') || key.startsWith('newUserCreated_')) {
        localStorage.removeItem(key);
    }
});

showMemberSuccessModal('登出成功', '已成功登出');
                })
                .catch((error) => {
                    console.error('登出失敗:', error);
                    showMemberErrorModal('登出失敗', '登出失敗: ' + error.message);
                });
        }

        // 桌面版登出按鈕
        if (logoutBtn) {
            logoutBtn.addEventListener('click', function(e) {
                e.preventDefault();
                handleLogout();
            });
        }

        // 手機版登出按鈕
        const logoutBtnMobile = document.getElementById('logout-btn-mobile');
        if (logoutBtnMobile) {
            logoutBtnMobile.addEventListener('click', function(e) {
                e.preventDefault();
                handleLogout();
            });
        }

        // 監聽認證狀態變化
        onAuthStateChanged(auth, function(user) {
            console.log("認證狀態變化，用戶狀態:", user ? "已登入" : "未登入");
            
            if (user) {
                console.log("用戶已登入:", user.uid);
                
                saveUserState(user);
                
                // 更新 UI
                if (userActions) userActions.style.display = 'none';
                if (userProfile) userProfile.style.display = 'flex';
                if (userActionsMobile) userActionsMobile.style.display = 'none';
                if (userProfileMobile) userProfileMobile.style.display = 'block';
                
                checkIfAdmin(user);
                
                // 檢查是否為新創建的用戶，避免重複更新
// 檢查是否為新創建的用戶，使用更嚴格的時間檢查
const newUserCreationTime = localStorage.getItem('newUserCreated_' + user.uid);
const now = Date.now();

// 如果是5分鐘內創建的新用戶，完全跳過任何登入時間更新
if (newUserCreationTime && (now - parseInt(newUserCreationTime)) < 300000) {
    console.log('跳過新用戶的登入時間更新（保護期內）');
} else {
    // 清理過期的新用戶標記
    if (newUserCreationTime && (now - parseInt(newUserCreationTime)) >= 300000) {
        localStorage.removeItem('newUserCreated_' + user.uid);
        console.log('清理過期的新用戶標記');
    }
    
    // 只有非新用戶且距離上次更新超過1小時才更新
    const lastUpdate = localStorage.getItem('lastLoginUpdate_' + user.uid);
    if (!lastUpdate || (now - parseInt(lastUpdate)) > 3600000) { // 1小時
        setDoc(doc(window.firebaseServices.db, 'users', user.uid), {
            lastLoginAt: serverTimestamp()
        }, { merge: true })
        .then(() => {
            localStorage.setItem('lastLoginUpdate_' + user.uid, now.toString());
            console.log('onAuthStateChanged: 更新現有用戶最後登入時間');
        })
        .catch(error => {
            console.warn('更新最後登入時間失敗:', error);
        });
    } else {
        console.log('距離上次更新未超過1小時，跳過更新');
    }
}
                
                // 從 Firestore 獲取用戶資料
                getDoc(doc(window.firebaseServices.db, 'users', user.uid))
                    .then((docSnap) => {
                        if (docSnap.exists()) {
                            // Firestore 的 name 欄位可能是空字串或不存在（例如手機號碼註冊、資料尚未填寫），
                            // 沒有這個備援值的話會把 undefined 存進 localStorage，下次讀取會變成字面字串 "undefined"
                            const name = docSnap.data().name || user.email?.split('@')[0] || user.phoneNumber || '用戶';
                            console.log("獲取用戶資料:", name);
                            localStorage.setItem('userName', name);

                            if (usernameDisplay) {
                                usernameDisplay.textContent = name;
                            }
                            if (usernameDisplayMobile) {
                                usernameDisplayMobile.textContent = name;
                            }
                        } else {
                            // 如果找不到用戶資料，使用預設顯示
                            const name = user.email?.split('@')[0] || user.phoneNumber || '用戶';
                            localStorage.setItem('userName', name);
                            
                            if (usernameDisplay) {
                                usernameDisplay.textContent = name;
                            }
                            if (usernameDisplayMobile) {
                                usernameDisplayMobile.textContent = name;
                            }
                        }

                        // 強制更新用戶名稱顯示
                        setTimeout(() => {
                            const userName = localStorage.getItem('userName');
                            if (userName) {
                                const usernameDisplayElem = document.getElementById('username-display');
                                const usernameDisplayMobileElem = document.getElementById('username-display-mobile');
                                
                                if (usernameDisplayElem) {
                                    usernameDisplayElem.textContent = userName;
                                }
                                
                                if (usernameDisplayMobileElem) {
                                    usernameDisplayMobileElem.textContent = userName;
                                }

                                console.log("用戶名稱顯示已更新為:", userName);
                            }
                        }, 500);
                    })
                    .catch((error) => {
                        console.warn('無法連接到數據庫:', error);
                        // 畫面上很可能已經用上次登入快取的名字顯示著（見前面
                        // initializeUI() 的即時墊檔機制），連線失敗時不要用信箱
                        // 前綴去覆蓋掉一個已經正確顯示的名字；真的完全沒有快取過
                        // 才退而求其次顯示信箱前綴
                        if (!localStorage.getItem('userName')) {
                            const name = user.email?.split('@')[0] || user.phoneNumber || '用戶';
                            localStorage.setItem('userName', name);

                            if (usernameDisplay) {
                                usernameDisplay.textContent = name;
                            }
                            if (usernameDisplayMobile) {
                                usernameDisplayMobile.textContent = name;
                            }
                        }
                    });
            } else {
                console.log("用戶未登入");
                
                saveUserState(null);
                
                // 更新 UI
                if (userActions) userActions.style.display = 'flex';
                if (userProfile) userProfile.style.display = 'none';
                if (userActionsMobile) userActionsMobile.style.display = 'block';
                if (userProfileMobile) userProfileMobile.style.display = 'none';
                
                // 隱藏管理員按鈕
                if (adminBtn) adminBtn.style.display = 'none';
                if (adminBtnMobile) adminBtnMobile.style.display = 'none';
            }
        });
        
    } catch (error) {
        console.error("Firebase 初始化失敗:", error);
        initializeUI();
    }

    // 確保頁面完全載入後，會員名稱正確顯示
    setTimeout(() => {
        const userName = localStorage.getItem('userName');
        const userIsLoggedIn = localStorage.getItem('userIsLoggedIn') === 'true';
        
        if (userIsLoggedIn && userName) {
            const usernameDisplayElem = document.getElementById('username-display');
            const usernameDisplayMobileElem = document.getElementById('username-display-mobile');
            
            if (usernameDisplayElem) {
                usernameDisplayElem.textContent = userName;
            }
            
            if (usernameDisplayMobileElem) {
                usernameDisplayMobileElem.textContent = userName;
            }
            
            console.log("頁面載入完成後，確保會員名稱顯示為:", userName);
        }
    }, 1000);
});