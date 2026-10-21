/**
 * 球根花卉團購網站 - 共用功能模組
 * 包含所有頁面的共同功能
 */

// 全域變數
window.CommonModule = {
    // Firebase 服務引用
    firebase: null,

    // 當前用戶
    currentUser: null
};

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
 * 顧客是否已經回報過匯款（還沒被管理員確認）。
 * 顧客回報匯款只會在訂單備註加上【匯款確認】/【合併匯款確認】，不會直接改成已付款，
 * 要等管理員對帳後在後台改狀態。admin-common.js 有同一個函數給後台用。
 */
function isPaymentReported(order) {
    if (!order || order.paymentConfirmed === true) return false;
    return /【(合併)?匯款確認】/.test(order.notes || '');
}

/**
 * 把 appendOrderNote Cloud Function 的錯誤轉成給顧客看的說明。
 *
 * invalid-argument / failed-precondition / permission-denied / not-found /
 * resource-exhausted 這幾種是伺服器刻意回傳的、本來就寫給顧客看的訊息
 *（例如「這筆訂單不屬於目前登入的帳號」），直接顯示原文；
 * 其他（internal、unavailable、連線失敗）顯示通用訊息，不要把內部錯誤丟到畫面上。
 */
const APPEND_NOTE_USER_FACING_CODES = [
    'functions/invalid-argument',
    'functions/failed-precondition',
    'functions/permission-denied',
    'functions/not-found',
    'functions/resource-exhausted'
];
function appendNoteErrorMessage(error) {
    const code = String((error && error.code) || '');
    if (APPEND_NOTE_USER_FACING_CODES.indexOf(code) !== -1 && error.message) {
        return error.message;
    }
    return '送出失敗，請檢查網路連線後再試';
}

/**
 * 回傳本地時區的 YYYY-MM-DD。toISOString() 是 UTC，台灣早上 8 點前會變成前一天
 */
function localDateString(date) {
    const d = date || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * 初始化共用功能
 * 在每個頁面的 DOMContentLoaded 事件中調用
 */
function initCommonFeatures() {
    console.log('初始化共用功能...');
    
    // 初始化 Firebase 服務引用
    CommonModule.firebase = window.firebaseServices;
    
    // 初始化各種功能
    initMenuToggle();
    initUserDropdown();
    initMobileMenuButtons();
    initAdminAccess();
    updateCartCount();
    
    // 綁定窗口調整事件
    window.addEventListener('resize', handleWindowResize);
    
    console.log('共用功能初始化完成');
}

/**
 * 漢堡選單功能
 */
function initMenuToggle() {
    const menuToggle = document.getElementById('menu-toggle');
    const mainNav = document.getElementById('main-nav');
    const menuOverlay = document.getElementById('menu-overlay');
    const body = document.body;
    
    if (!menuToggle || !mainNav || !menuOverlay) {
        console.warn('找不到選單相關元素');
        return;
    }
    
    // 移除現有事件監聽器（避免重複綁定）
    const newMenuToggle = menuToggle.cloneNode(true);
    menuToggle.parentNode.replaceChild(newMenuToggle, menuToggle);
    
    // 切換選單狀態
    const toggleMenu = function() {
        if (mainNav.classList.contains('active')) {
            // 關閉選單
            mainNav.classList.remove('active');
            menuOverlay.classList.remove('active');
            body.classList.remove('menu-open');
        } else {
            // 開啟選單
            mainNav.classList.add('active');
            menuOverlay.classList.add('active');
            body.classList.add('menu-open');
            
            // 同步狀態
            syncMobileStates();
        }
    };
    
    // 綁定事件
    newMenuToggle.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        toggleMenu();
    });
    
    menuOverlay.addEventListener('click', function() {
        if (mainNav.classList.contains('active')) {
            toggleMenu();
        }
    });
    
    // 選單項目點擊後關閉選單
    const menuItems = document.querySelectorAll('nav ul li a');
    menuItems.forEach(item => {
        item.addEventListener('click', function() {
            if (window.innerWidth <= 768 && mainNav.classList.contains('active')) {
                setTimeout(() => toggleMenu(), 50);
            }
        });
    });
    
    // 儲存切換函數供其他地方使用
    window.toggleMenu = toggleMenu;
}

/**
 * 用戶下拉選單功能
 */
