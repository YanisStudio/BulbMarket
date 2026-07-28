/**
 * 管理後台共用功能 JavaScript 文件
 * 包含：Firebase 初始化、管理員驗證、導航功能、UI 交互等
 */

// Firebase 配置（共用設定見 js/firebase-config.js，須在本檔案之前載入）
const firebaseConfig = window.FIREBASE_CONFIG;

// 管理員郵箱列表（共用設定見 js/firebase-config.js）
const ADMIN_EMAILS = window.ADMIN_EMAILS;

// 全局變量
let firebaseApp = null;
let currentUser = null;

/**
 * 檢查是否為管理員
 * @param {string} email - 用戶郵箱
 * @returns {boolean} - 是否為管理員
 */
function isAdmin(email) {
    return ADMIN_EMAILS.includes(email?.toLowerCase());
}

/**
 * 將字串轉為安全的 HTML 內容，避免使用者輸入（訂單姓名/電話/地址/備註等）
 * 被當成標籤或程式碼插入頁面造成 XSS。任何要塞進 innerHTML 的使用者資料都要包這層。
 */
function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * 初始化 Firebase
 * 使用動態導入避免重複初始化
 */
async function initializeFirebase() {
    try {
        // 動態導入 Firebase 模組
        const { initializeApp, getApps, getApp } = await import("https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js");
        const { 
            getAuth, 
            onAuthStateChanged,
            signOut
        } = await import("https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js");
        const {
            getFirestore,
            collection,
            addDoc,
            getDoc,
            getDocs,
            doc,
            updateDoc,
            deleteDoc,
            setDoc,        // 加入這行
            query,
            orderBy,
            where,
            limit,
            serverTimestamp,
            writeBatch,
            deleteField
        } = await import("https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js");
        const {
            getStorage,
            ref,
            uploadBytes,
            getDownloadURL
        } = await import("https://www.gstatic.com/firebasejs/9.22.0/firebase-storage.js");

        // 頁面內嵌的 <script type="module"> 可能已經初始化過 Firebase，
        // 沿用同一個 app 實例，避免重複呼叫 initializeApp() 觸發 duplicate-app 錯誤
        firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
        const auth = getAuth(firebaseApp);
        const db = getFirestore(firebaseApp);
        const storage = getStorage(firebaseApp);

        // 用 ...window.firebaseServices 保留頁面內嵌 script 可能自己額外加的方法
        // （例如 admin/products.html 用到的 writeBatch/deleteField），避免這裡整個覆蓋掉
        window.firebaseServices = {
            ...window.firebaseServices,
            app: firebaseApp,
            auth: auth,
            db: db,
            storage: storage,
            // Auth 方法
            getAuth,
            onAuthStateChanged,
            signOut,
            // Firestore 方法
            collection,
            addDoc,
            getDoc,
            getDocs,
            doc,
            updateDoc,
            deleteDoc,
            setDoc,        // 加入這行
            query,
            orderBy,
            where,
            limit,
            serverTimestamp,
            writeBatch,
            deleteField,
            // Storage 方法
            storageRef: ref,
            uploadBytes,
            getDownloadURL
        };
        
        console.log('Firebase 初始化成功');
        return true;
    } catch (error) {
        console.error('Firebase 初始化失敗:', error);
        return false;
    }
}

/**
 * 管理員權限檢查
 * @param {Function} onSuccess - 驗證成功後的回調函數
 * @param {Function} onFailed - 驗證失敗後的回調函數
 */
function checkAdminAccess(onSuccess = null, onFailed = null) {
    if (!window.firebaseServices?.auth) {
        console.error('Firebase 未初始化');
        if (onFailed) onFailed('Firebase 未初始化');
        return;
    }
    
    window.firebaseServices.onAuthStateChanged(window.firebaseServices.auth, function(user) {
        if (!user || !isAdmin(user.email)) {
            console.log('非管理員訪問，重定向回首頁');
            currentUser = null;
            
            // 顯示未授權區域（如果存在）
            const unauthorizedSection = document.getElementById('unauthorized-section');
            if (unauthorizedSection) {
                unauthorizedSection.style.display = 'block';
                const currentUserEmail = document.getElementById('current-user-email');
                if (currentUserEmail) {
                    currentUserEmail.textContent = user ? `當前登入帳號: ${user.email}` : '您尚未登入';
                }
            }
            
            // 隱藏主要內容區域
            const mainSections = ['orders-section', 'products-section', 'users-section', 'admin-dashboard'];
            mainSections.forEach(sectionId => {
                const section = document.getElementById(sectionId);
                if (section) section.style.display = 'none';
            });
            
            if (onFailed) {
                onFailed(user ? '權限不足' : '未登入');
            } else {
                // 預設行為：重定向到首頁
                setTimeout(() => {
                    window.location.href = '/index.html';
                }, 2000);
            }
        } else {
            console.log('管理員已登入:', user.email);
            currentUser = user;
            
            // 設置用戶名顯示
            updateUserDisplay();
            
            // 隱藏未授權區域
            const unauthorizedSection = document.getElementById('unauthorized-section');
            if (unauthorizedSection) {
                unauthorizedSection.style.display = 'none';
            }
            
            // 顯示主要內容區域
            const mainSections = ['orders-section', 'products-section', 'users-section', 'admin-dashboard'];
            mainSections.forEach(sectionId => {
                const section = document.getElementById(sectionId);
                if (section) section.style.display = 'block';
            });
            
            if (onSuccess) {
                onSuccess(user);
            }
        }
    });
}

