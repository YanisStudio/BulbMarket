// 商品排程上下架：同一個商品的上架、下架時間都已經到了時，要以比較晚的那個為準。
// 排程實際上大約每 3 小時才跑一次，兩個時間都過了的情況很常見。
import assert from 'node:assert';
import { planTransition } from '../scripts/product-scheduler/plan.mjs';

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