function initUserDropdown() {
    const userDropdownBtn = document.getElementById('user-dropdown-btn');
    const userMenu = document.getElementById('user-menu');
    
    if (!userDropdownBtn || !userMenu) {
        console.warn('找不到用戶下拉選單元素');
        return;
    }
    
    // 確保菜單初始隱藏
    userMenu.style.display = 'none';
    
    // 移除現有事件監聽器
    const newBtn = userDropdownBtn.cloneNode(true);
    userDropdownBtn.parentNode.replaceChild(newBtn, userDropdownBtn);
    
    const newMenu = userMenu.cloneNode(true);
    userMenu.parentNode.replaceChild(newMenu, userMenu);
    
    // 綁定點擊事件
    newBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        if (newMenu.style.display === 'block') {
            newMenu.style.display = 'none';
        } else {
            newMenu.style.display = 'block';
        }
    });
    
    // 阻止選單內部點擊穿透
    newMenu.addEventListener('click', function(e) {
        e.stopPropagation();
    });
    
    // 重新綁定選單功能
    bindUserMenuLinks(newMenu);
    
    // 點擊其他地方關閉選單
    document.addEventListener('click', function() {
        if (newMenu.style.display === 'block') {
            newMenu.style.display = 'none';
        }
    });
}

/**
 * 綁定用戶選單中的連結功能
 */
function bindUserMenuLinks(menu) {
    const links = menu.querySelectorAll('a');
    
    links.forEach(link => {
        if (link.id === 'logout-btn') {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                handleLogout();
            });
        }
    });
}

/**
 * 初始化手機版選單按鈕
 */
function initMobileMenuButtons() {
    // 登入按鈕
    setupMobileButton('login-btn-mobile', 'login-btn');
    
    // 註冊按鈕
    setupMobileButton('register-btn-mobile', 'register-btn');
    
    // 登出按鈕
    setupMobileLogoutButton();
    
    // 桌面版登出按鈕
    setupDesktopLogoutButton();
}

/**
 * 設置手機版按鈕（登入/註冊）
 */
function setupMobileButton(mobileId, desktopId) {
    const mobileBtn = document.getElementById(mobileId);
    const desktopBtn = document.getElementById(desktopId);
    
    if (mobileBtn && desktopBtn) {
        const newMobileBtn = mobileBtn.cloneNode(true);
        mobileBtn.parentNode.replaceChild(newMobileBtn, mobileBtn);
        
        newMobileBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            // 關閉選單
            if (window.toggleMenu && document.getElementById('main-nav').classList.contains('active')) {
                window.toggleMenu();
            }
            
            // 觸發桌面版按鈕
            setTimeout(() => desktopBtn.click(), 100);
        });
    }
}

/**
 * 設置手機版登出按鈕
 */
function setupMobileLogoutButton() {
    const logoutBtnMobile = document.getElementById('logout-btn-mobile');
    
    if (logoutBtnMobile) {
        const newLogoutBtnMobile = logoutBtnMobile.cloneNode(true);
        logoutBtnMobile.parentNode.replaceChild(newLogoutBtnMobile, logoutBtnMobile);
        
        newLogoutBtnMobile.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            // 關閉選單
            if (window.toggleMenu && document.getElementById('main-nav').classList.contains('active')) {
                window.toggleMenu();
            }
            
            // 執行登出
            handleLogout();
        });
    }
}

/**
 * 設置桌面版登出按鈕
 */
function setupDesktopLogoutButton() {
    const logoutBtn = document.getElementById('logout-btn');
    
    if (logoutBtn) {
        const newLogoutBtn = logoutBtn.cloneNode(true);
        logoutBtn.parentNode.replaceChild(newLogoutBtn, logoutBtn);
        
        newLogoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            handleLogout();
        });
    }
}

/**
 * 處理登出操作
 */
function handleLogout() {
    if (CommonModule.firebase) {
        CommonModule.firebase.signOut(CommonModule.firebase.auth)
            .then(() => {
                console.log('登出成功');
                location.reload();
            })
            .catch((error) => {
                console.error('登出錯誤', error);
            });
    } else {
        console.log('Firebase服務未初始化，執行模擬登出');
        localStorage.removeItem('isLoggedIn');
        location.reload();
    }
}

/**
 * 同步手機版狀態（購物車數量和登入狀態）
 */
function syncMobileStates() {
    syncCartCount();
    syncLoginStatus();
}

/**
 * 同步購物車數量
 */
function syncCartCount() {
    const cartCount = document.getElementById('cart-count');
    const cartCountFixed = document.getElementById('cart-count-fixed');
    
    if (cartCount && cartCountFixed) {
        const count = cartCount.textContent;
        cartCountFixed.textContent = count;
    }
}

