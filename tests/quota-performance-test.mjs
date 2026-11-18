import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<aside data-tour="sessions-sidebar"><ul><li><button><span data-tour="sidebar-nav-new-session">New session</span></button></li></ul></aside>');
 let source=await readFile(new URL('../plugin.js',import.meta.url),'utf8');
 source=source.replace(/import\s*\{[^}]+\}\s*from\s*['"]@hermes\/plugin-sdk['"];?/, 'const {host,queryClient,PALETTE_AREA}=window.__quotaSDK;');
 await page.evaluate(async source=>{
  const atom={get:()=> 'default',subscribe:()=>()=>{}};const disposers=[];const queries=new Map();
  const delay=value=>new Promise(resolve=>setTimeout(()=>resolve(value),11000));
  window.__quotaSDK={host:{state:{profile:atom,gateway:atom},activeConnectionId:()=> 'fixture',request:method=>method==='billing.state'?delay(null):Promise.resolve({providers:[{slug:'openai-codex',name:'Codex (performance fixture)',authenticated:true,usage:{windows:[{label:'Session',used_percent:23,resets_at:'2099-01-01T00:00:00Z'}]}}]})},queryClient:{fetchQuery:o=>{const key=JSON.stringify(o.queryKey);if(!queries.has(key))queries.set(key,Promise.resolve().then(o.queryFn));return queries.get(key);}},PALETTE_AREA:'palette'};
  const ctx={rest:path=>delay(path==='/credits'?{providers:[{slug:'venice',name:'Venice (performance fixture)',status:'ok',balances:[{label:'Credits',remaining:12.34,currency:'USD',scope:'account'}]}],fetchedAt:new Date().toISOString()}:null),register(){},onDispose:fn=>disposers.push(fn),addEventListener(target,type,fn,opts){target.addEventListener(type,fn,opts);disposers.push(()=>target.removeEventListener(type,fn,opts));},setTimeout(fn,ms){const t=setTimeout(fn,ms);const cancel=()=>clearTimeout(t);disposers.push(cancel);return cancel;}};
  const {default:plugin}=await import(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));plugin.register(ctx);window.__dispose=()=>disposers.reverse().forEach(f=>f());
 },source);
 await page.evaluate(()=>{window.__openedAt=performance.now();document.querySelector('[data-quota-trigger]').click();});
 await page.getByText('77% left',{exact:true}).waitFor({timeout:1000});
 const coldFirstResultMs=await page.evaluate(()=>performance.now()-window.__openedAt);
 assert.ok(coldFirstResultMs<1000);assert.equal(await page.getByText('12.34 USD',{exact:true}).count(),0);
 const cachedReopenMs=await page.evaluate(()=>{const b=document.querySelector('[data-quota-trigger]');b.click();const start=performance.now();b.click();if(!document.querySelector('[data-quota-popover]').textContent.includes('77% left'))throw Error('Cached reopen blanked quota');return performance.now()-start;});
 assert.ok(cachedReopenMs<100);
 await page.getByText('12.34 USD',{exact:true}).waitFor({timeout:14000});
 const allResultsMs=await page.evaluate(()=>performance.now()-window.__openedAt);
 const text=await page.locator('[data-quota-popover]').innerText();assert.match(text,/77% left/);assert.deepEqual(errors,[]);
 const result={fixture:true,slowSourceDelayMs:11000,coldFirstResultMs:Math.round(coldFirstResultMs),cachedReopenMs:Math.round(cachedReopenMs*100)/100,allResultsMs:Math.round(allResultsMs),fastQuotaPreserved:true,slowBalancesEventuallyMerged:true,browserErrors:errors};
 const artifacts=new URL('../.test-artifacts/',import.meta.url);
 await mkdir(artifacts,{recursive:true});
 await writeFile(new URL('ui-performance.json',artifacts),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 await page.evaluate(()=>window.__dispose());
}finally{await browser.close();}
