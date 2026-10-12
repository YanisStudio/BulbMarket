// 模擬部署後的快取不同步：新的 HTML + 舊的 js/categories.js（沒有 onUpdate）
import fs from 'node:fs';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
const read=f=>fs.readFileSync(ROOT+'/'+f,'utf8');

// 舊版 categories.js：把 onUpdate 從對外介面拿掉，重現部署前的樣子
const oldCategories = read('js/categories.js').replace(/^\s*onUpdate: onUpdate,\s*$/m, '');
assert.ok(!/onUpdate:/.test(oldCategories), '沒有成功做出舊版');

let pass=0, fail=0;
function t(n,f){try{f();pass++;console.log('  PASS  '+n)}catch(e){fail++;console.log('  FAIL  '+n+'\n        '+e.message)}}

for (const page of ['index.html','products.html']) {
  const html=read(page);
  const body='<!DOCTYPE html><html><head><meta charset="utf-8"></head>'+html.slice(html.indexOf('<body>'));
  const dom=new JSDOM(body,{runScripts:'outside-only',url:'https://flowerbulb.tw/'});
  const {window}=dom;
  window.matchMedia=()=>({matches:false,addEventListener(){}});
  window.console.warn=()=>{}; window.console.error=()=>{};
  window.eval(read('js/common.js'));
  window.eval(oldCategories);                 // ← 舊版
  window.initCommonFeatures=()=>{};
  window.firebaseServices={db:{},doc:()=>({}),getDoc:async()=>{throw new Error('offline')},
    auth:{},onAuthStateChanged:(a,cb)=>{cb(null);return()=>{}},collection:()=>({}),
    query:()=>({}),where:()=>({}),getDocsFromServer:async()=>{throw new Error('offline')}};

  const inline=html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
  let thrown=null;
  window.addEventListener('error',e=>{thrown=e.error||e.message});
  window.eval(inline[1]);
  try { window.document.dispatchEvent(new window.Event('DOMContentLoaded')); }
  catch(e){ thrown=e; }

  t(page+'：舊版 categories.js 不會讓頁面整個掛掉', ()=>{
    assert.ok(!thrown, '仍然丟出例外: '+(thrown&&thrown.message||thrown));
  });
  t(page+'：後續初始化照常執行（分類磚/篩選器有被畫出來）', ()=>{
    const el=window.document.getElementById('category-tiles')||window.document.getElementById('category-filter');
    assert.ok(el, '找不到分類容器');
    assert.ok(el.innerHTML.trim().length>0, '分類沒有被渲染 → 代表 DOMContentLoaded 被中斷了');
  });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
