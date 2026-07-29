// 簡化版認證彈窗管理系統
// auth-modals.js

class AuthModals {
    constructor() {
        this.modalsCreated = false;
        this.init();
    }

    // 初始化彈窗系統
    init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.createModals());
        } else {
            this.createModals();
        }
    }

    // 創建簡化版登入彈窗 HTML
    createModals() {
        if (this.modalsCreated) return;

        const modalsHTML = `
            <!-- 登入彈窗 -->
            <div class="modal" id="login-modal">
                <div class="modal-content">
                    <span class="close-btn" id="close-login">&times;</span>
                    <h2>選擇登入方式</h2>
                    
                    <div class="login-options">
                        <!-- Google 登入按鈕 -->
                        <button type="button" class="btn btn-google" id="google-login-btn">
                            <i class="fab fa-google"></i>
                            使用 Google 登入
                        </button>
                        
                        <!-- Facebook 登入按鈕（暫時關閉：Facebook App 還沒完成 Meta 商業驗證，
                             一般顧客目前登不進去，只有這個 App 底下有角色的帳號才能用。
                             驗證通過後，把 style="display:none;" 拿掉就能重新開放，不用改其他地方 -->
                        <button type="button" class="btn btn-facebook" id="facebook-login-btn" style="display:none;">
                            <i class="fab fa-facebook-f"></i>
                            使用 Facebook 登入
                        </button>
                        
                        <!-- 電話號碼登入按鈕 -->
                        <button type="button" class="btn btn-phone" id="phone-login-btn">
                            <i class="fas fa-phone"></i>
                            使用電話號碼登入
                        </button>
                    </div>
                    
                    <div class="login-info">
                        <p>選擇任一方式即可快速登入或註冊</p>
                    </div>
                </div>
            </div>

            <!-- 電話號碼登入彈窗 -->
            <div class="modal" id="phone-modal">
                <div class="modal-content">
                    <span class="close-btn" id="close-phone">&times;</span>
                    <h2>電話號碼登入</h2>
                    <p>我們將發送驗證碼到您的手機</p>
                    
                    <form id="phone-form">
                        <div class="form-group">
                            <label for="phone-number">手機號碼</label>
                            <input type="tel" id="phone-number" placeholder="0912345678" required>
                        </div>
                        <button type="submit" class="btn btn-primary">發送驗證碼</button>
                    </form>
                    
                    <!-- reCAPTCHA 容器 -->
                    <div id="recaptcha-container" style="margin: 20px 0; display: none; justify-content: center;"></div>
                    
                    <!-- 驗證碼輸入區域（初始隱藏） -->
                    <div id="verification-section" style="display: none;">
                        <div class="form-group">
                            <label for="verification-code">驗證碼</label>
                            <input type="text" id="verification-code" placeholder="請輸入6位數驗證碼" maxlength="6" required>
                        </div>
                        <button type="button" class="btn btn-primary" id="verify-code-btn">確認驗證碼</button>
                        <button type="button" class="btn btn-secondary" id="resend-code-btn">重新發送</button>
                    </div>
                    
                    <div id="phone-message" style="margin-top: 15px; display: none;"></div>
                </div>
            </div>
        `;

        // 將彈窗 HTML 插入到 body 中
        document.body.insertAdjacentHTML('beforeend', modalsHTML);
        this.modalsCreated = true;

        // 設置彈窗事件監聽器
        this.setupEventListeners();
    }

    // 設置事件監聽器
    setupEventListeners() {
        // 登入按鈕事件
        this.bindLoginButtons();
        
        // 關閉按鈕事件
        this.bindCloseButtons();
        
        // 點擊外部關閉事件
        this.bindOutsideClickClose();
        
        // 電話登入相關事件
        this.bindPhoneLoginEvents();
    }

    // 綁定登入按鈕
    bindLoginButtons() {
        const loginBtns = document.querySelectorAll('.btn-login, #login-btn, #login-btn-mobile');
        loginBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.showModal('login-modal');
            });
        });
    }

    // 綁定關閉按鈕
    bindCloseButtons() {
        const closeBtns = document.querySelectorAll('.close-btn');
        closeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.hideAllModals();
            });
        });
    }

    // 綁定電話登入相關事件
    bindPhoneLoginEvents() {
        // 電話登入按鈕
        const phoneLoginBtn = document.getElementById('phone-login-btn');
        if (phoneLoginBtn) {
            phoneLoginBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.hideModal('login-modal');
                this.showModal('phone-modal');
            });
        }

        // 電話號碼表單提交
        const phoneForm = document.getElementById('phone-form');
        if (phoneForm) {
            phoneForm.addEventListener('submit', (e) => {
                e.preventDefault();
                // 這個事件會在 member.js 中被處理
                window.dispatchEvent(new CustomEvent('phoneLoginSubmit', {
                    detail: {
                        phoneNumber: document.getElementById('phone-number').value
                    }
                }));
            });
        }

        // 驗證碼確認按鈕
        const verifyCodeBtn = document.getElementById('verify-code-btn');
        if (verifyCodeBtn) {
            verifyCodeBtn.addEventListener('click', () => {
                // 這個事件會在 member.js 中被處理
                window.dispatchEvent(new CustomEvent('verifyCodeSubmit', {
                    detail: {
                        code: document.getElementById('verification-code').value
                    }
                }));
            });
        }

        // 重新發送驗證碼按鈕
        const resendCodeBtn = document.getElementById('resend-code-btn');
        if (resendCodeBtn) {
            resendCodeBtn.addEventListener('click', () => {
                // 這個事件會在 member.js 中被處理
                window.dispatchEvent(new CustomEvent('resendCodeSubmit'));
            });
        }
    }

    // 綁定點擊外部關閉事件
    bindOutsideClickClose() {
        window.addEventListener('click', (event) => {
            const modals = ['login-modal', 'phone-modal'];
            modals.forEach(modalId => {
                const modal = document.getElementById(modalId);
                if (modal && event.target === modal) {
                    this.hideModal(modalId);
                }
            });
        });
    }

    // 顯示彈窗
    showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'block';
            // 自動聚焦到第一個輸入框
            const firstInput = modal.querySelector('input[type="tel"], input[type="text"]');
            if (firstInput) {
                setTimeout(() => firstInput.focus(), 100);
            }
        }
    }

    // 隱藏彈窗
    hideModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
            // 清除表單內容
            const form = modal.querySelector('form');
            if (form) {
                form.reset();
            }
            // 隱藏驗證碼區域
            const verificationSection = document.getElementById('verification-section');
            if (verificationSection) {
                verificationSection.style.display = 'none';
            }
            // 清除訊息
            const message = modal.querySelector('#phone-message');
            if (message) {
                message.style.display = 'none';
            }
            // 隱藏 reCAPTCHA 容器
            this.hideRecaptchaContainer();
        }
    }

    // 隱藏所有彈窗
    hideAllModals() {
        const modals = ['login-modal', 'phone-modal'];
        modals.forEach(modalId => this.hideModal(modalId));
    }

    // 顯示登入彈窗（供外部調用）
    showLoginModal() {
        this.showModal('login-modal');
    }

    // 顯示驗證碼輸入區域
    showVerificationSection() {
        const verificationSection = document.getElementById('verification-section');
        if (verificationSection) {
            verificationSection.style.display = 'block';
        }
    }

    // 顯示電話登入訊息
    showPhoneMessage(message, isError = false) {
        const phoneMessage = document.getElementById('phone-message');
        if (phoneMessage) {
            phoneMessage.textContent = message;
            phoneMessage.style.color = isError ? 'red' : 'green';
            phoneMessage.style.display = 'block';
        }
    }

    // 重新綁定按鈕（用於動態添加的按鈕）
    rebindButtons() {
        this.bindLoginButtons();
    }

    // 顯示 reCAPTCHA 容器
    showRecaptchaContainer() {
        const recaptchaContainer = document.getElementById('recaptcha-container');
        if (recaptchaContainer) {
            recaptchaContainer.style.display = 'flex';
        }
    }

    // 隱藏 reCAPTCHA 容器
    hideRecaptchaContainer() {
        const recaptchaContainer = document.getElementById('recaptcha-container');
        if (recaptchaContainer) {
            recaptchaContainer.innerHTML = '';
            recaptchaContainer.style.display = 'none';
        }
    }
}

// 創建全局實例
window.authModals = new AuthModals();

// 提供全局函數供其他腳本使用
window.showLoginModal = () => window.authModals.showLoginModal();
window.hideAllModals = () => window.authModals.hideAllModals();