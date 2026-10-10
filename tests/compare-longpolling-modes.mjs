import puppeteer from 'puppeteer';
import http from 'node:http';
import fs from 'node:fs';

const page_html = fs.readFileSync('probe.html');
const server = http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(page_html);});
await new Promise(r=>server.listen(8099,r));

const browser = await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox']});
const RUNS = Number(process.argv[2]||8);

async function trial(mode){
  const ctx = await browser.createBrowserContext();   // 全新環境 = 模擬第一次進站
  const page = await ctx.newPage();
  let timedOut=false;
  page.on('console',m=>{ if(/Could not reach Cloud Firestore backend/.test(m.text())) timedOut=true; });
  await page.goto(`http://localhost:8099/?mode=${mode}`,{waitUntil:'domcontentloaded'});
  try { await page.waitForFunction(()=>window.__result,{timeout:45000,polling:200}); } catch(e){}
  const r = await page.evaluate(()=>window.__result||{ok:false,ms:-1,error:'45秒內沒有結果'});
  await ctx.close();
  return {...r, timedOut};
}

for (const mode of ['force','auto']) {
  const label = mode==='force' ? 'experimentalForceLongPolling: true（目前正式站）' : 'SDK 預設自動偵測（不設定）';
  console.log(`\n【${label}】`);
  const rows=[];
  for(let i=1;i<=RUNS;i++){
    const r=await trial(mode); rows.push(r);
    console.log(`  第${String(i).padStart(2)}次: ${String(r.ms).padStart(6)}ms  ${r.ok?('成功 '+r.count+' 筆'):('失敗 '+r.error)}${r.timedOut?'  ⚠️10秒逾時':''}`);
  }
  const okRows=rows.filter(r=>r.ok);
  const t=okRows.map(r=>r.ms).sort((a,b)=>a-b);
  console.log(`  → 成功 ${okRows.length}/${RUNS}，逾時 ${rows.filter(r=>r.timedOut).length} 次` +
    (t.length?`，耗時 最快${t[0]}ms 中位數${t[Math.floor(t.length/2)]}ms 最慢${t[t.length-1]}ms`:''));
}
await browser.close(); server.close();
