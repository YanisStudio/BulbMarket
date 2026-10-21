# 測試與檢查腳本

這個網站沒有打包工具，是一堆直接載入的 `<script>`，所以常見的壞法是「某頁用了某個
全域函式／`firebaseServices` 成員，卻沒載入定義它的檔案」——這種錯只有走到那條路徑
才會爆。下面的腳本就是用來機械式地擋掉這類問題。

## 準備

```bash
cd tests
npm install            # 只需要 jsdom 與 puppeteer
```

`append-order-note.test.cjs` 另外需要 `functions/` 的相依套件：

```bash
cd functions && npm install
```

## 全站頁面巡檢（需要網路 + 本機 Chrome）

```bash
node tests/page-sweep.mjs
```

用真實 Chrome 打開每一頁（前台 + 後台），連正式的 Firebase，檢查沒有 JS 錯誤
（import 名稱不存在、SDK 混用這類會讓整頁失效的錯）、公開資料有讀出來，並用訪客身分
寫一筆規則一定拒絕的資料，確認回來的是 `permission-denied`（請求有送到伺服器、被規則擋下）。
不會真的寫入任何資料。改了 SDK 的 import 或共用腳本之後一定要跑。

## 一致性檢查（不需要網路）

```bash
node tests/check-firebase-services.mjs   # 每頁用到的 firebaseServices.X 是否真的有暴露
node tests/check-shared-globals.mjs      # 每頁用到的共用全域是否有載入對應腳本
```

## 單元／行為測試（不需要網路）

```bash
cd functions && node ../tests/append-order-note.test.cjs   # 訂單備註追加（19 項）
node tests/product-detail-keyboard.test.mjs               # 商品彈窗鍵盤操作（14 項）
node tests/product-modal-tabs.test.mjs                    # 商品彈窗「商品描述／詳細介紹」分頁（13 項）
node tests/products-filters.test.mjs                      # 商品頁篩選（含 $500 以上）、選完即套用、手機兩欄（8 項）
node tests/category-retry.test.mjs                        # 分類讀取失敗後的背景重試
node tests/reset-policy.test.mjs                          # 什麼時候該重建 Firestore 連線（20 項）
node tests/dashboard-retry.test.mjs                       # 後台儀表板連線卡住時：不顯示 0、會自動恢復（6 項）
node tests/offline-not-empty.test.mjs                     # 連線失敗不能顯示成「沒有資料」（8 項）
node tests/cache-skew.test.mjs                            # 新 HTML 配舊快取 JS 時不會整頁壞掉（4 項）
cd functions && node ../tests/rate-limit.test.cjs         # 下單頻率限制（15 項）
cd functions && node ../tests/notify-admin.test.cjs       # 新訂單寄通知信給管理員（6 項）
node tests/cart-price-refresh.test.mjs                    # 購物車：最新價格、刪除立即完成／刪光顯示空購物車、摘要與運費說明、手機底部結帳條、階梯運費不當機（13 項）
node tests/admin-shipping-save.test.mjs                   # 後台運費：空白運費不存 NaN、存一種不覆蓋另一種（3 項）
node tests/scheduler-plan.test.mjs                        # 排程上下架：兩個時間都到期時以較晚的為準（6 項）
node tests/admin-articles.test.mjs                        # 後台栽培小知識／加入會員兩個文章分頁互不干擾（5 項）
node tests/pay-page.test.mjs                              # 付款頁、未付款提醒、訂單記錄預設勾選（12 項）
node tests/order-status.test.mjs                          # 訂單狀態的順序、名稱、算不算已付款（9 項）
cd functions && node ../tests/order-email-payment.test.cjs # 訂單成立通知信的匯款帳號與付款連結（8 項）
```

`cart-price-refresh.test.mjs` 的背景：購物車存的是「加入當下」的價格，後台改價之後，
結帳頁和伺服器會擋下價格對不上的訂單、請顧客回購物車確認——購物車以前不更新價格，
顧客就卡在兩頁之間。

**jsdom 測試的注意事項**：`new JSDOM(html)` 建構完 `readyState` 還是 `loading`，
jsdom 會自己觸發一次 `DOMContentLoaded`。這時再手動 `dispatchEvent` 一次，頁面就會
初始化兩次（事件綁兩次、按一下寫兩筆），測試結果跟真實瀏覽器不一樣。
只有 `readyState !== 'loading'` 時才手動觸發；需要同步拿到初始化結果的測試要
`await` 那次自然觸發的事件（見 `dashboard-retry.test.mjs`）。