/**
 * 同步登入狀態
 */
function syncLoginStatus() {
    const userActions = document.getElementById('user-actions');
    const userProfile = document.getElementById('user-profile');
    const userActionsMobile = document.getElementById('user-actions-mobile');
    const userProfileMobile = document.getElementById('user-profile-mobile');
    
    if (userActions && userProfile && userActionsMobile && userProfileMobile) {
        if (userActions.style.display === 'none') {
            // 已登入狀態
            userActionsMobile.style.display = 'none';
            userProfileMobile.style.display = 'block';
            
            // 同步用戶名稱
            const usernameDisplay = document.getElementById('username-display');
            const usernameDisplayMobile = document.getElementById('username-display-mobile');
            if (usernameDisplay && usernameDisplayMobile) {
                usernameDisplayMobile.textContent = usernameDisplay.textContent;
            }
        } else {
            // 未登入狀態
            userActionsMobile.style.display = 'block';
            userProfileMobile.style.display = 'none';
        }
    }
}

/**
 * 更新購物車數量顯示
 */
function updateCartCount(animate = false) {
    // 從 localStorage 獲取購物車數據
    const cart = JSON.parse(localStorage.getItem('cart')) || [];
    
    // 計算總商品數量
    const totalItems = cart.reduce((total, item) => total + item.quantity, 0);
    
    // 更新購物車圖標數量
    const cartCountElements = document.querySelectorAll('.cart-count');
    cartCountElements.forEach(element => {
        element.textContent = totalItems;
        
        if (totalItems === 0) {
            element.style.display = 'none';
        } else {
            element.style.display = 'flex';
            
            // 動畫效果
            if (animate) {
                element.classList.add('update');
                setTimeout(() => {
                    element.classList.remove('update');
                }, 300);
            }
        }
    });
    
    console.log('購物車數量更新:', totalItems);
    
    // 暴露給全域使用
    window.updateCartCount = updateCartCount;
}

/**
 * 檢查管理員權限
 */
function initAdminAccess() {
    if (CommonModule.firebase) {
        CommonModule.firebase.onAuthStateChanged(CommonModule.firebase.auth, async function(user) {
            const adminBtnDesktop = document.getElementById('admin-btn');
            const adminBtnMobile = document.getElementById('admin-btn-mobile');

            if (user && await isAdmin(user)) {
                // 顯示管理按鈕
                if (adminBtnDesktop) adminBtnDesktop.style.display = 'block';
                if (adminBtnMobile) adminBtnMobile.style.display = 'block';
                console.log('管理員已登入，顯示管理按鈕');
            } else {
                // 隱藏管理按鈕
                if (adminBtnDesktop) adminBtnDesktop.style.display = 'none';
                if (adminBtnMobile) adminBtnMobile.style.display = 'none';
            }
        });
    }
}

/**
 * 檢查是否為管理員：讀取 Firebase Auth custom claim（admin: true），
 * 取代舊版比對寫死信箱清單的做法。新增/移除管理員改用
 * scripts/set-admin-claims 那支腳本設定 claim，不用再改這裡的程式碼。
 */
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

/**
 * 重建 Firestore 連線：把卡在異常狀態的舊連線關掉，換一個全新的連線物件。
 *
 * 背景：Firestore 底層的 WebChannel 連線偶爾會卡在錯誤狀態，卡住之後同一個
 * 連線物件即使重試很多次也要等很久才會自己恢復；換成全新的連線物件通常能
 * 更快恢復（效果類似使用者手動整頁重新整理，但不用真的重新整理整個頁面）。
 *
 * 只把 window.firebaseServices.db 這個「屬性」換掉，不是整個換掉
 * window.firebaseServices 物件本身，這樣所有原本就是「每次要用才即時讀取
 * window.firebaseServices.db」的地方，下一次呼叫就會自動用到新連線，
 * 不需要另外通知它們。
 *
 * 只有 products.html / index.html 的商品載入重試邏輯會呼叫這個函數，
 * 需要頁面自己的 <script type="module"> 有把 app、initializeFirestore、
 * terminate 這三個一併暴露到 window.firebaseServices 才能用。
 */
