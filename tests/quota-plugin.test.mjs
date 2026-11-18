import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const path = new URL('../plugin.js',import.meta.url);

test('Nous subscription gauges show remaining fractions and plan name',async()=>{
 const h=await setup({providers:[{slug:'nous',name:'Nous',authenticated:true,plan_usage:{kind:'usage_window',plan:'Pro',gauges:[{label:'week',left_fraction:0.42,resets_at_ms:4070908800000}]}}]});
 try {document.querySelector('[data-quota-trigger]').click();await h.tick();const text=document.querySelector('[data-quota-popover]').textContent;assert.match(text,/42% left/);assert.match(text,/Pro/);assert.match(text,/week/i);}finally{h.cleanup();}
});
test('pooled accounts stay separate; unknown and expired windows never look full',async()=>{
 const h=await setup({providers:[{slug:'test',name:'Subscription',authenticated:true,usage:{accounts:[{id:'one',label:'Work',state:'ready',windows:[{label:'Weekly',used_percent:90}]},{id:'two',label:'Personal',state:'unknown',windows:[{label:'Weekly',used_percent:0}]},{id:'three',label:'Expired',state:'ready',windows:[{label:'Daily',used_percent:10,resets_at:'2000-01-01T00:00:00Z'}]}]}}]});
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/Work/);assert.match(p.textContent,/10% left/);assert.match(p.textContent,/Usage not available/);assert.match(p.textContent,/Update needed/);assert.equal(p.querySelectorAll('[role="meter"]').length,1);}finally{h.cleanup();}
});
test('errors expose retry without leaking backend messages',async()=>{
 const h=await setup(new Error('secret-token-example'));
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/Could not load quota/);assert.match(p.textContent,/Retry/);assert.doesNotMatch(p.textContent,/secret-token/);}finally{h.cleanup();}
});
test('outside click dismisses and disposal removes every owned node',async()=>{
 const h=await setup({providers:[]});document.querySelector('[data-quota-trigger]').click();await h.tick();document.body.dispatchEvent(new h.dom.window.Event('pointerdown',{bubbles:true}));assert.equal(document.querySelector('[data-quota-popover]'),null);const doc=document;h.cleanup();assert.equal(doc.querySelector('[data-quota-row]'),null);
});
test('non-finite numbers and disconnected providers are not displayed as gauges',async()=>{
 const h=await setup({providers:[{slug:'off',name:'Signed out',authenticated:false},{slug:'on',name:'Connected',authenticated:true,usage:{windows:[{label:'Bad',used_percent:NaN},{label:'Valid',used_percent:120}]}}]});
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');assert.doesNotMatch(p.textContent,/Signed out|NaN|Bad/);assert.match(p.textContent,/0% left/);assert.equal(p.querySelectorAll('[role="meter"]').length,1);}finally{h.cleanup();}
});
test('Antigravity uses gateway REST, preserves pools and remaining percentages, and flags any zero window',async()=>{
 const h=await setup({providers:[]},{status:'ok',fetchedAt:'2099-01-01T00:00:00Z',windows:[
  {pool:'Gemini Models',window:'Weekly Limit Remaining',remainingPercent:98,resetAt:'2099-01-07T00:00:00Z'},
  {pool:'Gemini Models',window:'Five Hour Limit Remaining',remainingPercent:92,resetAt:'2099-01-01T05:00:00Z'},
  {pool:'Claude and GPT models',window:'Weekly Limit Remaining',remainingPercent:47,resetAt:'2099-01-07T00:00:00Z'},
  {pool:'Claude and GPT models',window:'Five Hour Limit Remaining',remainingPercent:0,resetAt:'2099-01-01T05:00:00Z'},
  {pool:'Gemini 4 Argon',window:'Gemini 4 Argon Weekly Limit',remainingPercent:88,resetAt:'2099-01-07T00:00:00Z'}]});
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/98% left/);assert.match(p.textContent,/92% left/);assert.match(p.textContent,/47% left/);assert.match(p.textContent,/0% left/);assert.equal(p.querySelector('[data-quota-state="exhausted"]')?.getAttribute('aria-label'),'Exhausted');assert.equal(p.querySelectorAll('[data-quota-pool]').length,3);assert.equal(p.querySelectorAll('[role="meter"]').length,5);assert.equal([...p.querySelectorAll('[data-quota-pool]')].find(x=>x.textContent.includes('Gemini 4 Argon')).querySelectorAll('[role="meter"]').length,1);assert.ok(h.calls.some(c=>c.method==='REST'&&c.params==='/antigravity'));assert.ok(h.calls.every(c=>c.method!=='cli.exec'));}finally{h.cleanup();}
});
test('Antigravity backend failure leaves other quotas available',async()=>{
 const h=await setup({providers:[{slug:'antigravity-agy',name:'Antigravity',authenticated:true},{slug:'openai-codex',name:'Codex',usage:{windows:[{label:'Weekly',used_percent:20}]}}]},new Error('private stderr'));
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const text=document.querySelector('[data-quota-popover]').textContent;assert.match(text,/80% left/);assert.match(text,/Antigravity/);assert.match(text,/gateway/i);assert.doesNotMatch(text,/private stderr/);}finally{h.cleanup();}
});
test('Antigravity still displays when the provider inventory fails',async()=>{
 const h=await setup(new Error('inventory offline'),{status:'ok',windows:[{pool:'Pool',window:'Weekly',remainingPercent:0.4,resetAt:'2099-01-07T00:00:00Z'}]});
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/0.4% left/);assert.doesNotMatch(p.textContent,/Exhausted/);assert.match(p.textContent,/Other provider quota unavailable/);}finally{h.cleanup();}
});
test('API-key balances distinguish account credit, key budgets, currencies and zero without percentage bars',async()=>{
 const h=await setup({providers:[{slug:'openrouter',name:'OpenRouter',authenticated:true,auth_type:'api_key'}]},null,{fetchedAt:'2099-01-01T00:00:00Z',providers:[
  {slug:'openrouter',name:'OpenRouter',status:'ok',balances:[{label:'Account balance',remaining:12.34,currency:'USD',scope:'account'},{label:'API key budget',remaining:0,currency:'USD',scope:'key',accountLabel:'Work'}]},
  {slug:'venice',name:'Venice',status:'ok',balances:[{label:'DIEM balance',remaining:42.125,currency:'DIEM',scope:'account'},{label:'Account balance',remaining:-0.5,currency:'USD',scope:'account'}]}]});
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/12.34/);assert.match(p.textContent,/USD/);assert.match(p.textContent,/API key budget/);assert.match(p.textContent,/Work/);assert.match(p.textContent,/0.00/);assert.match(p.textContent,/42.125 DIEM/);assert.match(p.textContent,/-0.50/);assert.equal(p.querySelectorAll('[data-quota-balance]').length,4);assert.equal(p.querySelectorAll('[role="meter"]').length,0);assert.equal([...p.querySelectorAll('.quota-provider-name')].filter(e=>e.textContent==='OpenRouter').length,1);assert.doesNotMatch(p.textContent,/Usage not available/);assert.ok(h.calls.some(c=>c.method==='REST'&&c.params==='/credits'));}finally{h.cleanup();}
});
test('Unsupported balances and billing permissions are explicit and raw messages stay hidden',async()=>{
 const h=await setup({providers:[]},null,{providers:[{slug:'openai',name:'OpenAI',status:'unsupported',message:'private-message',balances:[]},{slug:'openrouter',name:'OpenRouter',status:'unavailable',messageCode:'permission_required',balances:[{label:'API key budget',scope:'key',remaining:3,currency:'USD'}]}]});
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/No balance API/);assert.match(p.textContent,/billing permission/);assert.match(p.textContent,/API key budget/);assert.doesNotMatch(p.textContent,/private-message|No connected providers/);}finally{h.cleanup();}
});
test('Invalid credit numbers never appear as real balances',async()=>{
 const h=await setup({providers:[]},null,{providers:[{slug:'bad',name:'Bad',status:'ok',balances:[{label:'NaN',remaining:NaN,currency:'USD'},{label:'Infinity',remaining:Infinity,currency:'USD'},{label:'String',remaining:'5',currency:'USD'},{label:'Broken currency',remaining:5,currency:'<script>'}]}]});
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');assert.equal(p.querySelectorAll('[data-quota-balance]').length,0);assert.match(p.textContent,/Balance not reported/);assert.doesNotMatch(p.textContent,/NaN|Infinity|<script>/);}finally{h.cleanup();}
});
test('Credit balances remain visible if provider inventory and Antigravity fail',async()=>{
 const h=await setup(new Error('private inventory'),new Error('private cli'),{providers:[{slug:'venice',name:'Venice',status:'ok',balances:[{label:'Account balance',scope:'account',remaining:5,currency:'USD'}]}]});
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/5.00/);assert.doesNotMatch(p.textContent,/Could not load quota|private/);}finally{h.cleanup();}
});
test('A gateway without Antigravity does not gain an unavailable Antigravity section',async()=>{
 const h=await setup({providers:[{slug:'openrouter',name:'OpenRouter',authenticated:true}]},{status:'unavailable',windows:[]},{providers:[]});
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();assert.doesNotMatch(document.querySelector('[data-quota-popover]').textContent,/Antigravity/);}finally{h.cleanup();}
});
test('Multiple API keys for the same provider retain successful and failed accounts separately',async()=>{
 const h=await setup({providers:[{slug:'venice',name:'Venice',authenticated:true}]},null,{providers:[{slug:'venice',name:'Venice (Account 1)',status:'ok',balances:[{label:'USD credits',remaining:8.25,currency:'USD',scope:'account',accountLabel:'Account 1'}]},{slug:'venice',name:'Venice (Account 2)',status:'unavailable',balances:[],messageCode:'permission_required'}]});
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/8.25 USD/);assert.match(p.textContent,/Account 2/);assert.match(p.textContent,/billing permission/);assert.equal(p.querySelectorAll('[data-quota-balance]').length,1);}finally{h.cleanup();}
});
test('Multiple-account credit fixture renders every account without dropping balances',async()=>{
 const body={providers:[{slug:'venice',status:'ok',balances:[{remaining:7.54,currency:'USD',scope:'account'},{remaining:0,currency:'DIEM',scope:'account'}]},{slug:'venice',name:'Account 2',status:'unavailable',messageCode:'permission_required',balances:[]},{slug:'gemini',status:'ok',balances:[{remaining:12,currency:'USD',scope:'account'}]}]};
 const h=await setup({providers:[{slug:'venice',name:'Venice',authenticated:true},{slug:'gemini',name:'Google AI Studio',authenticated:true}]},null,body);
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');const amounts=body.providers.flatMap(r=>r.balances);assert.equal(p.querySelectorAll('[data-quota-balance]').length,amounts.length);for(const b of amounts)assert.ok(p.textContent.includes(`${new Intl.NumberFormat(undefined,{minimumFractionDigits:2,maximumFractionDigits:6}).format(b.remaining)} ${b.currency}`));assert.match(p.textContent,/Account 2/);assert.match(p.textContent,/billing permission/);}finally{h.cleanup();}
});
test('Machine-wide balances identify all owning bots without repeating a shared balance',async()=>{
 const h=await setup({providers:[]},null,{providers:[{slug:'openrouter',name:'OpenRouter',profiles:['fixture-bot-a','fixture-bot-b'],status:'ok',balances:[{label:'API key budget',scope:'key',remaining:4.75,currency:'USD'}]}]});
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/fixture-bot-a/);assert.match(p.textContent,/fixture-bot-b/);assert.match(p.textContent,/all bots/i);assert.equal(p.querySelectorAll('[data-quota-balance]').length,1);}finally{h.cleanup();}
});
test('A key connected on another bot is not hidden by the current profile being signed out',async()=>{
 const h=await setup({providers:[{slug:'openrouter',name:'OpenRouter',authenticated:false}]},null,{providers:[{slug:'openrouter',name:'OpenRouter',profiles:['fixture-bot-b'],status:'ok',balances:[{label:'API key budget',scope:'key',remaining:3.5,currency:'USD'}]}]});
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const text=document.querySelector('[data-quota-popover]').textContent;assert.match(text,/fixture-bot-b/);assert.match(text,/3.50 USD/);}finally{h.cleanup();}
});
test('The popup includes all configured roster providers even without a billing API, and uses Nous portal gauges',async()=>{
 const h=await setup({providers:[{slug:'nous',name:'Nous Portal',authenticated:true},{slug:'venice-ai',name:'Venice',authenticated:true}]},null,{providers:[{slug:'venice',name:'Venice',status:'ok',balances:[{label:'USD credits',remaining:4,currency:'USD',scope:'account'}]}],inventory:[{slug:'gemini',name:'Google AI Studio',authenticated:false,profiles:['fixture-bot-a'],reasonCode:'credentials_unavailable'},{slug:'nous',name:'Nous Portal',authenticated:true,profiles:['default','seo-specialist'],plan_usage:{plan:'Pro',gauges:[{label:'Weekly',left_fraction:0.42}]}}]});
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/Google AI Studio/);assert.match(p.textContent,/fixture-bot-a/);assert.match(p.textContent,/42% left/);assert.match(p.textContent,/Pro/);assert.match(p.textContent,/4.00 USD/);assert.equal([...p.querySelectorAll('.quota-provider-name')].filter(n=>n.textContent==='Venice').length,1);}finally{h.cleanup();}
});
test('A complete gateway roster still renders when current-profile model options fail',async()=>{
 const h=await setup(new Error('offline inventory'),null,{providers:[],inventory:[{slug:'gemini',name:'Google AI Studio',authenticated:true,profiles:['default']},{slug:'nous',name:'Nous Portal',authenticated:true,profiles:['seo-specialist']}]});
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/Google AI Studio/);assert.match(p.textContent,/Nous Portal/);assert.doesNotMatch(p.textContent,/Could not load quota/);}finally{h.cleanup();}
});
test('Nous shows the same available, included and purchased credits as Settings Billing',async()=>{
 const h=await setup({providers:[{slug:'nous',name:'Nous Portal',authenticated:true}]},null,null,{ok:true,logged_in:true,balance_usd:'0',balance_display:'$0',usage:{available:true,plan_name:'Plus',renews_at:'2099-01-01T00:00:00Z',total_spendable_display:'$20.75',subscription_remaining_display:'$20.75',topup_remaining_display:'$0.00',plan_bar:{pct_used:6}}});
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/Available credits/);assert.match(p.textContent,/\$20.75/);assert.match(p.textContent,/Included credits/);assert.match(p.textContent,/Purchased credits/);assert.match(p.textContent,/\$0.00/);assert.match(p.textContent,/94% left/);assert.match(p.textContent,/Plus/);assert.doesNotMatch(p.textContent,/Usage not available/);assert.ok(h.calls.some(c=>c.method==='billing.state'));}finally{h.cleanup();}
});
test('An authoritative Nous billing account appears even when inventory omits it',async()=>{
 const h=await setup({providers:[]},null,{providers:[]},{ok:true,logged_in:true,balance_usd:'12.50',balance_display:'$12.50'});
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/Nous Portal/);assert.match(p.textContent,/12.50 USD/);assert.doesNotMatch(p.textContent,/No connected providers/);}finally{h.cleanup();}
});
test('Provider-reported monthly dollar spend replaces unavailable balance without becoming remaining credit',async()=>{
 const h=await setup({providers:[{slug:'anthropic',name:'Anthropic',authenticated:true}]},null,{providers:[{slug:'anthropic',name:'Anthropic',status:'unsupported',balances:[]}],spend:[{slug:'anthropic',name:'Anthropic',status:'ok',amount:12.34,currency:'USD',source:'provider',coverage:'account',periodStart:'2099-01-01T00:00:00Z',periodEnd:'2099-01-15T00:00:00Z',asOf:'2099-01-15T00:00:00Z'}]});
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/12.34 USD/);assert.match(p.textContent,/Spent/);assert.match(p.textContent,/Provider-reported/);assert.doesNotMatch(p.textContent,/12.34.*left|No balance API/);assert.equal(p.querySelectorAll('[data-quota-spend]').length,1);assert.equal(p.querySelectorAll('[role="meter"]').length,0);}finally{h.cleanup();}
});
test('Hermes estimates from another bot stay visible with scope and partial-coverage warnings',async()=>{
 const h=await setup({providers:[{slug:'gemini',name:'Google AI Studio',authenticated:false}]},null,{providers:[],spend:[{slug:'gemini',name:'Google AI Studio',profiles:['fixture-bot-a','fixture-bot-b'],status:'ok',amount:0,currency:'USD',source:'hermes_estimate',coverage:'hermes_only',missingCostCount:2,setupRequired:['google_billing_export_required'],periodStart:'2099-01-01T00:00:00Z',periodEnd:'2099-01-15T00:00:00Z'}]});
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/0.00 USD/);assert.match(p.textContent,/Hermes-recorded estimate/);assert.match(p.textContent,/excludes other apps/);assert.match(p.textContent,/2 records have no cost/);assert.match(p.textContent,/Google billing export/);assert.match(p.textContent,/fixture-bot-a/);assert.equal(p.querySelectorAll('[data-quota-spend="hermes_estimate"]').length,1);}finally{h.cleanup();}
});
test('A real account balance wins; otherwise provider spend wins over a Hermes estimate',async()=>{
 const rows=[{slug:'anthropic',name:'Anthropic',status:'ok',amount:7.25,currency:'USD',source:'provider',periodStart:'2099-01-01T00:00:00Z',periodEnd:'2099-01-15T00:00:00Z'},{slug:'anthropic',name:'Anthropic',status:'ok',amount:1.5,currency:'USD',source:'hermes_estimate',periodStart:'2099-01-01T00:00:00Z',periodEnd:'2099-01-15T00:00:00Z'}];
 let h=await setup({providers:[]},null,{providers:[],spend:rows});
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/7.25 USD/);assert.doesNotMatch(p.textContent,/1.50 USD|Hermes-recorded estimate/);assert.equal(p.querySelectorAll('[data-quota-spend]').length,1);}finally{h.cleanup();}
 h=await setup({providers:[]},null,{providers:[{slug:'anthropic',name:'Anthropic',status:'ok',balances:[{label:'Account balance',remaining:0,currency:'USD',scope:'account'}]}],spend:rows});
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/0.00 USD/);assert.equal(p.querySelectorAll('[data-quota-spend]').length,0);}finally{h.cleanup();}
});
test('A per-key budget does not mask dollar spend, while invalid money never becomes zero',async()=>{
 const h=await setup({providers:[]},null,{providers:[{slug:'anthropic',name:'Anthropic',status:'ok',balances:[{label:'Budget',remaining:3,currency:'USD',scope:'key'}]}],spend:[{slug:'anthropic',name:'Anthropic',status:'ok',amount:7.25,currency:'USD',source:'provider',periodStart:'2099-01-01T00:00:00Z',periodEnd:'2099-01-15T00:00:00Z'},{slug:'gemini',name:'Google AI Studio',status:'unavailable',amount:null,currency:'USD',source:'hermes_estimate',setupRequired:['google_billing_export_required']}]});
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/3.00 USD/);assert.match(p.textContent,/7.25 USD/);assert.match(p.textContent,/Dollar spend unavailable/);assert.doesNotMatch(p.textContent,/0.00 USD|NaN|Infinity/);}finally{h.cleanup();}
});
test('Gateway spend fixtures render as partial Hermes observations',async()=>{
 const evidence={spend:[{slug:'anthropic',status:'ok',source:'hermes_estimate',amount:0.125,currency:'USD',missingCostCount:2,setupRequired:['anthropic_cost_permission'],coverageNote:'Excludes multi-call cumulative routes',periodStart:'2099-01-01T00:00:00Z',periodEnd:'2099-01-12T00:00:00Z'}]};
 const h=await setup({providers:[{slug:'anthropic',name:'Anthropic',authenticated:true}]},null,{providers:[],spend:evidence.spend});
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');const known=evidence.spend.filter(s=>s.status==='ok'&&typeof s.amount==='number');assert.equal(p.querySelectorAll('[data-quota-spend]').length,known.length);for(const s of known)assert.ok(p.textContent.includes(`${new Intl.NumberFormat(undefined,{minimumFractionDigits:2,maximumFractionDigits:6}).format(s.amount)} ${s.currency}`));assert.match(p.textContent,/multi-call cumulative routes/);assert.match(p.textContent,/Anthropic billing access/);assert.doesNotMatch(p.textContent,/Provider-reported/);}finally{h.cleanup();}
});
test('Fast quota appears without waiting for a stalled provider',async()=>{
 const stalled=new Promise(()=>{});
 const h=await setup({providers:[{slug:'openai-codex',name:'OpenAI Codex',authenticated:true,usage:{windows:[{label:'Session',used_percent:23,resets_at:'2099-01-01T00:00:00Z'}]}}]},stalled,stalled,stalled);
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/77% left/);assert.match(p.textContent,/Checking/);assert.doesNotMatch(p.textContent,/API-key balances unavailable/);}finally{h.cleanup();}
});
test('Reopening shows cached results synchronously while every refresh is stalled',async()=>{
 const h=await setup({providers:[{slug:'openai-codex',name:'OpenAI Codex',authenticated:true,usage:{windows:[{label:'Session',used_percent:23,resets_at:'2099-01-01T00:00:00Z'}]}}]},null,{providers:[{slug:'venice',name:'Venice',status:'ok',balances:[{label:'Credits',remaining:12.34,currency:'USD',scope:'account'}]}]});
 try{const button=document.querySelector('[data-quota-trigger]');button.click();await h.tick();button.click();globalThis.__quotaSDK.queryClient.fetchQuery=()=>new Promise(()=>{});button.click();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/77% left/);assert.match(p.textContent,/12.34 USD/);assert.match(p.textContent,/cached/i);}finally{h.cleanup();}
});
test('Late balances merge without removing already-visible quota',async()=>{
 let release;const credits=new Promise(resolve=>{release=resolve});
 const h=await setup({providers:[{slug:'openai-codex',name:'Codex',authenticated:true,usage:{windows:[{label:'Session',used_percent:23,resets_at:'2099-01-01T00:00:00Z'}]}}]},null,credits);
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();assert.match(document.querySelector('[data-quota-popover]').textContent,/77% left/);release({providers:[{slug:'venice',name:'Venice',status:'ok',balances:[{label:'Credits',remaining:12.34,currency:'USD',scope:'account'}]}]});await h.tick();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/77% left/);assert.match(p.textContent,/12.34 USD/);}finally{h.cleanup();}
});
test('Cached values never cross gateway boundaries',async()=>{
 const h=await setup({providers:[{slug:'private-provider',name:'Previous gateway provider',authenticated:true}]});
 try{const button=document.querySelector('[data-quota-trigger]');button.click();await h.tick();button.click();globalThis.__quotaSDK.host.activeConnectionId=()=> 'different-gateway';globalThis.__quotaSDK.queryClient.fetchQuery=()=>new Promise(()=>{});button.click();assert.doesNotMatch(document.querySelector('[data-quota-popover]').textContent,/Previous gateway provider/);}finally{h.cleanup();}
});
test('Quota-only snapshot avoids heavyweight model-picker and billing RPCs',async()=>{
 const h=await setup(new Error('Legacy model picker must not run'),new Error('Legacy agy must not run'),new Error('Legacy credits must not run'),new Error('Legacy billing must not run'));
 const apiCalls=[];h.dom.window.hermesDesktop={api:async args=>{apiCalls.push(args);return {version:2,providers:[{slug:'openai-codex',name:'Codex',authenticated:true,usage:{windows:[{label:'Session',used_percent:23,resets_at:'2099-01-01T00:00:00Z'}]}},{slug:'nous',name:'Nous Portal',authenticated:true,billing:{usage:{available:true,total_spendable_display:'$20.75',subscription_remaining_display:'$20.75',topup_remaining_display:'$0.00'}}}],credits:{providers:[{slug:'venice',name:'Venice',status:'ok',balances:[{label:'Credits',remaining:12.34,currency:'USD',scope:'account'}]}]},antigravity:null};}};
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/77% left/);assert.match(p.textContent,/\$20.75/);assert.match(p.textContent,/12.34 USD/);assert.equal(apiCalls.length,1);assert.equal(apiCalls[0].path,'/api/plugins/quota-fast/snapshot');assert.equal(h.calls.length,0);assert.equal(p.querySelector('.quota-action').disabled,false);}finally{h.cleanup();}
});
test('A gateway without the fast endpoint retains working legacy quota',async()=>{
 const h=await setup({providers:[{slug:'openai-codex',name:'Codex',authenticated:true,usage:{windows:[{label:'Session',used_percent:23,resets_at:'2099-01-01T00:00:00Z'}]}}]});
 h.dom.window.hermesDesktop={api:async()=>{throw new Error('Unavailable fast namespace')}};
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/77% left/);assert.doesNotMatch(p.textContent,/Unavailable fast namespace/);assert.equal(p.dataset.quotaSource,'legacy');}finally{h.cleanup();}
});
test('Delayed quota snapshot cannot overwrite a different gateway',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve});const h=await setup({providers:[]});let connection='first';globalThis.__quotaSDK.host.activeConnectionId=()=>connection;
 h.dom.window.hermesDesktop={api:args=>args.connectionId==='first'?pending:Promise.resolve({version:2,providers:[{slug:'second',name:'Second gateway',authenticated:true}],credits:{providers:[]}})};
 try{const b=document.querySelector('[data-quota-trigger]');b.click();await h.tick();b.click();connection='second';b.click();await h.tick();release({version:2,providers:[{slug:'first',name:'First gateway',authenticated:true}],credits:{providers:[]}});await h.tick();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/Second gateway/);assert.doesNotMatch(p.textContent,/First gateway/);}finally{h.cleanup();}
});
test('Fast snapshot preserves configured providers and spend without inventing Antigravity',async()=>{
 const h=await setup(new Error('Legacy must not run'));
 h.dom.window.hermesDesktop={api:async()=>({version:2,providers:[{slug:'openrouter',name:'OpenRouter',authenticated:false,status:'configured',reasonCode:'credential_missing',profiles:['default']},{slug:'anthropic',name:'Anthropic',authenticated:true}],credits:{providers:[],spend:[{slug:'anthropic',name:'Anthropic',status:'ok',source:'provider',coverage:'account',amount:12.34,currency:'USD',periodStart:'2099-01-01T00:00:00Z',periodEnd:'2099-01-15T00:00:00Z'}]},antigravity:{status:'unavailable',windows:[]}})};
 try{document.querySelector('[data-quota-trigger]').click();await h.tick();const p=document.querySelector('[data-quota-popover]');assert.match(p.textContent,/OpenRouter/);assert.match(p.textContent,/API key unavailable/);assert.match(p.textContent,/12.34 USD/);assert.match(p.textContent,/Provider-reported/);assert.doesNotMatch(p.textContent,/Antigravity/);assert.equal(h.calls.length,0);}finally{h.cleanup();}
});
async function setup(payload, antigravity = null, credits = null, billing = null) {
  const dom = new JSDOM('<body><aside data-tour="sessions-sidebar"><ul><li><button><span data-tour="sidebar-nav-new-session">New session</span></button></li></ul></aside></body>', {url:'https://hermes.local'});
  for (const key of ['window','document','MutationObserver','HTMLElement']) globalThis[key] = dom.window[key];
  globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = clearTimeout;
  const disposers=[], timers=new Set(), calls=[];
  const atom={get:()=> 'default',subscribe:()=>()=>{}};
  globalThis.__quotaSDK={host:{state:{profile:atom,gateway:atom},activeConnectionId:()=>null,request:async(method,params)=>{calls.push({method,params});const response=method==='billing.state'?billing:payload;if(response instanceof Error)throw response;return response;}},queryClient:{fetchQuery:async o=>o.queryFn()},PALETTE_AREA:'palette'};
  const ctx={rest:async path=>{calls.push({method:'REST',params:path});const result=path==='/credits'?credits:antigravity;if(result instanceof Error)throw result;return result;},register:()=>()=>{},onDispose:fn=>disposers.push(fn),addEventListener:(target,type,fn,opts)=>{target.addEventListener(type,fn,opts);disposers.push(()=>target.removeEventListener(type,fn,opts));},setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);timers.add(t);return ()=>clearTimeout(t);}};
  let source; try {source=await readFile(path,'utf8')} catch {assert.fail('Quota plugin has not been implemented');}
  source=source.replace(/import\s*\{[^}]+\}\s*from\s*['"]@hermes\/plugin-sdk['"];?/, 'const {host,queryClient,PALETTE_AREA}=globalThis.__quotaSDK;');
  const {default:plugin}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64')+'#'+Math.random());
  plugin.register(ctx);
  const tick=()=>new Promise(r=>setTimeout(r,20)); await tick();
  return {dom,calls,tick,cleanup(){for(const t of timers)clearTimeout(t);for(const fn of disposers.reverse())fn();dom.window.close();}};
}
test('sidebar button opens quota popover with remaining usage, not spent usage',async()=>{
  const h=await setup({providers:[{slug:'openai-codex',name:'OpenAI Codex',authenticated:true,auth_type:'oauth',usage:{windows:[{label:'5 hour',used_percent:23,resets_at:'2099-01-01T00:00:00Z'}]}}]});
  try {
    const b=document.querySelector('[data-quota-trigger]');assert.ok(b,'sidebar trigger exists');b.click();await h.tick();
    const panel=document.querySelector('[data-quota-popover]');assert.ok(panel);assert.match(panel.textContent,/77% left/);assert.match(panel.textContent,/5 hour/);assert.match(panel.textContent,/Resets/);
    assert.equal(h.calls[0].method,'model.options');assert.equal(h.calls[0].params.refresh,false);
    document.dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(document.querySelector('[data-quota-popover]'),null);
  } finally {h.cleanup();}
});