`reset-policy.test.mjs` 鎖住重建連線的兩個門檻：這一頁**從沒連上過**就一失敗立刻重建
（冷開卡住時 SDK 自己恢復常要 40～60 秒以上）；**連上過之後**才失敗則持續失敗 30 秒才重建，
避免把「只是慢、正要成功」的連線砍掉。`dashboard-retry.test.mjs` 直接載入
`js/admin-common.js` 裡真正的政策程式碼，不要改回自己假造一份——以前就是假造的版本
跟正式程式碼脫節，測試悄悄失效。

`cache-skew.test.mjs` 的背景：GitHub Pages 對 HTML 和 JS 各自快取 10 分鐘，上線後一段時間內
會有「新 HTML + 舊 JS」的組合。HTML 呼叫共用 JS 新加的函式時一定要先檢查存在
（`typeof X.fn === 'function'`、`if (window.fn)`），否則舊快取的使用者會整頁報錯。

`append-order-note.test.cjs` 用假的 Firestore 驅動真實的 Cloud Function 程式碼，
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
git worktree add ../bm-main origin/main                          # 拉一份 main 出來當對照組
node tests/coldstart-compare.mjs index.html 8 main=../bm-main branch=.
node tests/repro-slow-load.mjs https://flowerbulb.tw/products.html 5
```

`coldstart-compare.mjs` 把幾個版本的網站輪流用「全新瀏覽器 + 全新 profile」冷開
（等於使用者重開瀏覽器第一次進站），模擬 150ms 延遲的網路，量 SDK 開始下載、
第一個 Firestore 請求、商品出現的時間，以及有沒有卡到 10 秒逾時。改連線相關的程式碼
（連線模式、重建政策、預熱）之前後都應該用它比一次。

`repro-slow-load.mjs` 用真實 Chrome 反覆冷開正式站，記錄 Firestore 的 10 秒逾時、
連線重建、分類讀取失敗各發生在第幾毫秒。

### 連線方式的結論：改用 Firestore Lite（2026-10）

使用者回報「重開瀏覽器第一次進站，商品要很久才出來」。用完整網站 + 全新瀏覽器 +
模擬 150ms 延遲冷開，才穩定重現（極簡測試頁、不模擬慢網路時完全重現不出來）。

網路紀錄顯示：完整版 SDK 用一條長時間掛著的連線（WebChannel，`GET .../Listen/channel`）
收資料，這條連線第一輪常常拿不到資料，底層退避 5～15 秒才再問，期間所有查詢排隊等著，
直到 SDK 的 10 秒逾時；重建連線之後，新的連線也常常再卡一次。試過的做法：

| 做法 | 卡住比例 | 卡住時多久才出現商品 |
|---|---|---|
| 完整版、強制長輪詢（原本） | 29/42 | 28 秒～超過 60 秒 |
| 完整版、自動偵測 | 15/34 | 差不多 |
| 完整版 + 從沒連上過就立刻重建 | 約一半 | 13～60 秒以上（重建後常再卡） |
| 關掉 HTTP/3（QUIC） | 5/6 | 沒改善，排除 |
| **Firestore Lite** | **0/8** | 每次 3.1～3.3 秒 |

Lite 每次讀寫都是一般的 HTTPS 請求，沒有長連線可以卡住；本站全部是一次性讀寫，
沒有用即時監聽或離線快取，所以功能不受影響。Lite 沒有 `getDocsFromServer`，
但它的 `getDocs` 本來就一律向伺服器讀取、失敗就丟例外，所以各頁用
`getDocs as getDocsFromServer` 對應，其他程式碼不用改。

另外加了 `<link rel="preconnect">` / `<link rel="modulepreload">`，讓 SDK 在解析 HTML 時
就開始下載（實測 SDK 開始下載的時間從約 0.55 秒提早到約 0.17 秒）。

教訓：**極簡測試頁重現不出來的問題，不代表不存在**；測試條件要盡量接近真實
（完整頁面、冷開、較慢的網路），而且樣本要夠多。