async function resetFirestoreConnection() {
    const services = window.firebaseServices;
    if (!services || !services.app || !services.initializeFirestore || !services.terminate) {
        console.warn('無法重建 Firestore 連線：這個頁面沒有暴露 app/initializeFirestore/terminate');
        return false;
    }
    try {
        await services.terminate(services.db);
        // 跟各頁面初始化時用同一份設定（js/firebase-config.js）
        services.db = services.initializeFirestore(services.app, window.FIRESTORE_SETTINGS);
        console.log('Firestore 連線已重建');
        return true;
    } catch (error) {
        console.error('重建 Firestore 連線失敗:', error);
        return false;
    }
}
window.resetFirestoreConnection = resetFirestoreConnection;

// ---- 什麼時候才該重建連線 ----
//
// 註：全站已改用 Firestore Lite（見 js/firebase-config.js），沒有長連線，
// 下面情況 1 描述的「冷開卡住」已經不會發生。這套政策保留當安全網：
// Lite 的實例重建很便宜，讀取失敗時換一個新的實例沒有壞處。
//
// 分兩種情況：
//
// 1. 這一頁「從來沒有成功讀到過資料」（重開瀏覽器第一次進站最常見）：
//    SDK 的 10 秒逾時到了才會回報第一次失敗，而實測這 10 秒內伺服器一筆資料都沒送到
//   （WebChannel 的 AID 一直是 0），不是「快好了」的連線。這種連線靠 SDK 自己恢復
//    實測常常要 40～60 秒以上，所以一失敗就重建，之後每次失敗間隔夠久就再重建。
//    實測卡住後的恢復時間：等 30 秒才重建 約 40～60+ 秒 → 立刻重建 約 13～14 秒（中位數）。
//
// 2. 這一頁已經成功讀過資料，之後才失敗（網路中途斷掉等）：
//    terminate() 會中止所有進行中的作業，如果連線其實只是慢、正要成功，
//    一失敗就重建等於把它砍掉重練。SDK 本身有重連機制，先讓它自己恢復，
//    只有持續失敗夠久、看起來真的卡死才重建。
const NEVER_CONNECTED_RESET_GAP_MS = 9000; // 情況 1：兩次重建至少間隔（新連線也要給它 SDK 的 10 秒）
const RESET_AFTER_MS = 30000;      // 情況 2：從第一次失敗算起，持續失敗超過這麼久才重建
const RESET_COOLDOWN_MS = 60000;   // 情況 2：兩次重建至少間隔這麼久
let everSucceeded = false;
let firstFailureAt = 0;
let lastResetAt = 0;

// 讀取成功時呼叫：標記「這一頁連上過」，並把「連續失敗」的計時歸零
function noteFirestoreSuccess() {
    everSucceeded = true;
    firstFailureAt = 0;
}

/**
 * 讀取失敗時呼叫，依上面兩種情況決定要不要真的重建連線；
 * 不重建時什麼都不做，讓 SDK 自己重連。
 * @returns {Promise<boolean>} 這次有沒有真的重建
 */
async function maybeResetFirestoreConnection() {
    const now = Date.now();
    if (!everSucceeded) {
        if (now - lastResetAt < NEVER_CONNECTED_RESET_GAP_MS) return false;
        lastResetAt = now;
        return resetFirestoreConnection();
    }
    if (!firstFailureAt) {
        firstFailureAt = now;
        return false;
    }
    if (now - firstFailureAt < RESET_AFTER_MS) return false;
    if (now - lastResetAt < RESET_COOLDOWN_MS) return false;
    lastResetAt = now;
    return resetFirestoreConnection();
}

window.maybeResetFirestoreConnection = maybeResetFirestoreConnection;
window.noteFirestoreSuccess = noteFirestoreSuccess;


/**
 * 顯示提示消息
 */
function showToast(message) {
    let toast = document.getElementById('toast-message');
    
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast-message';
        toast.className = 'toast-message';
        document.body.appendChild(toast);
    }
    
    toast.textContent = message;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

/**
 * 添加到購物車（支持庫存檢查）
 */
function addToCart(productId, name, price, quantity = 1, stock = 0) {
    let cart = JSON.parse(localStorage.getItem('cart')) || [];
    
    const existingItemIndex = cart.findIndex(item => item.id === productId);
    
    if (existingItemIndex > -1) {
        const newQuantity = cart[existingItemIndex].quantity + quantity;
        if (stock > 0 && newQuantity > stock) {
            showToast(`庫存不足，最多可購買 ${stock} 份`);
            return;
        }
        
        cart[existingItemIndex].quantity = newQuantity;
        cart[existingItemIndex].stock = stock;
        // 同時更新成目前的價格與名稱：購物車裡可能是後台改價之前加入的舊價格
        cart[existingItemIndex].price = price;
        cart[existingItemIndex].name = name;
    } else {
        cart.push({
            id: productId,
            name: name,
            price: price,
            quantity: quantity,
            stock: stock
        });
    }
    
    localStorage.setItem('cart', JSON.stringify(cart));
    updateCartCount(true);
    showToast('商品已成功加入購物車');
}

