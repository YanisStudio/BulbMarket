# 測試與檢查腳本

這個網站沒有打包工具，是一堆直接載入的 `<script>`，所以常見的壞法是「某頁用了某個
全域函式／`firebaseServices` 成員，卻沒載入定義它的檔案」——這種錯只有走到那條路徑
才會爆。下面的腳本就是用來機械式地擋掉這類問題。

## 準備

```bash
cd tests
npm install            # 只需要 jsdom 與 puppeteer
```

`append-order-note.test.js` 另外需要 `functions/` 的相依套件：

```bash
cd functions && npm install
```

## 一致性檢查（不需要網路）

```bash
node tests/check-firebase-services.mjs   # 每頁用到的 firebaseServices.X 是否真的有暴露
node tests/check-shared-globals.mjs      # 每頁用到的共用全域是否有載入對應腳本
```

## 單元／行為測試（不需要網路）

```bash
cd functions && node ../tests/append-order-note.test.js   # 訂單備註追加（19 項）
node tests/product-detail-keyboard.test.mjs               # 商品彈窗鍵盤操作（14 項）
node tests/category-retry.test.mjs                        # 分類讀取失敗後的背景重試
```

`append-order-note.test.js` 用假的 Firestore 驅動真實的 Cloud Function 程式碼，
重點在驗證「只往後接、永遠不覆蓋既有備註」這條安全性質，以及會員訂單的權限判斷。

## Firestore 規則權限矩陣（需要網路 + gcloud）

```bash
node tests/firestore-rules.test.mjs "$(gcloud auth print-access-token)" firestore.rules
```

對 6 種身分（訪客／已驗證信箱會員／未驗證信箱會員／手機登入會員／他人／管理員）
跑 71 項權限檢查。用的是 Firebase Rules API 的 `:test` 方法，**只做規則運算，
不會讀寫任何正式資料**。

想驗證「線上實際發布的規則」而不是 repo 裡這份，先把線上版本抓下來再傳進去
（注意一定要帶 `x-goog-user-project` 標頭，否則會因為沒有 quota project 被拒）。

## 連線問題重現（需要網路 + 本機 Chrome）

```bash
node tests/repro-slow-load.mjs https://flowerbulb.tw/products.html 5
node tests/compare-longpolling-modes.mjs 14
```

`repro-slow-load.mjs` 用真實 Chrome 反覆冷開正式站，量測商品從進站到出現在畫面上
要多久，並記錄 Firestore 的 10 秒逾時、連線重建、分類讀取失敗各發生在第幾毫秒。

`compare-longpolling-modes.mjs` 比較 `experimentalForceLongPolling: true`（目前的設定）
與 SDK 預設自動偵測的失敗率。**結論是兩者沒有顯著差異**（各 22 次取樣，逾時 3 次 vs 4 次），
而且 force 的 happy path 還快約 0.5 秒，所以維持原設定。那個 10 秒逾時是環境造成的，
不是設定選錯——真正的對策是失敗後快速重建連線並持續重試。
如果之後懷疑這個結論，重跑這支腳本取樣即可，不要憑印象改設定。
