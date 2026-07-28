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
 * 管理員信箱清單（唯一來源）
 * js/admin-common.js、js/common.js 都改為引用這裡，不再各自維護一份
 */
window.ADMIN_EMAILS = [
    'bababa.b810@gmail.com',
    'vincentsayhello@gmail.com',
    'yanishuang2000@gmail.com'
];