/**
 * 初始化加入購物車按鈕
 */
function initAddToCartButtons() {
    // 排除商品詳細介紹彈窗裡的那顆按鈕：它雖然也是 .add-to-cart-btn，但不在
    // .product-card 裡面，用不到下面這套「找最近的 .product-card 讀 data-*」的邏輯，
    // 而且 openProductDetailModal() 是直接設它的 onclick。這裡 cloneNode 會把
    // onclick 一起換掉，彈窗開著時剛好重新渲染商品格（改視窗大小、換頁、篩選）
    // 就會讓彈窗裡的「加入購物車」失效
    const addToCartButtons = document.querySelectorAll('.add-to-cart-btn:not(#pd-add-to-cart)');
    addToCartButtons.forEach(button => {
        // 移除現有事件監聽器
        const newButton = button.cloneNode(true);
        button.parentNode.replaceChild(newButton, button);
        
        newButton.addEventListener('click', function() {
            const productCard = this.closest('.product-card');
            if (productCard) {
                const productId = productCard.dataset.productId;
                const productName = productCard.dataset.productName;
                const productPrice = parseFloat(productCard.dataset.productPrice);
                const productStock = parseInt(productCard.dataset.productStock);
                
                if (productStock <= 0) {
                    showToast('此商品目前無庫存');
                    return;
                }
                
                // 檢查購物車中已有數量
                const cart = JSON.parse(localStorage.getItem('cart')) || [];
                const existingItem = cart.find(item => item.id === productId);
                const currentQty = existingItem ? existingItem.quantity : 0;
                
                if (currentQty >= productStock) {
                    showToast(`庫存不足，最多可購買 ${productStock} 份`);
                    return;
                }
                
                addToCart(productId, productName, productPrice, 1, productStock);
                
                // 添加動畫效果
                this.classList.add('added');
                setTimeout(() => {
                    this.classList.remove('added');
                }, 1000);
            }
        });
    });
}

/**
 * 商品詳細介紹彈跳視窗
 * 商品卡片描述太長會被 CSS 截斷成 2 行，完整描述 + 選填的詳細介紹要點卡片才看得到。
 * 卡片資料在各頁面自己的 renderProducts()/renderProductsToPage() 裡寫進
 * window.__productDataCache，這裡只負責讀取、開關彈窗。
 */