/**
 * 更新用戶顯示信息
 */
function updateUserDisplay() {
    const usernameDisplay = document.getElementById('username-display');
    if (usernameDisplay && currentUser) {
        usernameDisplay.textContent = '管理員';
    }
}

/**
 * 初始化導航功能
 */
function initializeNavigation() {
    // 漢堡選單功能
    const menuToggle = document.getElementById('menu-toggle');
    const mainNav = document.getElementById('main-nav');
    const menuOverlay = document.getElementById('menu-overlay');
    const body = document.body;
    
    if (menuToggle && mainNav && menuOverlay) {
        menuToggle.addEventListener('click', function(e) {
            e.preventDefault();
            mainNav.classList.toggle('active');
            menuOverlay.classList.toggle('active');
            body.classList.toggle('menu-open');
        });
        
        menuOverlay.addEventListener('click', function() {
            closeMenu();
        });
        
        // ESC 鍵關閉選單
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                closeMenu();
            }
        });
    }
    
    function closeMenu() {
        if (mainNav) mainNav.classList.remove('active');
        if (menuOverlay) menuOverlay.classList.remove('active');
        if (body) body.classList.remove('menu-open');
    }
}

/**
 * 初始化用戶下拉選單
 */
function initializeUserMenu() {
    const userDropdownBtn = document.getElementById('user-dropdown-btn');
    const userMenu = document.getElementById('user-menu');
    const logoutBtn = document.getElementById('logout-btn');
    
    if (userDropdownBtn && userMenu) {
        userDropdownBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            toggleUserMenu();
        });
        
        // 點擊其他地方關閉選單
        document.addEventListener('click', function(e) {
            if (!userDropdownBtn.contains(e.target) && !userMenu.contains(e.target)) {
                closeUserMenu();
            }
        });
        
        // ESC 鍵關閉選單
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                closeUserMenu();
            }
        });
    }
    
    // 登出功能
    if (logoutBtn && window.firebaseServices) {
        logoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            handleLogout();
        });
    }
    
    function toggleUserMenu() {
        if (userMenu) {
            const isVisible = userMenu.style.display === 'block';
            userMenu.style.display = isVisible ? 'none' : 'block';
        }
    }
    
    function closeUserMenu() {
        if (userMenu) {
            userMenu.style.display = 'none';
        }
    }
}

/**
 * 處理登出
 */
function handleLogout() {
    if (!window.firebaseServices?.auth) {
        console.error('Firebase 未初始化');
        return;
    }
    
    if (confirm('確定要登出嗎？')) {
        window.firebaseServices.signOut(window.firebaseServices.auth)
            .then(() => {
                console.log('登出成功，重定向到首頁');
                currentUser = null;
                window.location.href = '/index.html';
            })
            .catch((error) => {
                console.error('登出錯誤:', error);
                alert('登出時發生錯誤，請稍後再試');
            });
    }
}

/**
 * 顯示加載指示器
 * @param {string} message - 加載消息（可選）
 */
function showLoading(message = '') {
    let loadingOverlay = document.getElementById('loading-overlay');
    
    if (!loadingOverlay) {
        // 創建加載覆蓋層
        loadingOverlay = document.createElement('div');
        loadingOverlay.id = 'loading-overlay';
        loadingOverlay.className = 'loading-overlay';
        loadingOverlay.innerHTML = `
            <div class="loading-content">
                <div class="spinner"></div>
                ${message ? `<p class="loading-message">${message}</p>` : ''}
            </div>
        `;
        document.body.appendChild(loadingOverlay);
    }
    
    loadingOverlay.classList.add('active');
}

/**
 * 隱藏加載指示器
 */
function hideLoading() {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
        loadingOverlay.classList.remove('active');
    }
}

/**
 * 顯示提示消息
 * @param {string} message - 消息內容
 * @param {string} type - 消息類型 (success, error, warning, info)
 * @param {number} duration - 顯示時間（毫秒）
 */
