/**
 * 栽培小知識（文章）共用模組
 *
 * 文章全部存在 Firestore 的 settings/knowledge 這份文件（{ articles: [...] }），
 * 跟布告欄 settings/bulletin 放在一起：settings 底下的文件訪客本來就能讀、管理員能寫，
 * 不需要另外改 Firestore 安全規則。圖片放在 Storage 的 products/knowledge/。
 *
 * 單篇文章格式：
 *   { id, title, category, summary, coverImageUrl, date: 'YYYY-MM-DD', published,
 *     sections: [{ heading, text, imageUrl }] }
 * 內文拆成多個段落區塊（小標題 + 內文 + 選填圖片），對應常見「幾大重點」的文章寫法。
 */
(function() {
    const DOC_PATH = ['settings', 'knowledge'];

    function str(value) {
        return typeof value === 'string' ? value : '';
    }

    function normalizeSection(section) {
        return {
            heading: str(section && section.heading).trim(),
            text: str(section && section.text),
            imageUrl: str(section && section.imageUrl)
        };
    }

    function normalize(items) {
        if (!Array.isArray(items)) return [];
        const seen = new Set();
        return items
            .filter(function(item) {
                if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id)) return false;
                seen.add(item.id);
                return true;
            })
            .map(function(item) {
                return {
                    id: item.id,
                    title: str(item.title).trim() || '（未命名文章）',
                    category: str(item.category).trim(),
                    summary: str(item.summary).trim(),
                    coverImageUrl: str(item.coverImageUrl),
                    date: str(item.date),
                    published: item.published !== false,
                    sections: Array.isArray(item.sections) ? item.sections.map(normalizeSection) : []
                };
            });
    }

    // 新到舊；同一天的維持後台清單順序
    function sortByDate(articles) {
        return articles
            .map(function(article, index) { return { article: article, index: index }; })
            .sort(function(a, b) {
                if (a.article.date !== b.article.date) return a.article.date < b.article.date ? 1 : -1;
                return a.index - b.index;
            })
            .map(function(entry) { return entry.article; });
    }

    /**
     * @param {{publishedOnly?: boolean}} options 前台只拿已發布的文章
     * @returns {Promise<Array>} 讀取失敗會 throw，由呼叫端決定要不要重試
     */
    async function load(options) {
        const services = window.firebaseServices;
        if (!services || !services.db || !services.doc || !services.getDoc) {
            throw new Error('Firebase 服務未初始化');
        }
        const snap = await services.getDoc(services.doc(services.db, DOC_PATH[0], DOC_PATH[1]));
        let articles = snap.exists() ? normalize(snap.data().articles) : [];
        if (options && options.publishedOnly) {
            articles = articles.filter(function(article) { return article.published; });
        }
        return sortByDate(articles);
    }

    // 依文章出現次數整理分類清單（分類分頁用），順序照第一次出現的順序
    function categoriesOf(articles) {
        const counts = new Map();
        articles.forEach(function(article) {
            if (!article.category) return;
            counts.set(article.category, (counts.get(article.category) || 0) + 1);
        });
        return Array.from(counts, function(entry) { return { name: entry[0], count: entry[1] }; });
    }

    // 卡片上的摘要：有填摘要用摘要，沒有就取第一段內文的前 80 字
    function excerptOf(article) {
        if (article.summary) return article.summary;
        const firstText = (article.sections.find(function(s) { return s.text.trim(); }) || {}).text || '';
        const plain = firstText.replace(/\s+/g, ' ').trim();
        return plain.length > 80 ? plain.slice(0, 80) + '⋯' : plain;
    }

    function newId() {
        return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    // 本地時區的 YYYY-MM-DD（toISOString 是 UTC，台灣早上 8 點前會變成前一天）
    function today() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    window.KnowledgeArticles = {
        DOC_PATH: DOC_PATH,
        normalize: normalize,
        load: load,
        categoriesOf: categoriesOf,
        excerptOf: excerptOf,
        newId: newId,
        today: today
    };
})();