function openProductDetailModal(productId) {
    const product = window.__productDataCache && window.__productDataCache[productId];
    const modal = document.getElementById('product-detail-modal');
    if (!product || !modal) return;

    const isAvailable = product.status === 'active';

    document.getElementById('pd-image').src = product.imageUrl || '/images/placeholder.jpg';
    document.getElementById('pd-name').textContent = product.name;
    document.getElementById('pd-price').textContent = `$${product.price}/${product.unit}`;

    const stockEl = document.getElementById('pd-stock');
    stockEl.textContent = product.stock > 0 ? `庫存: ${product.stock} 份` : '無庫存';
    stockEl.classList.toggle('low-stock', product.stock > 0 && product.stock < 5);

    // 商品描述、詳細介紹分成兩個分頁，文字只在下面那一塊捲動，圖片、價格、
    // 加入購物車按鈕固定不動。手機上以前是全部疊成一長條，按鈕被擠到很下面。
    // 兩種都有才顯示分頁標籤；只有其中一種就直接顯示那一種
    const descText = (product.description || '').trim();
    const detailText = (product.detailDescription || '').trim();
    document.getElementById('pd-desc').textContent = descText;
    document.getElementById('pd-detail-desc').textContent = detailText;

    const tabs = document.getElementById('pd-tabs');
    const detailPanel = document.getElementById('pd-detail-desc-wrap');
    if (tabs) {
        tabs.hidden = !(descText && detailText);
        if (detailPanel) detailPanel.style.display = '';
        selectProductDetailTab(descText || !detailText ? 'desc' : 'detail');
    } else if (detailPanel) {
        // 瀏覽器還快取著舊版頁面（沒有分頁標籤）時，照舊把詳細介紹接在描述下面
        detailPanel.style.display = detailText ? 'block' : 'none';
    }

    const tagEl = document.getElementById('pd-tag');
    if (product.tags && product.tags.length > 0) {
        tagEl.textContent = product.tags[0];
        tagEl.style.display = 'inline-block';
    } else {
        tagEl.style.display = 'none';
    }

    document.getElementById('pd-unavailable').style.display = isAvailable ? 'none' : 'inline-block';

    // 彈跳視窗不是 .product-card，沒辦法直接套用 common.js 既有那套「找最近的
    // .product-card 讀 data-* 屬性」的加入購物車/收藏邏輯，這裡直接用 onclick
    // 綁定，每次開窗都會用新商品的資料覆蓋掉上一次的綁定
    const addBtn = document.getElementById('pd-add-to-cart');
    addBtn.disabled = !isAvailable || product.stock <= 0;
    addBtn.onclick = function() {
        if (addBtn.disabled) return;
        const cart = JSON.parse(localStorage.getItem('cart')) || [];
        const existingItem = cart.find(item => item.id === product.id);
        const currentQty = existingItem ? existingItem.quantity : 0;
        if (currentQty >= product.stock) {
            showToast(`庫存不足，最多可購買 ${product.stock} 份`);
            return;
        }
        addToCart(product.id, product.name, product.price, 1, product.stock);
        addBtn.classList.add('added');
        setTimeout(() => addBtn.classList.remove('added'), 1000);
    };

    const wishBtn = document.getElementById('pd-wish-btn');
    const wishlist = JSON.parse(localStorage.getItem('wishlist')) || [];
    wishBtn.classList.toggle('active', wishlist.some(item => item.id === product.id));
    wishBtn.onclick = function() {
        const currentWishlist = JSON.parse(localStorage.getItem('wishlist')) || [];
        const index = currentWishlist.findIndex(item => item.id === product.id);
        if (index > -1) {
            currentWishlist.splice(index, 1);
            wishBtn.classList.remove('active');
            showToast(`已取消註記 ${product.name}`);
        } else {
            currentWishlist.push({ id: product.id, name: product.name, addedAt: new Date().toISOString() });
            wishBtn.classList.add('active');
            showToast(`已註記 ${product.name}`);
        }
        localStorage.setItem('wishlist', JSON.stringify(currentWishlist));
        if (typeof updateWishlistButtons === 'function') updateWishlistButtons();
    };

    modal.style.display = 'flex';
    document.body.classList.add('modal-open-noscroll');

    // 記住是從哪個元素開啟的，關閉時把焦點還回去；否則用鍵盤開啟彈窗後，
    // 焦點還留在後面被遮住的卡片上，Tab 會跑到看不見的地方去
    lastProductDetailTrigger = document.activeElement;
    const closeBtn = modal.querySelector('.product-detail-close');
    if (closeBtn) closeBtn.focus();
}

// openProductDetailModal() 開窗前的焦點位置，closeProductDetailModal() 用它還原
let lastProductDetailTrigger = null;

// 切換商品詳細介紹彈窗的分頁（'desc' 商品描述／'detail' 詳細介紹）
function selectProductDetailTab(name) {
    const tabs = [
        { tab: document.getElementById('pd-tab-desc'), panel: document.getElementById('pd-panel-desc'), key: 'desc' },
        { tab: document.getElementById('pd-tab-detail'), panel: document.getElementById('pd-detail-desc-wrap'), key: 'detail' }
    ];
    tabs.forEach(function(item) {
        const active = item.key === name;
        if (item.tab) {
            item.tab.classList.toggle('active', active);
            item.tab.setAttribute('aria-selected', active ? 'true' : 'false');
            item.tab.tabIndex = active ? 0 : -1;
        }
        if (item.panel) item.panel.hidden = !active;
    });
    // 換分頁時從頭開始看
    const content = document.querySelector('#product-detail-modal .product-detail-content');
    if (content) content.scrollTop = 0;
}

function closeProductDetailModal() {
    const modal = document.getElementById('product-detail-modal');
    if (modal) modal.style.display = 'none';
    document.body.classList.remove('modal-open-noscroll');

    // 卡片可能已經被重新渲染掉（換頁、篩選），所以要確認元素還在畫面上才聚焦
    if (lastProductDetailTrigger && document.body.contains(lastProductDetailTrigger)) {
        lastProductDetailTrigger.focus();
    }
    lastProductDetailTrigger = null;
}

