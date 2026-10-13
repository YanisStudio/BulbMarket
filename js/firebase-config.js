/**
 * 共用 Firebase 專案設定
 * 由各頁面在載入 Firebase SDK 的 <script type="module"> 之前引入，
 * 避免設定值重複貼在每個檔案裡。
 */
window.FIREBASE_CONFIG = {
    apiKey: "AIzaSyCGej6Feghnsz-J77NrVgFZVP-pPrlvsgU",
    authDomain: "bulb-market-217c4.firebaseapp.com",
    projectId: "bulb-market-217c4",
    storageBucket: "bulb-market-217c4.firebasestorage.app",
    messagingSenderId: "829365637409",
    appId: "1:829365637409:web:7e1cb6647af154ca9d6e60",
    measurementId: "G-XFJK1JP7TE"
};

/**
 * Firestore 設定，所有頁面的 initializeFirestore() 以及重建連線
 *（common.js / admin-common.js 的 resetFirestoreConnection）都用這一份。
 *
 * 全站使用 Firestore Lite（firebase-firestore-lite.js），不是完整版 SDK。
 * 完整版靠一條長時間掛著的連線（WebChannel）收資料，在較慢的網路下這條連線
 * 第一次建立時常常卡住，一卡就是 SDK 的 10 秒逾時起跳，重建之後也常常再卡一次。
 * 實測（全新瀏覽器冷開首頁、模擬 150ms 延遲，各 8 次）：
 *   完整版：卡住 5/8，卡住時 55 秒～超過 60 秒才出現商品
 *   Lite  ：卡住 0/8，每次 3.1～3.3 秒出現商品
 * Lite 每次讀寫都是一般的 HTTPS 請求，沒有長連線可以卡住。本站全部都是一次性讀寫，
 * 沒有用即時監聽（onSnapshot）或離線快取，所以 Lite 的限制不影響功能。
 *
 * 換回完整版之前，請先用 tests/coldstart-compare.mjs 重跑比較。
 * 注意：頁面跟 js/admin-common.js 一定要用同一種（都是 Lite），
 * 混用時 getFirestore() 拿不到對方建立的實例，函式也不能跨版本混用。
 */
window.FIRESTORE_SETTINGS = {};
