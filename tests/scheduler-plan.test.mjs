// 商品排程上下架（functions/product-scheduler.js，Cloud Scheduler 每 5 分鐘）：
// - 同一個商品的上架、下架時間都已經到了時，要以比較晚的那個為準
// - 處理流程：兩個查詢撈到同一個商品要去重、清掉用過的排程欄位、超過 500 筆要分批寫入
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../functions/', import.meta.url));
const { planTransition, processScheduledTransitions } = require('./product-scheduler.js')._internal;
const { productScheduler } = require('./product-scheduler.js');

const H = 3600 * 1000;
const NOW = Date.UTC(2026, 9, 14, 15, 0);
const at = (hoursAgo) => NOW - hoursAgo * H;

let pass = 0, fail = 0;
const t = (name, fn) => {
    try { fn(); pass++; console.log('  PASS  ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
};

t('沒有排程或還沒到：不處理', () => {
    assert.strictEqual(planTransition({}, NOW), null);
    assert.strictEqual(planTransition({ scheduledPublishAt: NOW + H }, NOW), null);
});

t('只有上架到期 → 上架，清掉上架排程', () => {
    assert.deepStrictEqual(planTransition({ scheduledPublishAt: at(1) }, NOW),
        { status: 'active', clearFields: ['scheduledPublishAt'] });
});

t('只有下架到期 → 下架，清掉下架排程；還沒到的上架排程保留', () => {
    assert.deepStrictEqual(planTransition({ scheduledUnpublishAt: at(1), scheduledPublishAt: NOW + H }, NOW),
        { status: 'inactive', clearFields: ['scheduledUnpublishAt'] });
});

t('先上架、後下架，兩個都到期 → 最後是下架', () => {
    const plan = planTransition({ scheduledPublishAt: at(5), scheduledUnpublishAt: at(3) }, NOW);
    assert.strictEqual(plan.status, 'inactive');
    assert.deepStrictEqual(plan.clearFields.sort(), ['scheduledPublishAt', 'scheduledUnpublishAt']);
});

t('先下架、後重新上架，兩個都到期 → 最後是上架（以前會被留在下架）', () => {
    const plan = planTransition({ scheduledUnpublishAt: at(3), scheduledPublishAt: at(1) }, NOW);
    assert.strictEqual(plan.status, 'active');
    assert.deepStrictEqual(plan.clearFields.sort(), ['scheduledPublishAt', 'scheduledUnpublishAt']);
});

t('Firestore Timestamp（有 toMillis）也能處理', () => {
    const ts = (ms) => ({ toMillis: () => ms });
    assert.strictEqual(planTransition({ scheduledUnpublishAt: ts(at(3)), scheduledPublishAt: ts(at(1)) }, NOW).status, 'active');
});

// ---- 處理流程：用假的 Firestore ----
function fakeDb(products) {
    const writes = [];
    let batches = 0;
    const docOf = (id) => ({ id, ref: { id }, data: () => products[id] });
    const db = {
        collection: (name) => ({
            where: (field, op, now) => ({
                get: async () => ({
                    docs: Object.keys(products)
                        .filter((id) => products[id][field] !== undefined && products[id][field] <= now.toMillis())
                        .map(docOf),
                }),
            }),
        }),
        batch: () => {
            batches++;
            const ops = [];
            return {
                update: (ref, fields) => ops.push({ id: ref.id, fields }),
                commit: async () => { writes.push(...ops); },
            };
        },
    };
    return { db, writes, batches: () => batches };
}
const NOW_TS = { toMillis: () => NOW };
const DELETE = () => '__delete__';

const asyncTests = [];
const ta = (name, fn) => asyncTests.push([name, fn]);

ta('到期的上架、下架都處理；同時撈到的同一個商品只寫一次；清掉用過的欄位', async () => {
    const { db, writes } = fakeDb({
        a: { name: '百合', scheduledPublishAt: at(1) },
        b: { name: '鬱金香', scheduledUnpublishAt: at(2) },
        c: { name: '海芋', scheduledUnpublishAt: at(3), scheduledPublishAt: at(1) },
        d: { name: '還沒到', scheduledPublishAt: NOW + H },
    });
    const result = await processScheduledTransitions(db, NOW_TS, DELETE);
    const byId = Object.fromEntries(writes.map((w) => [w.id, w.fields]));
    assert.strictEqual(writes.length, 3, '同一個商品被寫了兩次，或還沒到的被處理了');
    assert.deepStrictEqual(byId.a, { status: 'active', scheduledPublishAt: '__delete__' });
    assert.deepStrictEqual(byId.b, { status: 'inactive', scheduledUnpublishAt: '__delete__' });
    assert.deepStrictEqual(byId.c, { status: 'active', scheduledUnpublishAt: '__delete__', scheduledPublishAt: '__delete__' });
    assert.strictEqual(result.published, 2);
    assert.strictEqual(result.unpublished, 1);
});

ta('沒有到期的商品：不寫入', async () => {
    const { db, writes, batches } = fakeDb({ a: { scheduledPublishAt: NOW + H } });
    const result = await processScheduledTransitions(db, NOW_TS, DELETE);
    assert.strictEqual(writes.length, 0);
    assert.strictEqual(batches(), 0);
    assert.deepStrictEqual(result.changes, []);
});

ta('超過 500 筆分批寫入（Firestore 單一批次上限）', async () => {
    const products = {};
    for (let i = 0; i < 1201; i++) products['p' + i] = { scheduledPublishAt: at(1) };
    const { db, writes, batches } = fakeDb(products);
    await processScheduledTransitions(db, NOW_TS, DELETE);
    assert.strictEqual(writes.length, 1201);
    assert.strictEqual(batches(), 3);
});

ta('排程設定：每 5 分鐘、台北時間、台灣機房', async () => {
    const endpoint = productScheduler.__endpoint;
    assert.strictEqual(endpoint.scheduleTrigger.schedule, '*/5 * * * *');
    assert.strictEqual(endpoint.scheduleTrigger.timeZone, 'Asia/Taipei');
    assert.deepStrictEqual([...endpoint.region], ['asia-east1']);
});

for (const [name, fn] of asyncTests) {
    try { await fn(); pass++; console.log('  PASS  ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