function initProductDetailModal() {
    const modal = document.getElementById('product-detail-modal');
    if (!modal || modal.dataset.bound === 'true') return;
    modal.dataset.bound = 'true';

    // 用事件代理綁在 document 上，商品格子重新渲染（換頁/篩選/搜尋）也不用重新綁定
    document.addEventListener('click', function(e) {
        const card = e.target.closest('.product-card');
        if (!card || card.closest('#product-detail-modal')) return;
        if (e.target.closest('.add-to-cart-btn, .wish-btn')) return;
        const productId = card.dataset.productId;
        if (productId) openProductDetailModal(productId);
    });

    const closeBtn = modal.querySelector('.product-detail-close');
    if (closeBtn) closeBtn.addEventListener('click', closeProductDetailModal);

    const backdrop = modal.querySelector('.product-detail-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeProductDetailModal);

    // 分頁：點選切換；鍵盤左右鍵在兩個分頁間移動（WAI-ARIA tabs 的慣例）
    const tabList = document.getElementById('pd-tabs');
    if (tabList) {
        tabList.addEventListener('click', function(e) {
            const tab = e.target.closest('[role="tab"]');
            if (tab) selectProductDetailTab(tab.dataset.tab);
        });
        tabList.addEventListener('keydown', function(e) {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            const current = document.activeElement && document.activeElement.dataset.tab;
            const next = current === 'desc' ? 'detail' : 'desc';
            selectProductDetailTab(next);
            document.getElementById(next === 'desc' ? 'pd-tab-desc' : 'pd-tab-detail').focus();
            e.preventDefault();
        });
    }

    document.addEventListener('keydown', function(e) {
        if (modal.style.display === 'none') return;

        if (e.key === 'Escape') {
            closeProductDetailModal();
            return;
        }

        // 把 Tab 鎖在彈窗裡。aria-modal="true" 只讓讀螢幕忽略後面的內容，
        // 用鍵盤的人還是會 Tab 到被遮住的卡片上，焦點就跑到看不見的地方了
        if (e.key !== 'Tab') return;
        const focusables = Array.from(modal.querySelectorAll(
            'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )).filter(function(el) { return !el.closest('[hidden]') && el.tabIndex !== -1; });
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    });
}

/**
 * 窗口大小變化處理
 */
function handleWindowResize() {
    if (window.innerWidth > 768) {
        const mainNav = document.getElementById('main-nav');
        const menuOverlay = document.getElementById('menu-overlay');
        const body = document.body;
        
        if (mainNav && mainNav.classList.contains('active')) {
            mainNav.classList.remove('active');
            menuOverlay.classList.remove('active');
            body.classList.remove('menu-open');
        }
    }
}

// onAuthStateChanged 第一次回呼前才代表 Auth 狀態（有無登入）已經確定；
// 快取成單一 promise，第一次呼叫才真的去等，之後（含重試）直接沿用同一個
// 已解決的 promise，不會每次查詢都重新等一次
let authReadyPromise = null;
function waitForAuthReady() {
    if (!CommonModule.firebase) {
        throw new Error('Firebase 服務未初始化');
    }
    if (!authReadyPromise) {
        authReadyPromise = new Promise((resolve) => {
            const unsubscribe = CommonModule.firebase.onAuthStateChanged(
                CommonModule.firebase.auth,
                () => {
                    unsubscribe();
                    resolve();
                }
            );
        });
    }
    return authReadyPromise;
}

/**
 * Firebase 相關工具函數
 */
const FirebaseUtils = {
    /**
     * 載入商品數據
     * @param {function} filterCallback 篩選回調函數
     * @param {{includeInactive?: boolean}} options includeInactive 預設 false，
     *        只有商品列表頁主動要求才會連下架商品一起抓回來，避免影響到
     *        結帳驗證、首頁精選商品等其他呼叫這個函數的地方
     */
    async loadProducts(filterCallback = null, options = {}) {
        if (!CommonModule.firebase) {
            throw new Error('Firebase 服務未初始化');
        }

        // 確保 Auth 狀態（登入與否）已經確定，再送出查詢，避免 Firestore
        // 規則若有限制登入才能讀取時，查詢在 Auth 狀態還沒確定前就送出
        await waitForAuthReady();

        const db = CommonModule.firebase.db;
        const collection = CommonModule.firebase.collection;
        const getDocsFromServer = CommonModule.firebase.getDocsFromServer;
        const query = CommonModule.firebase.query;
        const where = CommonModule.firebase.where;

        if (!getDocsFromServer) {
            throw new Error('Firebase 服務缺少 getDocsFromServer，請確認此頁面的 <script type="module"> 有從 firebase-firestore-lite.js import「getDocs as getDocsFromServer」並加進 window.firebaseServices');
        }

        const includeInactive = options.includeInactive === true;
        const productsQuery = includeInactive
            ? collection(db, "products")
            : query(collection(db, "products"), where("status", "==", "active"));

        // 用 getDocsFromServer 而不是 getDocs：getDocs 連不上後端時會悄悄
        // 退回本地空快取、回傳「技術上成功但是空」的結果，導致真正的連線
        // 問題被誤判成「真的沒有商品」。getDocsFromServer 強制要求真的連到
        // 伺服器，連不上就直接 throw，讓外層 catch 走「連線不穩定，自動
        // 重試」的邏輯，不會顯示沒有商品
        //
        // 換成 Firestore Lite 之後，讀取是一般的 fetch，沒有完整版 SDK 那個
        // 「10 秒連不上就回報離線」的機制。萬一網路卡住、請求一直沒有回應，
        // 頁面會永遠停在載入中，所以自己加一個逾時，逾時就丟例外交給外層重試
        const PRODUCTS_READ_TIMEOUT_MS = 20000;
        let timeoutId;
        const productsSnapshot = await Promise.race([
            getDocsFromServer(productsQuery),
            new Promise((resolve, reject) => {
                timeoutId = setTimeout(() => {
                    const error = new Error('讀取商品逾時（' + PRODUCTS_READ_TIMEOUT_MS / 1000 + ' 秒沒有回應）');
                    error.code = 'deadline-exceeded';
                    reject(error);
                }, PRODUCTS_READ_TIMEOUT_MS);
            })
        ]).finally(() => clearTimeout(timeoutId));

        if (productsSnapshot.empty) {
            return [];
        }

        const products = [];
        productsSnapshot.forEach(doc => {
            const data = doc.data();
            const product = {
                id: doc.id,
                name: data.name || '未知商品',
                description: data.description || '',
                // 詳細介紹（後台選填）：只在商品詳細介紹彈窗的「詳細介紹」分頁顯示。
                // 以前這裡漏了這一欄，彈窗永遠以為是空的，後台寫了也看不到
                detailDescription: data.detailDescription || '',
                price: data.price || 0,
                unit: data.unit || '份',
                category: data.category || 'other',
                // 顯示用的商品分類（百合、鬱金香…可複選），跟上面計算運費用的 category 是兩回事
                categoryIds: Array.isArray(data.categoryIds) ? data.categoryIds : [],
                imageUrl: data.imageUrl || '/images/placeholder.jpg',
                tags: Array.isArray(data.tags) ? data.tags : [],
                stock: data.stock || 0,
                isFeaturedOffer: data.isFeaturedOffer || false,
                status: data.status || 'inactive'
            };

            // 如果有過濾回調函數，則使用它
            if (!filterCallback || filterCallback(product)) {
                products.push(product);
            }
        });

        return products;
    },
    
    /**
     * 載入精選商品
     */
    async loadFeaturedProducts() {
        return this.loadProducts(product => product.isFeaturedOffer === true);
    }
};

// 暴露公用函數到全域
window.initCommonFeatures = initCommonFeatures;
window.updateCartCount = updateCartCount;
window.addToCart = addToCart;
window.initAddToCartButtons = initAddToCartButtons;
window.showToast = showToast;
window.FirebaseUtils = FirebaseUtils;
// 頁首隨捲動縮放：在頁面最上方時 Logo 和選單比較大，往下捲就縮小，
// 留更多畫面給內容（樣式在 css/storefront.css 的 body.header-compact，只作用在桌面版）。
// 往下超過 80px 才縮小、回到 20px 以內才放大，中間留緩衝，避免頁首高度變化
// 讓捲動位置剛好卡在門檻上來回跳動
(function initHeaderShrink() {
    const COMPACT_AT = 80;
    const EXPAND_AT = 20;
    let ticking = false;

    function update() {
        ticking = false;
        const y = window.scrollY || window.pageYOffset;
        const compact = document.body.classList.contains('header-compact');
        if (!compact && y > COMPACT_AT) {
            document.body.classList.add('header-compact');
        } else if (compact && y < EXPAND_AT) {
            document.body.classList.remove('header-compact');
        }
    }

    window.addEventListener('scroll', function() {
        if (!ticking) {
            ticking = true;
            window.requestAnimationFrame(update);
        }
    }, { passive: true });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', update);
    } else {
        update();
    }
})();