function showToast(message, type = 'info', duration = 3000) {
    // 移除已存在的提示
    const existingToast = document.getElementById('toast-message');
    if (existingToast) {
        existingToast.remove();
    }
    
    // 創建新的提示
    const toast = document.createElement('div');
    toast.id = 'toast-message';
    toast.className = `toast-message toast-${type}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    // 顯示動畫
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    // 自動隱藏
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast && toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, duration);
}

/**
 * 確認對話框
 * @param {string} message - 確認消息
 * @param {string} title - 對話框標題
 * @returns {Promise<boolean>} - 用戶選擇結果
 */
function showConfirmDialog(message, title = '確認操作') {
    return new Promise((resolve) => {
        // 檢查是否已存在確認對話框
        let confirmDialog = document.getElementById('confirm-dialog');
        
        if (!confirmDialog) {
            // 創建確認對話框
            confirmDialog = document.createElement('div');
            confirmDialog.id = 'confirm-dialog';
            confirmDialog.className = 'confirm-dialog';
            confirmDialog.innerHTML = `
                <div class="confirm-dialog-content">
                    <h3 id="confirm-dialog-title">${title}</h3>
                    <p id="confirm-dialog-message">${message}</p>
                    <div class="confirm-dialog-buttons">
                        <button class="btn btn-danger" id="confirm-dialog-ok">確認</button>
                        <button class="btn btn-secondary" id="confirm-dialog-cancel">取消</button>
                    </div>
                </div>
            `;
            document.body.appendChild(confirmDialog);
        } else {
            // 更新現有對話框
            document.getElementById('confirm-dialog-title').textContent = title;
            document.getElementById('confirm-dialog-message').textContent = message;
        }
        
        const okBtn = document.getElementById('confirm-dialog-ok');
        const cancelBtn = document.getElementById('confirm-dialog-cancel');
        
        // 顯示對話框
        confirmDialog.classList.add('active');
        
        // 事件處理
        const handleOk = () => {
            confirmDialog.classList.remove('active');
            cleanup();
            resolve(true);
        };
        
        const handleCancel = () => {
            confirmDialog.classList.remove('active');
            cleanup();
            resolve(false);
        };
        
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                handleCancel();
            }
        };
        
        const cleanup = () => {
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
            document.removeEventListener('keydown', handleEscape);
        };
        
        // 綁定事件
        okBtn.addEventListener('click', handleOk);
        cancelBtn.addEventListener('click', handleCancel);
        document.addEventListener('keydown', handleEscape);
    });
}

/**
 * 格式化日期
 * @param {Date|Timestamp} date - 日期對象
 * @param {string} format - 格式類型 ('full', 'date', 'time')
 * @returns {string} - 格式化後的日期字符串
 */
function formatDate(date, format = 'full') {
    if (!date) return '未知日期';
    
    let dateObj;
    if (date.toDate && typeof date.toDate === 'function') {
        // Firebase Timestamp
        dateObj = date.toDate();
    } else if (date instanceof Date) {
        dateObj = date;
    } else {
        dateObj = new Date(date);
    }
    
    if (isNaN(dateObj.getTime())) {
        return '未知日期';
    }
    
    const options = {
        'full': {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        },
        'date': {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        },
        'time': {
            hour: '2-digit',
            minute: '2-digit'
        }
    };
    
    return dateObj.toLocaleDateString('zh-TW', options[format] || options.full);
}

/**
 * 防抖函數
 * @param {Function} func - 要防抖的函數
 * @param {number} wait - 等待時間（毫秒）
 * @returns {Function} - 防抖後的函數
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * 錯誤處理函數
 * @param {Error} error - 錯誤對象
 * @param {string} context - 錯誤上下文
 */
function handleError(error, context = '操作') {
    console.error(`${context}失敗:`, error);
    
    let message = `${context}失敗`;
    
    if (error.code) {
        switch (error.code) {
            case 'permission-denied':
                message = '權限不足，無法執行此操作';
                break;
            case 'not-found':
                message = '找不到相關資料';
                break;
            case 'already-exists':
                message = '資料已存在';
                break;
            case 'invalid-argument':
                message = '輸入參數無效';
                break;
            default:
                message = `${context}失敗: ${error.message}`;
        }
    } else if (error.message) {
        message = `${context}失敗: ${error.message}`;
    }
    
    showToast(message, 'error');
}

/**
 * 初始化管理後台共用功能
 * 這是主要的初始化函數，應該在每個管理頁面中調用
 */
async function initializeAdminCommon() {
    try {
        // 初始化 Firebase
        const firebaseInitialized = await initializeFirebase();
        if (!firebaseInitialized) {
            throw new Error('Firebase 初始化失敗');
        }
        
        // 初始化導航功能
        initializeNavigation();
        
        // 初始化用戶選單
        initializeUserMenu();
        
        console.log('管理後台共用功能初始化完成');
        
        // 返回一個對象，包含常用方法
        return {
            checkAdminAccess,
            showLoading,
            hideLoading,
            showToast,
            showConfirmDialog,
            formatDate,
            debounce,
            handleError,
            isAdmin,
            getCurrentUser: () => currentUser
        };
        
    } catch (error) {
        console.error('初始化管理後台共用功能失敗:', error);
        showToast('系統初始化失敗，請刷新頁面重試', 'error');
        return null;
    }
}

// 當頁面加載完成時自動初始化（如果在瀏覽器環境中）
if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeAdminCommon);
    } else {
        initializeAdminCommon();
    }
    
    // 將主要函數暴露給全局
    window.AdminCommon = {
        initializeAdminCommon,
        checkAdminAccess,
        showLoading,
        hideLoading,
        showToast,
        showConfirmDialog,
        formatDate,
        debounce,
        handleError,
        isAdmin,
        getCurrentUser: () => currentUser
    };
}