// 用真實的 Chrome 反覆開啟正式網站，重現「一進站 Firestore 就逾時」的狀況，
// 並量測商品從開始載入到真正出現在畫面上要多久。
import puppeteer from 'puppeteer';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] || 'https://flowerbulb.tw/products.html';
const RUNS = Number(process.argv[3] || 5);

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
});

const summary = [];

for (let run = 1; run <= RUNS; run++) {
    // 每次都開新的無痕環境，確保是「第一次進站」的狀態（沒有快取、沒有既有連線）
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();

    const t0 = Date.now();
    let timeoutErr = null;      // Firestore 10 秒逾時出現的時間
    let firstFail = null;       // 第一次「載入商品失敗」
    let reconnected = null;     // 連線重建
    let loadedAt = null;        // 成功載入商品
    let productCount = null;
    let categoryFail = null;

    page.on('console', (msg) => {
        const t = msg.text();
        const dt = Date.now() - t0;
        if (/Could not reach Cloud Firestore backend/.test(t) && timeoutErr === null) timeoutErr = dt;
        if (/載入商品失敗|加載精選商品失敗/.test(t) && firstFail === null) firstFail = dt;
        if (/Firestore 連線已重建/.test(t) && reconnected === null) reconnected = dt;
        if (/讀取商品分類失敗/.test(t) && categoryFail === null) categoryFail = dt;
        const m = t.match(/成功載入 (\d+) 個商品|載入精選商品數量: (\d+)/);
        if (m && loadedAt === null) { loadedAt = dt; productCount = m[1] || m[2]; }
    });

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // 等到商品真的出現在畫面上（最多 60 秒）
    let renderedAt = null;
    try {
        await page.waitForFunction(
            () => document.querySelectorAll('.product-card').length > 0,
            { timeout: 60000, polling: 250 }
        );
        renderedAt = Date.now() - t0;
    } catch (e) { /* 超過 60 秒都沒出現 */ }

    const cards = await page.evaluate(() => document.querySelectorAll('.product-card').length);
    // 分類磚有幾個真的有圖片（而不是預設的幼苗圖示）
    const catStats = await page.evaluate(() => {
        const tiles = document.querySelectorAll('.category-tile, #category-filter option');
        const imgs = document.querySelectorAll('.category-tile-shape img').length;
        return { tiles: tiles.length, withImage: imgs };
    });

    summary.push({ run, timeoutErr, firstFail, reconnected, loadedAt, renderedAt, cards, productCount, categoryFail, catStats });
    console.log(`第 ${run} 次：` +
        (timeoutErr !== null ? `Firestore逾時@${timeoutErr}ms  ` : '無逾時  ') +
        (firstFail !== null ? `首次失敗@${firstFail}ms  ` : '') +
        (reconnected !== null ? `重建連線@${reconnected}ms  ` : '') +
        (renderedAt !== null ? `商品上畫面@${renderedAt}ms (${cards}張)` : `60秒內商品沒出現 (${cards}張)`) +
        (categoryFail !== null ? `  [分類讀取失敗@${categoryFail}ms]` : '') +
        `  分類磚${catStats.tiles}個/有圖${catStats.withImage}個`);

    await ctx.close();
}

await browser.close();

const withTimeout = summary.filter((s) => s.timeoutErr !== null).length;
const rendered = summary.filter((s) => s.renderedAt !== null);
const times = rendered.map((s) => s.renderedAt).sort((a, b) => a - b);
console.log('\n' + '='.repeat(64));
console.log(`共 ${RUNS} 次：${withTimeout} 次遇到 Firestore 10 秒逾時`);
if (times.length) {
    console.log(`商品出現在畫面上的時間：最快 ${times[0]}ms / 中位數 ${times[Math.floor(times.length / 2)]}ms / 最慢 ${times[times.length - 1]}ms`);
}
const catFail = summary.filter((s) => s.categoryFail !== null).length;
console.log(`分類讀取失敗：${catFail} 次`);
