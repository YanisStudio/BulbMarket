import fs from 'node:fs';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
const dom=new JSDOM('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><ul class="footer-category-links"></ul></body></html>',
  {runScripts:'outside-only',url:'https://flowerbulb.tw/'});
const {window}=dom;

// 假 Firestore：前兩次丟「離線」錯誤，第三次才成功（模擬連線卡住後恢復）
let calls=0;
const REAL=[{id:'lily',name:'百合',imageUrl:'https://x/lily.jpg'},
            {id:'calla',name:'海芋',imageUrl:'https://x/calla.jpg'},
            {id:'rare',name:'稀有品種',imageUrl:'https://x/rare.jpg'}];
window.firebaseServices={
  db:{}, doc:(...a)=>({_p:a.slice(1).join('/')}),
  getDoc: async()=>{ calls++;
    if(calls<3){const e=new Error('Failed to get document because the client is offline.');e.code='unavailable';throw e;}
    return {exists:()=>true,data:()=>({items:REAL})};
  }
};
window.eval(fs.readFileSync(ROOT+'/js/categories.js','utf8'));
const PC=window.ProductCategories;

let rendered=[];
PC.onUpdate(list=>rendered.push(list));

const first=await PC.load();
console.log('第 1 次 load（模擬失敗）');
console.log('  回傳的是預設清單:', first.length===PC.DEFAULT_CATEGORIES.length ? '是（畫面先顯示預設分類）' : '否');
const withImg=first.filter(c=>c.imageUrl).length;
console.log('  預設清單裡有圖片的分類:', withImg, '/', first.length, '← 這就是你截圖看到的情況');

// 等背景重試跑完（1s + 2s）
await new Promise(r=>setTimeout(r,4000));

console.log('');
console.log('背景重試後');
console.log('  getDoc 被呼叫次數:', calls, calls>=3?'（有持續重試）':'（沒有重試！）');
console.log('  onUpdate 被通知次數:', rendered.length);
assert.ok(rendered.length>=1,'❌ 重試成功後沒有通知畫面更新');
const last=rendered[rendered.length-1];
assert.strictEqual(last.length,3,'通知的清單內容不對');
assert.ok(last.every(c=>c.imageUrl),'通知的清單應該每個都有真實圖片');
console.log('  通知的清單:', last.map(c=>c.name+'('+(c.imageUrl?'有圖':'無圖')+')').join(', '));
console.log('');
console.log('✅ 連線恢復後分類會自動補上正確圖片，使用者不需要重新整理');
