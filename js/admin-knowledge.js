/**
 * 後台「內容管理 → 栽培小知識」：文章列表 + 編輯器
 *
 * 資料格式與讀取見 js/knowledge.js（settings/knowledge 的 articles 陣列）。
 * 存檔時會重新讀一次最新的文件、只替換/新增正在編輯的這一篇，
 * 避免覆蓋掉別的分頁剛存進去的其他文章。
 * 需要：js/knowledge.js、js/image-upload.js、js/admin-common.js（escapeHtml、AdminCommon）
 */
(function() {
    const DEFAULT_CATEGORIES = ['球根知識', '種植指南', '種植筆記'];

    // 「新增文章」的簡易範本：先放好常見的段落小標題，內文欄用提示文字說明該寫什麼
    // （hint 只顯示在編輯器，不會存進資料庫）。用不到的段落可以直接刪掉、小標題也能改
    const ARTICLE_TEMPLATE = [
        { heading: '', hint: '前言：先簡單介紹這篇的主題，例如這種球根的特色、為什麼適合現在種。' },
        { heading: '一、適合種植的時間', hint: '適合種植的月份、台灣氣候要注意的地方（例如是否需要冷藏催芽）。' },
        { heading: '二、介質與種植方式', hint: '土壤／介質配方、盆器大小、種植深度與間距。' },
        { heading: '三、日常照顧', hint: '日照需求、澆水頻率、施肥時機，以及常見問題。' },
        { heading: '四、開花後的處理', hint: '剪除花莖、養球、休眠期與球根保存方式。' },
        { heading: '小結', hint: '用幾句話整理重點，也可以推薦相關商品。' }
    ];
    const BUCKET = 'bulb-market-217c4.firebasestorage.app';

    let articles = [];
    let draft = null;       // 正在編輯的文章（含還沒上傳的圖片檔）
    let dirty = false;
    let initialized = false;

    const $ = function(id) { return document.getElementById(id); };

    function setDirty(value) {
        dirty = value;
    }

    window.addEventListener('beforeunload', function(event) {
        if (!dirty) return;
        event.preventDefault();
        event.returnValue = '';
    });

    // ---------- 讀取與列表 ----------

    async function reload() {
        const listEl = $('knowledge-admin-list');
        listEl.innerHTML = '<p class="knowledge-empty">載入文章中...</p>';
        try {
            articles = await KnowledgeArticles.load();
            renderList();
        } catch (error) {
            console.error('載入栽培小知識失敗:', error);
            listEl.innerHTML = '<p class="knowledge-empty">載入文章失敗，請重新整理頁面再試一次。</p>';
        }
    }

    function renderList() {
        const listEl = $('knowledge-admin-list');
        if (articles.length === 0) {
            listEl.innerHTML = '<p class="knowledge-empty">還沒有任何文章，按「新增文章」開始寫第一篇吧！</p>';
            return;
        }
        listEl.innerHTML = articles.map(function(article) {
            const thumb = article.coverImageUrl
                ? `<img src="${escapeHtml(article.coverImageUrl)}" alt="">`
                : '<i class="fas fa-seedling"></i>';
            const status = article.published
                ? '<span class="knowledge-status published">已發布</span>'
                : '<span class="knowledge-status draft">草稿</span>';
            return `
                <div class="knowledge-row" data-id="${escapeHtml(article.id)}">
                    <span class="knowledge-thumb">${thumb}</span>
                    <div class="knowledge-row-info">
                        <strong>${escapeHtml(article.title)}</strong>
                        <span class="knowledge-row-meta">
                            ${status}
                            ${article.category ? `<span>${escapeHtml(article.category)}</span>` : '<span class="muted">未分類</span>'}
                            <span>${escapeHtml(article.date || '未設定日期')}</span>
                            <span>${article.sections.length} 個段落</span>
                        </span>
                    </div>
                    <div class="knowledge-row-actions">
                        <button type="button" class="btn btn-outline btn-sm" data-action="edit"><i class="fas fa-edit"></i> 編輯</button>
                        <button type="button" class="btn btn-outline btn-sm" data-action="toggle">${article.published ? '<i class="fas fa-eye-slash"></i> 設為草稿' : '<i class="fas fa-eye"></i> 發布'}</button>
                        ${article.published ? `<a class="btn btn-outline btn-sm" href="/knowledge.html?id=${encodeURIComponent(article.id)}" target="_blank" rel="noopener"><i class="fas fa-external-link-alt"></i> 前台</a>` : ''}
                        <button type="button" class="btn btn-danger btn-sm" data-action="delete"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ---------- 寫入 ----------

    // 讀最新的文件、套用 change(list) 之後整份寫回
    async function writeArticles(change) {
        const services = window.firebaseServices;
        const latest = await KnowledgeArticles.load();
        const next = change(latest).map(stripForSave);
        await services.setDoc(
            services.doc(services.db, KnowledgeArticles.DOC_PATH[0], KnowledgeArticles.DOC_PATH[1]),
            { articles: next, updatedAt: services.serverTimestamp() }
        );
        // 重新讀一次，拿到跟前台一致的排序；讀取失敗就先用剛寫進去的資料
        articles = await KnowledgeArticles.load().catch(function() { return KnowledgeArticles.normalize(next); });
    }

    function stripForSave(article) {
        return {
            id: article.id,
            title: article.title.trim(),
            category: (article.category || '').trim(),
            summary: (article.summary || '').trim(),
            coverImageUrl: article.coverImageUrl || '',
            date: article.date || KnowledgeArticles.today(),
            published: article.published !== false,
            sections: (article.sections || []).map(function(section) {
                return {
                    heading: (section.heading || '').trim(),
                    text: section.text || '',
                    imageUrl: section.imageUrl || ''
                };
            })
        };
    }

    async function uploadImage(file, maxDimension) {
        const services = window.firebaseServices;
        const uploadFile = await ImageUpload.compress(file, { maxDimension: maxDimension, quality: 0.82 });
        // 放在 products/ 底下（跟分類封面同一層），沿用既有的 Storage 規則
        const path = `products/knowledge/${Date.now()}_${uploadFile.name}`;
        await services.uploadBytes(services.storageRef(services.storage, path), uploadFile, ImageUpload.metadataFor(uploadFile));
        return `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media`;
    }

    // ---------- 編輯器 ----------

    function openEditor(article) {
        draft = article
            ? {
                id: article.id,
                isNew: false,
                title: article.title,
                category: article.category,
                summary: article.summary,
                date: article.date || KnowledgeArticles.today(),
                published: article.published,
                coverImageUrl: article.coverImageUrl,
                coverFile: null,
                coverPreview: '',
                sections: article.sections.map(function(s) {
                    return { heading: s.heading, text: s.text, imageUrl: s.imageUrl, file: null, preview: '' };
                })
            }
            : {
                id: KnowledgeArticles.newId(),
                isNew: true,
                title: '',
                category: '',
                summary: '',
                date: KnowledgeArticles.today(),
                published: true,
                coverImageUrl: '',
                coverFile: null,
                coverPreview: '',
                sections: ARTICLE_TEMPLATE.map(function(t) {
                    return { heading: t.heading, hint: t.hint, text: '', imageUrl: '', file: null, preview: '' };
                })
            };
        if (draft.sections.length === 0) {
            draft.sections.push({ heading: '', text: '', imageUrl: '', file: null, preview: '' });
        }
        setDirty(false);
        $('knowledge-list-wrap').hidden = true;
        $('knowledge-editor').hidden = false;
        renderEditor();
        $('knowledge-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function closeEditor() {
        if (dirty && !confirm('這篇文章還沒儲存，確定要放棄修改嗎？')) return;
        draft = null;
        setDirty(false);
        $('knowledge-editor').hidden = true;
        $('knowledge-editor').innerHTML = '';
        $('knowledge-list-wrap').hidden = false;
    }

    function categoryOptions() {
        const names = DEFAULT_CATEGORIES.concat(articles.map(function(a) { return a.category; }))
            .filter(function(name, index, all) { return name && all.indexOf(name) === index; });
        return names.map(function(name) { return `<option value="${escapeHtml(name)}">`; }).join('');
    }

    function imageField(kind, index, src) {
        const dataIndex = index === null ? '' : ` data-index="${index}"`;
        return `
            <div class="knowledge-image-field">
                ${src
                    ? `<img class="knowledge-image-preview ${kind === 'cover' ? 'cover' : ''}" src="${escapeHtml(src)}" alt="">`
                    : `<div class="knowledge-image-empty ${kind === 'cover' ? 'cover' : ''}"><i class="fas fa-image"></i> 尚未選擇圖片</div>`}
                <div class="knowledge-image-actions">
                    <label class="btn btn-outline btn-sm">
                        <i class="fas fa-upload"></i> ${src ? '更換圖片' : '選擇圖片'}
                        <input type="file" accept="image/*" hidden data-image="${kind}"${dataIndex}>
                    </label>
                    ${src ? `<button type="button" class="btn btn-outline btn-sm" data-remove-image="${kind}"${dataIndex}><i class="fas fa-trash"></i> 移除</button>` : ''}
                </div>
            </div>
        `;
    }

    function renderEditor() {
        const d = draft;
        const sectionsHTML = d.sections.map(function(section, index) {
            return `
                <div class="knowledge-section-card" data-index="${index}">
                    <div class="knowledge-section-head">
                        <strong>段落 ${index + 1}</strong>
                        <span>
                            <button type="button" class="icon-btn" data-section-action="up" title="往上移" ${index === 0 ? 'disabled' : ''}><i class="fas fa-arrow-up"></i></button>
                            <button type="button" class="icon-btn" data-section-action="down" title="往下移" ${index === d.sections.length - 1 ? 'disabled' : ''}><i class="fas fa-arrow-down"></i></button>
                            <button type="button" class="icon-btn danger" data-section-action="delete" title="刪除段落" ${d.sections.length === 1 ? 'disabled' : ''}><i class="fas fa-trash"></i></button>
                        </span>
                    </div>
                    <div class="form-group">
                        <label>小標題（選填）</label>
                        <input type="text" data-section-field="heading" value="${escapeHtml(section.heading)}" maxlength="60" placeholder="例：一、挑選健康的球根">
                    </div>
                    <div class="form-group">
                        <label>圖片（選填，顯示在小標題下方）</label>
                        ${imageField('section', index, section.preview || section.imageUrl)}
                    </div>
                    <div class="form-group">
                        <label>內文</label>
                        <textarea data-section-field="text" rows="7" placeholder="${escapeHtml(section.hint || '空一行會分成新的段落')}">${escapeHtml(section.text)}</textarea>
                    </div>
                </div>
            `;
        }).join('');

        $('knowledge-editor').innerHTML = `
            <div class="knowledge-editor-card">
                <div class="knowledge-editor-header">
                    <h2>${d.isNew ? '新增文章' : '編輯文章'}</h2>
                    <button type="button" class="btn btn-outline btn-sm" data-editor-action="cancel"><i class="fas fa-arrow-left"></i> 回文章列表</button>
                </div>

                <div class="form-group">
                    <label for="kn-title">文章標題 <span class="required">*</span></label>
                    <input type="text" id="kn-title" data-field="title" value="${escapeHtml(d.title)}" maxlength="80" placeholder="例：秋天種什麼球根？4 大重點帶你快速入門">
                </div>

                <div class="knowledge-form-row">
                    <div class="form-group">
                        <label for="kn-category">分類</label>
                        <input type="text" id="kn-category" data-field="category" value="${escapeHtml(d.category)}" list="kn-category-list" maxlength="20" placeholder="例：球根知識">
                        <datalist id="kn-category-list">${categoryOptions()}</datalist>
                    </div>
                    <div class="form-group">
                        <label for="kn-date">發布日期</label>
                        <input type="date" id="kn-date" data-field="date" value="${escapeHtml(d.date)}">
                    </div>
                    <div class="form-group">
                        <label>狀態</label>
                        <label class="knowledge-checkbox">
                            <input type="checkbox" data-field="published" ${d.published ? 'checked' : ''}> 發布到前台
                        </label>
                    </div>
                </div>

                <div class="form-group">
                    <label for="kn-summary">摘要（選填，顯示在文章卡片與文章開頭；沒填會自動取第一段內文）</label>
                    <textarea id="kn-summary" data-field="summary" rows="3" maxlength="200" placeholder="用一兩句話說明這篇文章要介紹什麼，例如：秋天是種鬱金香的好時機，這篇整理從挑球根到開花的 4 個重點。">${escapeHtml(d.summary)}</textarea>
                </div>

                <div class="form-group">
                    <label>封面圖片（建議 4:3 橫式，例如 1200 × 900）</label>
                    ${imageField('cover', null, d.coverPreview || d.coverImageUrl)}
                </div>

                <h3 class="knowledge-sections-title">文章內容</h3>
                <div id="knowledge-sections">${sectionsHTML}</div>
                <button type="button" class="btn btn-outline" data-editor-action="add-section"><i class="fas fa-plus"></i> 新增段落</button>

                <div class="knowledge-editor-footer">
                    <button type="button" class="btn btn-primary" data-editor-action="save"><i class="fas fa-save"></i> 儲存文章</button>
                    <button type="button" class="btn btn-secondary" data-editor-action="cancel">取消</button>
                </div>
            </div>
        `;
    }

    function sectionIndexOf(element) {
        const card = element.closest('.knowledge-section-card');
        return card ? Number(card.dataset.index) : -1;
    }

    function bindEditorEvents() {
        const editor = $('knowledge-editor');

        editor.addEventListener('input', function(event) {
            if (!draft) return;
            const target = event.target;
            if (target.dataset.field && target.type !== 'checkbox') {
                draft[target.dataset.field] = target.value;
                setDirty(true);
            } else if (target.dataset.sectionField) {
                draft.sections[sectionIndexOf(target)][target.dataset.sectionField] = target.value;
                setDirty(true);
            }
        });

        editor.addEventListener('change', function(event) {
            if (!draft) return;
            const target = event.target;
            if (target.dataset.field === 'published') {
                draft.published = target.checked;
                setDirty(true);
                return;
            }
            if (!target.dataset.image || !target.files[0]) return;
            const file = target.files[0];
            const reader = new FileReader();
            reader.onload = function(e) {
                if (target.dataset.image === 'cover') {
                    draft.coverFile = file;
                    draft.coverPreview = e.target.result;
                } else {
                    const section = draft.sections[Number(target.dataset.index)];
                    section.file = file;
                    section.preview = e.target.result;
                }
                setDirty(true);
                renderEditor();
            };
            reader.readAsDataURL(file);
        });

        editor.addEventListener('click', function(event) {
            if (!draft) return;
            const removeBtn = event.target.closest('[data-remove-image]');
            if (removeBtn) {
                if (removeBtn.dataset.removeImage === 'cover') {
                    draft.coverFile = null;
                    draft.coverPreview = '';
                    draft.coverImageUrl = '';
                } else {
                    const section = draft.sections[Number(removeBtn.dataset.index)];
                    section.file = null;
                    section.preview = '';
                    section.imageUrl = '';
                }
                setDirty(true);
                renderEditor();
                return;
            }

            const sectionBtn = event.target.closest('[data-section-action]');
            if (sectionBtn) {
                const index = sectionIndexOf(sectionBtn);
                const list = draft.sections;
                const action = sectionBtn.dataset.sectionAction;
                if (action === 'up' && index > 0) {
                    [list[index - 1], list[index]] = [list[index], list[index - 1]];
                } else if (action === 'down' && index < list.length - 1) {
                    [list[index + 1], list[index]] = [list[index], list[index + 1]];
                } else if (action === 'delete' && list.length > 1) {
                    if (!confirm(`刪除段落 ${index + 1}？`)) return;
                    list.splice(index, 1);
                } else {
                    return;
                }
                setDirty(true);
                renderEditor();
                return;
            }

            const editorBtn = event.target.closest('[data-editor-action]');
            if (!editorBtn) return;
            const action = editorBtn.dataset.editorAction;
            if (action === 'cancel') {
                closeEditor();
            } else if (action === 'add-section') {
                draft.sections.push({ heading: '', text: '', imageUrl: '', file: null, preview: '' });
                setDirty(true);
                renderEditor();
                const cards = document.querySelectorAll('.knowledge-section-card');
                cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else if (action === 'save') {
                saveDraft();
            }
        });
    }

    async function saveDraft() {
        if (!draft.title.trim()) {
            window.AdminCommon.showToast('請填寫文章標題', 'warning');
            $('kn-title').focus();
            return;
        }
        const hasContent = draft.sections.some(function(s) { return s.text.trim() || s.heading.trim() || s.file || s.imageUrl; });
        if (!hasContent) {
            window.AdminCommon.showToast('文章內容還是空的，請至少填一個段落', 'warning');
            return;
        }

        // 範本留下來、只有小標題沒寫內文的段落，前台會顯示成空的標題，先提醒一下
        const headingOnly = draft.sections.filter(function(s) {
            return s.heading.trim() && !s.text.trim() && !s.file && !s.imageUrl;
        });
        if (headingOnly.length > 0) {
            const names = headingOnly.map(function(s) { return '・' + s.heading.trim(); }).join('\n');
            if (!confirm(`以下段落只有小標題、還沒有內文：\n${names}\n\n確定要直接儲存嗎？（不需要的段落可以按垃圾桶刪除）`)) return;
        }

        window.AdminCommon.showLoading('儲存文章中...');
        try {
            if (draft.coverFile) {
                draft.coverImageUrl = await uploadImage(draft.coverFile, 1600);
                draft.coverFile = null;
                draft.coverPreview = '';
            }
            for (const section of draft.sections) {
                if (section.file) {
                    section.imageUrl = await uploadImage(section.file, 1200);
                    section.file = null;
                    section.preview = '';
                }
            }

            // 完全空白的段落不存
            const sections = draft.sections.filter(function(s) { return s.text.trim() || s.heading.trim() || s.imageUrl; });
            const saved = Object.assign({}, draft, { sections: sections });

            await writeArticles(function(list) {
                const index = list.findIndex(function(a) { return a.id === saved.id; });
                if (index === -1) list.unshift(saved);
                else list[index] = saved;
                return list;
            });

            setDirty(false);
            draft = null;
            $('knowledge-editor').hidden = true;
            $('knowledge-editor').innerHTML = '';
            $('knowledge-list-wrap').hidden = false;
            renderList();
            window.AdminCommon.showToast('文章已儲存', 'success');
        } catch (error) {
            console.error('儲存文章失敗:', error);
            window.AdminCommon.handleError(error, '儲存文章');
            // 圖片可能已經上傳成功，重畫一次讓畫面反映已上傳的網址
            if (draft) renderEditor();
        } finally {
            window.AdminCommon.hideLoading();
        }
    }

    function bindListEvents() {
        $('knowledge-new-btn').addEventListener('click', function() { openEditor(null); });

        $('knowledge-admin-list').addEventListener('click', async function(event) {
            const button = event.target.closest('button[data-action]');
            if (!button) return;
            const id = button.closest('.knowledge-row').dataset.id;
            const article = articles.find(function(a) { return a.id === id; });
            if (!article) return;
            const action = button.dataset.action;

            if (action === 'edit') {
                openEditor(article);
                return;
            }

            if (action === 'delete' && !confirm(`確定要刪除「${article.title}」嗎？刪除後無法復原。`)) return;

            window.AdminCommon.showLoading(action === 'delete' ? '刪除中...' : '更新中...');
            try {
                await writeArticles(function(list) {
                    if (action === 'delete') return list.filter(function(a) { return a.id !== id; });
                    return list.map(function(a) {
                        return a.id === id ? Object.assign({}, a, { published: !a.published }) : a;
                    });
                });
                renderList();
                window.AdminCommon.showToast(action === 'delete' ? '文章已刪除' : '發布狀態已更新', 'success');
            } catch (error) {
                console.error('更新文章失敗:', error);
                window.AdminCommon.handleError(error, action === 'delete' ? '刪除文章' : '更新發布狀態');
            } finally {
                window.AdminCommon.hideLoading();
            }
        });
    }

    window.AdminKnowledge = {
        init: function() {
            if (initialized) return;
            initialized = true;
            bindListEvents();
            bindEditorEvents();
            reload();
        }
    };
})();
