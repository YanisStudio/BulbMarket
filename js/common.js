/**
 * 球根花卉團購網站 - 共用功能模組
 * 包含所有頁面的共同功能
 */

// 全域變數
window.CommonModule = {
    // Firebase 服務引用
    firebase: null,
    
    // 當前用戶
    currentUser: null,
    
    // 管理員電子郵件列表（共用設定見 js/firebase-config.js）
    adminEmails: window.ADMIN_EMAILS
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
        CommonModule.firebase.onAuthStateChanged(CommonModule.firebase.auth, function(user) {
            const adminBtnDesktop = document.getElementById('admin-btn');
            const adminBtnMobile = document.getElementById('admin-btn-mobile');
            
            if (user && isAdmin(user.email)) {
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
 * 檢查是否為管理員
 */
function isAdmin(email) {
    return CommonModule.adminEmails.includes(email?.toLowerCase());
}

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
    const addToCartButtons = document.querySelectorAll('.add-to-cart-btn');
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

    document.getElementById('pd-desc').textContent = product.description || '';

    const extraWrap = document.getElementById('pd-detail-desc-wrap');
    const extraEl = document.getElementById('pd-detail-desc');
    if (product.detailDescription && product.detailDescription.trim()) {
        extraEl.textContent = product.detailDescription;
        extraWrap.style.display = 'block';
    } else {
        extraWrap.style.display = 'none';
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
}

function closeProductDetailModal() {
    const modal = document.getElementById('product-detail-modal');
    if (modal) modal.style.display = 'none';
    document.body.classList.remove('modal-open-noscroll');
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

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && modal.style.display !== 'none') closeProductDetailModal();
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

        const db = CommonModule.firebase.db;
        const collection = CommonModule.firebase.collection;
        const getDocs = CommonModule.firebase.getDocs;
        const query = CommonModule.firebase.query;
        const where = CommonModule.firebase.where;

        const includeInactive = options.includeInactive === true;
        const productsQuery = includeInactive
            ? collection(db, "products")
            : query(collection(db, "products"), where("status", "==", "active"));

        const productsSnapshot = await getDocs(productsQuery);

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
                price: data.price || 0,
                unit: data.unit || '份',
                category: data.category || 'other',
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