import { host, queryClient, PALETTE_AREA } from '@hermes/plugin-sdk';

// Desktop SDK sidebar.nav is route-only. A lifecycle-owned DOM row avoids
// navigating away from the chat just to show a small, anchored popover.
export default {
  id: 'quota',
  name: 'Quota',
  register(ctx) {
    let panel = null, anchor = null, disposed = false, sequence = 0, followup = null;
    const rows = new Set();
    const scope = () => `${host.activeConnectionId?.() || 'local'}:${host.state.profile.get() || 'default'}`;
    const el = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const icons = {
      refresh:'M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3A7 7 0 0 0 18 17',
      clock:'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
      info:'M12 11v5m0-8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
      warning:'M12 9v4m0 3h.01M12 3 2.5 20h19L12 3Z',
      stop:'M8 12h8M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    };
    function icon(name) {
      const ns='http://www.w3.org/2000/svg';
      const svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');
      for (const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'})) svg.setAttribute(key,value);
      svg.classList.add('quota-icon');path.setAttribute('d',icons[name]);svg.append(path);return svg;
    }
    function note(container,text,warning=false) {
      let details=container.querySelector(':scope > .quota-details');
      if (!details) {
        details=el('details','quota-details');
        const summary=el('summary','quota-action');
        details.append(summary,el('div','quota-details-body'));container.append(details);
      }
      if (warning) details.dataset.warning='';
      const label=details.hasAttribute('data-warning') ? 'Warnings and details' : 'Details';
      const owner=container.dataset.quotaDetailOwner;
      const summary=details.firstElementChild;
      summary.setAttribute('aria-label',owner ? `${label}: ${owner}` : label);
      summary.title=summary.getAttribute('aria-label');
      summary.replaceChildren(icon(details.hasAttribute('data-warning') ? 'warning' : 'info'));
      details.lastElementChild.append(el('div','quota-note',text));
    }
    function statusIcon(name,label,state) {
      const mark=el('span','quota-status-icon');mark.dataset.quotaState=state;
      mark.title=label;mark.setAttribute('role','img');mark.setAttribute('aria-label',label);mark.append(icon(name));return mark;
    }
    const style = el('style');
    style.textContent = `
      [data-quota-trigger]{display:flex;align-items:center;gap:8px;width:100%;height:28px;padding:0 8px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--ui-text-secondary);font:inherit;font-size:13px;font-weight:500;text-align:left;cursor:pointer;-webkit-app-region:no-drag}
      [data-quota-trigger]:hover,[data-quota-trigger][aria-expanded="true"]{background:var(--ui-control-hover-background);color:var(--foreground)}
      [data-quota-trigger]:focus-visible,.quota-action:focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}
      /* Use the same elevated surface as native popovers, opaque so the chat
         behind this dense readout cannot reduce text or gauge contrast. */
      [data-quota-popover]{position:fixed;z-index:1000;box-sizing:border-box;width:310px;max-width:calc(100vw - 16px);max-height:calc(100vh - 24px);overflow:auto;padding:14px;border:1px solid var(--ui-stroke-primary,var(--ui-stroke-secondary));border-radius:8px;background:var(--ui-bg-elevated,var(--ui-surface-background,var(--ui-sidebar-surface-background)));color:var(--ui-text-primary);font-family:inherit;font-size:12px;line-height:1.5;-webkit-app-region:no-drag}
      .quota-line{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
      .quota-title{font-size:13px;font-weight:600}.quota-muted{color:var(--ui-text-secondary)}
      .quota-action{border:0;background:transparent;color:var(--ui-text-secondary);font:inherit;font-size:11px;padding:2px 4px;cursor:pointer;border-radius:4px}
      .quota-action:hover{background:var(--ui-control-hover-background);color:var(--ui-text-primary)}
      .quota-provider{padding-top:11px;margin-top:11px;border-top:1px solid var(--ui-stroke-secondary)}
      .quota-provider-name{font-weight:600;font-size:12px}.quota-account{margin-top:10px}.quota-account+.quota-account{padding-top:10px;border-top:1px solid var(--ui-stroke-secondary)}.quota-window{margin-top:7px}.quota-number{color:var(--ui-text-primary);font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}.quota-bar{height:4px;margin-top:5px;background:var(--ui-bg-secondary,var(--ui-stroke-secondary));overflow:hidden;border-radius:2px}.quota-fill{height:100%;background:var(--ui-text-primary);border-radius:2px}.quota-reset{font-size:11px;margin-top:3px;color:var(--ui-text-secondary)}.quota-note{margin-top:9px;font-size:11px;color:var(--ui-text-secondary)}
      .quota-icon{width:14px;height:14px;flex:none;vertical-align:middle}
      .quota-header,.quota-provider,.quota-account{position:relative}
      .quota-header-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .quota-header:has(>.quota-details) .quota-header-row{padding-right:26px}
      .quota-provider:has(>.quota-details)>.quota-provider-name,.quota-account:has(>.quota-details)>.quota-muted{padding-right:28px}
      .quota-action:has(svg),[data-quota-refresh]{display:inline-grid;place-items:center;width:24px;height:24px;padding:0}
      .quota-details>summary{position:absolute;right:0;top:0;list-style:none}
      .quota-details>summary::-webkit-details-marker{display:none}
      .quota-provider>.quota-details>summary{top:8px}
      .quota-account+.quota-account>.quota-details>summary{top:7px}
      .quota-details[open]>summary{color:var(--ui-text-primary);background:var(--ui-control-hover-background)}
      .quota-details-body{margin-top:7px;border-left:1px solid var(--ui-stroke-secondary);padding:1px 0 1px 8px;overflow-wrap:anywhere}
      .quota-details-body .quota-note{margin:3px 0}
      .quota-note{overflow-wrap:anywhere}
      .quota-status-icon,.quota-reset{display:inline-flex;align-items:center;gap:4px;color:var(--ui-text-secondary)}
      .quota-reset .quota-icon{width:12px;height:12px}
      .quota-reset{margin-top:0;white-space:nowrap}
      .quota-window-meta{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;margin-top:4px}
      .quota-window-meta .quota-bar{margin-top:0}
      .quota-loading{width:11px;height:11px;border:1.5px solid currentColor;border-right-color:transparent;border-radius:50%;animation:quota-turn .85s linear infinite}
      @keyframes quota-turn{to{transform:rotate(360deg)}}
      @media(prefers-reduced-motion:reduce){.quota-loading{animation:none}}
      .quota-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
      .quota-placeholder{display:grid;gap:9px;margin-top:12px;padding:10px 0;border-top:1px solid var(--ui-stroke-secondary)}
      .quota-placeholder span{display:block;width:65%;height:5px;background:var(--ui-stroke-secondary);border-radius:2px}
      .quota-placeholder span+span{width:100%}
    `;
    document.head.append(style);

    function close(restore = false) {
      sequence++;
      followup?.(); followup = null;
      panel?.remove(); panel = null;
      for (const row of rows) row.querySelector('button')?.setAttribute('aria-expanded', 'false');
      if (restore && anchor?.isConnected) anchor.focus();
      anchor = null;
    }
    function position() {
      if (!panel || !anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = panel.getBoundingClientRect().width || 310;
      const height = panel.getBoundingClientRect().height || 100;
      const right = rect.right + 10;
      const left = right + width < window.innerWidth - 8 ? right : Math.max(8, rect.left - width - 10);
      panel.style.left = `${Math.min(left, Math.max(8, window.innerWidth - width - 8))}px`;
      panel.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - height - 12))}px`;
    }
    function resetLabel(value) {
      const date = new Date(value);
      if (!value || !Number.isFinite(date.getTime())) return null;
      if (date.getTime() <= Date.now()) return 'Reset due · refresh to update';
      return `Resets ${date.toLocaleString(undefined, {weekday:'short',hour:'numeric',minute:'2-digit'})}`;
    }
    function addWindows(container, windows) {
      let count = 0;
      for (const w of windows || []) {
        const direct = typeof w.remainingPercent === 'number' && Number.isFinite(w.remainingPercent) && w.remainingPercent >= 0 && w.remainingPercent <= 100;
        if (!direct && (typeof w.used_percent !== 'number' || !Number.isFinite(w.used_percent))) continue;
        // Expired windows are not a promise that the allowance has refilled.
        const expired = w.resets_at && Number.isFinite(Date.parse(w.resets_at)) && Date.parse(w.resets_at) <= Date.now();
        const remaining = direct ? w.remainingPercent : Math.round(Math.max(0, Math.min(100, 100 - w.used_percent)));
        const wrap = el('div', 'quota-window');
        const line = el('div', 'quota-line');
        line.append(el('span', 'quota-muted', `${w.label || 'Usage'}${w.scope === 'model' ? ' · model limit' : ''}`), el('span', 'quota-number', expired ? 'Update needed' : `${remaining}% left`));
        wrap.append(line);
        if (!expired) {
          const bar = el('div', 'quota-bar');
          bar.setAttribute('role', 'meter'); bar.setAttribute('aria-label', `${w.label || 'Usage'} remaining`);
          bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(remaining));
          const fill = el('div','quota-fill');fill.style.width = `${remaining}%`;bar.append(fill);wrap.append(bar);
        }
        const reset = resetLabel(w.resets_at);
        if (reset && !expired) {
          const meta=el('div','quota-window-meta'),stamp=el('time','quota-reset');
          stamp.dataset.quotaReset='';stamp.dateTime=w.resets_at;stamp.title=reset;
          stamp.append(icon('clock'),el('span','quota-sr','Resets '),el('span',null,reset.slice(7)));
          meta.append(wrap.lastElementChild,stamp);wrap.append(meta);
        }
        container.append(wrap); count++;
      }
      return count;
    }
    function drawAntigravity(result) {
      if (!panel || !result) return;
      const block=providerSection('Antigravity','antigravity');
      if (result.status !== 'ok' || !Array.isArray(result.windows)) {
        note(block,'Quota unavailable · check the gateway quota backend',true);panel.append(block);return;
      }
      const pools=new Map();
      for (const w of result.windows) {
        const parsedReset=w.resetAt==null ? null : typeof w.resetAt==='string' ? Date.parse(w.resetAt) : NaN;
        if (typeof w.pool !== 'string' || !w.pool.trim() || typeof w.window !== 'string' || typeof w.remainingPercent !== 'number' || !Number.isFinite(w.remainingPercent) || w.remainingPercent<0 || w.remainingPercent>100 || (parsedReset!==null && !Number.isFinite(parsedReset))) continue;
        // agy emits the Unix epoch (1970-01-01T00:00:00Z) when a pool's rolling window has not started yet.
        const resetAt=parsedReset===null || parsedReset===0 ? null : w.resetAt;
        if (!pools.has(w.pool)) pools.set(w.pool,[]);
        pools.get(w.pool).push({...w,resetAt});
      }
      if (!pools.size) note(block,'No valid quota windows returned by the gateway',true);
      for (const [name,windows] of pools) {
        const group=el('div','quota-account');group.dataset.quotaPool=name;
        const heading=el('div','quota-line');heading.append(el('span','quota-provider-name',name));
        if (windows.some(w=>w.remainingPercent===0 && (w.resetAt===null || Date.parse(w.resetAt)>Date.now()))) heading.append(statusIcon('stop','Exhausted','exhausted'));
        group.append(heading);
        addWindows(group,windows.map(w=>({label:w.window,remainingPercent:w.remainingPercent,resets_at:w.resetAt})));
        block.append(group);
      }
      const checked=new Date(result.fetchedAt);
      if (result.fetchedAt && Number.isFinite(checked.getTime())) note(block,`Gateway checked ${checked.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}`);
      panel.append(block);
    }
    function addCredits(container, record, quiet = false) {
      if (!record) return;
      const bots=Array.isArray(record.profiles) ? [...new Set(record.profiles.filter(p=>typeof p==='string' && p))] : [];
      if (bots.length) note(container,`Bots: ${bots.join(', ')}`);
      let count=0;
      for (const balance of Array.isArray(record.balances) ? record.balances : []) {
        if (typeof balance.remaining !== 'number' || !Number.isFinite(balance.remaining) || !/^(?:[A-Z]{3}|DIEM)$/.test(balance.currency || '') || !['account','key'].includes(balance.scope)) continue;
        const row=el('div','quota-line quota-window');row.dataset.quotaBalance='';
        const label=balance.scope==='key' ? 'API key budget' : balance.label || 'Account balance';
        row.append(el('span','quota-muted',`${balance.accountLabel ? `${balance.accountLabel} · ` : ''}${label}`),el('span','quota-number',`${new Intl.NumberFormat(undefined,{minimumFractionDigits:2,maximumFractionDigits:6}).format(balance.remaining)} ${balance.currency}`));
        container.append(row);count++;
      }
      const messages={permission_required:'Account balance requires provider billing permission',unsupported:'No balance API available for this provider',fetch_failed:'Balance temporarily unavailable',not_reported:'Balance not reported by this provider'};
      const reason=record.messageCode || (record.status==='unsupported' ? 'unsupported' : record.status==='ok' ? 'not_reported' : 'fetch_failed');
      if (!quiet && (!count || record.status!=='ok' || record.messageCode)) note(container,messages[reason] || messages.fetch_failed,true);
    }
    function addSpend(container, records, balances, hasNousBilling) {
      if (!records?.length) return 0;
      const validAmount=b=>typeof b.remaining==='number' && Number.isFinite(b.remaining) && b.scope==='account';
      const walletCurrencies=new Set(balances.filter(validAmount).map(b=>b.currency));
      if (hasNousBilling) walletCurrencies.add('USD');
      const chosen=new Map();
      for (const s of records) {
        if (s.status!=='ok' || !['provider','hermes_estimate'].includes(s.source) || typeof s.amount!=='number' || !Number.isFinite(s.amount) || !/^[A-Z]{3}$/.test(s.currency || '') || !Number.isFinite(Date.parse(s.periodStart)) || !Number.isFinite(Date.parse(s.periodEnd)) || Date.parse(s.periodEnd)<Date.parse(s.periodStart) || walletCurrencies.has(s.currency)) continue;
        const prior=chosen.get(s.currency);
        if (!prior || s.source==='provider' && prior.source!=='provider') chosen.set(s.currency,s);
      }
      for (const s of chosen.values()) {
        const start=new Date(s.periodStart),now=new Date();
        const month=start.toLocaleDateString(undefined,{month:'short',year:'numeric',timeZone:'UTC'});
        const current=start.getUTCFullYear()===now.getUTCFullYear() && start.getUTCMonth()===now.getUTCMonth();
        const title=s.source==='provider' ? current ? 'Spent this month' : `Spent · ${month}` : `Est. spend · ${month}`;
        const row=el('div','quota-line quota-window');row.dataset.quotaSpend=s.source;
        row.append(el('span','quota-muted',title),el('span','quota-number',`${new Intl.NumberFormat(undefined,{minimumFractionDigits:2,maximumFractionDigits:6}).format(s.amount)} ${s.currency}`));container.append(row);
        note(container,s.source==='provider' ? `Provider-reported · ${month} (UTC)` : `Hermes-recorded estimate · ${month} (UTC) · Hermes activity only; excludes other apps`);
        if (typeof s.coverageNote==='string' && s.coverageNote.trim() && s.coverageNote.length<=300) note(container,s.coverageNote,true);
        if (s.source==='provider' && s.coverage==='workspace') note(container,'Workspace report · not an account-wide total',true);
        if (Array.isArray(s.exclusions) && s.exclusions.includes('priority_tier_excluded')) note(container,'Provider report excludes Priority Tier costs',true);
        if (Number.isInteger(s.missingCostCount) && s.missingCostCount>0) note(container,`Partial estimate · ${s.missingCostCount} records have no cost`,true);
        if (typeof s.asOf==='string' && Number.isFinite(Date.parse(s.asOf))) note(container,`As of ${new Date(s.asOf).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`);
      }
      const setup={anthropic_admin_required:'Provider totals require Anthropic billing access',anthropic_cost_permission:'Provider totals require Anthropic billing access',google_billing_query_opt_in:'Google billing queries require explicit opt-in and a bytes budget',google_billing_export_required:'Provider totals require Google billing export setup',permission_required:'Provider totals require billing permission',billing_access_required:'Provider totals require billing access'};
      const notes=new Set(records.flatMap(s=>Array.isArray(s.setupRequired)?s.setupRequired:[]).map(c=>setup[c]).filter(Boolean));
      for (const message of notes) note(container,message,true);
      if (!chosen.size && !walletCurrencies.size) note(container,'Dollar spend unavailable · billing access or Hermes cost records required',true);
      return chosen.size || notes.size || (walletCurrencies.size ? 0 : 1);
    }
    function addNousBilling(container, billing) {
      let count=0;
      const add=(label,value)=>{
        if (typeof value!=='string' || !value.trim() || value==='—' || value.length>80) return;
        const row=el('div','quota-line quota-window');row.dataset.quotaBalance='';row.dataset.quotaNousBilling='';
        row.append(el('span','quota-muted',label),el('span','quota-number',value));container.append(row);count++;
      };
      const u=billing.usage;
      if (u?.available) {
        add('Available credits',u.total_spendable_display);
        add('Included credits',u.subscription_remaining_display);
        add('Purchased credits',u.topup_remaining_display);
      }
      if (!count && (typeof billing.balance_usd==='number' || typeof billing.balance_usd==='string' && /^-?\d+(?:\.\d+)?$/.test(billing.balance_usd)) && Number.isFinite(Number(billing.balance_usd))) add('Credit balance',`${new Intl.NumberFormat(undefined,{minimumFractionDigits:2,maximumFractionDigits:6}).format(Number(billing.balance_usd))} USD`);
      return count;
    }
    const providerKey = p => p.slug === 'venice-ai' ? 'venice' : p.slug;
    function providerSection(name,key) {
      const block=el('section','quota-provider');
      block.dataset.quotaDetailOwner=name;block.dataset.quotaDetailKey=key;
      block.append(el('div','quota-provider-name',name));return block;
    }
    function header(updating, retry=false) {
      const root=el('div','quota-header');root.dataset.quotaDetailOwner='gateway';root.dataset.quotaDetailKey='gateway';
      const heading=el('div','quota-header-row');
      heading.append(el('span','quota-title',retry ? 'Could not load quota' : 'Quota & balances'));
      const action=el('button','quota-action');action.type='button';action.disabled=updating;action.dataset.quotaRefresh='';
      action.title=updating ? 'Checking provider data' : retry ? 'Retry' : 'Refresh quota';
      action.setAttribute('aria-label',action.title);
      if (updating) {
        const spinner=el('span','quota-loading');spinner.setAttribute('aria-hidden','true');action.append(spinner,el('span','quota-sr','Checking provider data'));
      } else action.append(icon('refresh'),el('span','quota-sr',action.title));
      action.addEventListener('click',()=>load(true));heading.append(action);root.append(heading);return root;
    }
    function showLoading() {
      const placeholder=el('div','quota-placeholder');placeholder.setAttribute('aria-hidden','true');placeholder.append(el('span'),el('span'));
      panel.setAttribute('aria-busy','true');panel.replaceChildren(header(true),placeholder);
    }
    function detailKey(details) {
      return details.parentElement?.dataset.quotaDetailKey;
    }
    function finishDetails(openKeys,focusedKey,wasRefresh) {
      for (const details of panel.querySelectorAll('.quota-details')) {
        // Keep the disclosure next to its heading, with the revealed text below its values.
        const key=detailKey(details);
        details.parentElement.append(details);
        if (openKeys.has(key)) details.open=true;
        if (focusedKey && key===focusedKey) details.firstElementChild.focus({preventScroll:true});
      }
      const refresh=panel.querySelector('[data-quota-refresh]');
      if (wasRefresh && !refresh?.disabled) refresh?.focus({preventScroll:true});
    }
    function draw(payload, updating = false) {
      if (!panel) return;
      const openKeys=new Set([...panel.querySelectorAll('.quota-details[open]')].map(detailKey));
      const previousFocus=document.activeElement;
      const focusedKey=panel.contains(previousFocus) && previousFocus?.tagName==='SUMMARY' ? detailKey(previousFocus.parentElement) : null;
      const wasRefresh=panel.contains(previousFocus) && previousFocus?.hasAttribute('data-quota-refresh');
      panel.replaceChildren();panel.dataset.quotaSource=payload?.version===2 ? 'snapshot-v2' : 'legacy';
      panel.setAttribute('aria-busy',String(updating));
      const gateway=header(updating);panel.append(gateway);
      const providers = (payload?.providers || []).filter(p => (p.authenticated !== false || p.configured) && !['local','virtual'].includes(p.auth_type));
      const creditRows=(Array.isArray(payload.credits?.providers) ? payload.credits.providers : []).filter(r=>typeof r.slug==='string' && r.slug && !((!Array.isArray(r.profiles) || !r.profiles.length) && payload.providers.some(p=>providerKey(p)===providerKey(r) && p.authenticated===false)));
      const allBots=creditRows.some(r=>Array.isArray(r.profiles)) || providers.some(p=>Array.isArray(p.profiles));
      note(gateway,`${host.activeConnectionId?.() || 'local'} · ${allBots ? 'all bots · ' : ''}profile: ${host.state.profile.get() || 'default'}`);
      const creditsBySlug=new Map();
      for (const r of creditRows) {if (!creditsBySlug.has(providerKey(r))) creditsBySlug.set(providerKey(r),[]);creditsBySlug.get(providerKey(r)).push(r);}
      const shownCredits=new Set();
      if (!updating && !providers.length && !payload.antigravity && !creditRows.length) panel.append(el('div','quota-note','No connected providers found.'));
      for (const p of providers) {
        if (payload.antigravity && /antigravity/i.test(`${p.slug} ${p.name}`)) continue;
        const block=providerSection(p.name || p.slug,`provider:${providerKey(p)}`);
        const billingRows=p.billing ? addNousBilling(block,p.billing) : 0;
        const credits=creditsBySlug.get(providerKey(p));
        if (credits) {
          credits.forEach((record,i)=>{
            if (credits.length===1) {addCredits(block,record,!!p.spend?.length);return;}
            const account=el('div','quota-account');
            const label=record.name || `API account ${i+1}`;
            account.dataset.quotaDetailOwner=label;account.dataset.quotaDetailKey=`${block.dataset.quotaDetailKey}:key:${i}`;
            account.append(el('div','quota-muted',label));
            addCredits(account,record,!!p.spend?.length);block.append(account);
          });
          shownCredits.add(providerKey(p));
        }
        if (!credits && Array.isArray(p.profiles) && p.profiles.length) note(block,`Bots: ${p.profiles.join(', ')}`);
        const spendRows=addSpend(block,p.spend,(credits || []).flatMap(r=>Array.isArray(r.balances)?r.balances:[]),!!billingRows);
        const accounts = p.usage?.accounts;
        if (p.plan_usage?.plan || p.billing?.usage?.plan_name) block.append(el('div','quota-muted',p.plan_usage?.plan || p.billing.usage.plan_name));
        if (Array.isArray(p.plan_usage?.gauges) && p.plan_usage.gauges.length) {
          const windows = p.plan_usage.gauges.filter(g => typeof g.left_fraction === 'number' && Number.isFinite(g.left_fraction)).map(g => ({label:g.title || g.label,used_percent:100*(1-g.left_fraction),resets_at:typeof g.resets_at_ms === 'number' && Number.isFinite(g.resets_at_ms) && Math.abs(g.resets_at_ms) < 8640000000000000 ? new Date(g.resets_at_ms).toISOString() : null,scope:g.scope === 'top_tier' ? 'model' : 'account'}));
          if (!addWindows(block,windows)) note(block,'Usage not available from this provider',true);
          if (p.plan_usage.paused_reason) note(block,p.plan_usage.paused_reason,true);
        } else if (Array.isArray(accounts) && accounts.length) {
          accounts.forEach((a,i)=>{
            const account=el('div','quota-account'),label=a.label || `Account ${i+1}`;
            account.dataset.quotaDetailOwner=label;account.dataset.quotaDetailKey=`${block.dataset.quotaDetailKey}:usage:${i}`;
            account.append(el('div','quota-muted',label));
            const known = a.state !== 'unknown' && a.state !== 'unavailable';
            if (!known || !addWindows(account,a.windows)) note(account,a.state === 'unavailable' ? 'Sign-in unavailable' : 'Usage not available',true);
            if (a.state === 'limited') note(account,resetLabel(a.resets_at) || 'Currently limited · reset time unavailable',true);
            block.append(account);
          });
        } else if (!addWindows(block,p.usage?.windows) && !credits && !billingRows && !spendRows) {
          const reason={credential_missing:'Configured · sign-in or API key unavailable',credentials_unavailable:'Configured · sign-in or API key unavailable',permission_required:'Usage requires provider billing permission',fetch_failed:'Provider usage fetch failed · retry later'};
          note(block,reason[p.reasonCode] || 'Usage not available from this provider',true);
        }
        panel.append(block);
      }
      creditRows.forEach((r,i)=>{
        if (shownCredits.has(providerKey(r))) return;
        const block=providerSection(r.name || r.slug,`credits:${providerKey(r)}:${i}`);addCredits(block,r);panel.append(block);
      });
      drawAntigravity(payload.antigravity);
      if (!payload.credits && !payload.creditsPending) note(gateway,'API-key balances unavailable · check the gateway quota backend',true);
      const checked=new Date(payload.credits?.fetchedAt);
      if (payload.credits?.fetchedAt && Number.isFinite(checked.getTime())) note(gateway,`Balances checked ${checked.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}`);
      if (payload.inventoryUnavailable) note(gateway,'Other provider quota unavailable · check the gateway connection',true);
      if (payload.refreshFailed) note(gateway,'Some sources could not refresh · showing last known values',true);
      if (updating && payload.usingCached) note(gateway,'Showing cached data while checking for updates');
      finishDetails(openKeys,focusedKey,wasRefresh);
      position();
    }
    let lastPayload = null;
    const snapshots=new Map();
    async function load(schedule = true) {
      if (!panel) return;
      const run = ++sequence, key = scope();
      const saved=snapshots.get(key);
      const cached=saved && Date.now()-saved.savedAt<120000 ? saved : null;
      lastPayload=cached?.data || null;
      if (lastPayload) draw({...lastPayload,usingCached:true},true);
      else showLoading();
      position();
      try {
        // A quota-only endpoint avoids model-catalog discovery and full payment
        // settings on every click. Pin the native authenticated transport to the
        // selected gateway/profile; older gateways retain the legacy fallback.
        if (typeof window.hermesDesktop?.api==='function') {
          try {
            const connectionId=host.activeConnectionId?.() || 'local';
            const profile=host.state.profile.get() || 'default';
            const snapshot=await queryClient.fetchQuery({queryKey:['quota-snapshot-v2',key],staleTime:30000,gcTime:120000,retry:false,queryFn:()=>window.hermesDesktop.api({connectionId,profile,method:'GET',path:'/api/plugins/quota-fast/snapshot',timeoutMs:15000})});
            if (disposed || !panel || run!==sequence || scope()!==key) return;
            if (snapshot?.version===2 && Array.isArray(snapshot.providers) && Array.isArray(snapshot.credits?.providers)) {
              const roster=new Map(snapshot.providers.map(p=>[providerKey(p),{...p,configured:true}]));
              for (const s of Array.isArray(snapshot.credits.spend) ? snapshot.credits.spend : []) {
                if (!s || typeof s.slug!=='string' || !s.slug) continue;
                const previous=roster.get(providerKey(s)) || {slug:s.slug,name:s.name || s.slug,configured:true};
                roster.set(providerKey(s),{...previous,spend:[...(previous.spend || []),s]});
              }
              const hasAgy=snapshot.providers.some(p=>/antigravity/i.test(`${p.slug} ${p.name}`));
              const antigravity=!hasAgy && snapshot.antigravity?.status==='unavailable' ? null : snapshot.antigravity;
              const data={...snapshot,providers:[...roster.values()],antigravity,inventoryUnavailable:false,creditsPending:false};
              lastPayload=data;
              const results=[{status:'fulfilled',value:{providers:data.providers}},{status:'fulfilled',value:data.antigravity},{status:'fulfilled',value:data.credits},{status:'fulfilled',value:null}];
              snapshots.delete(key);snapshots.set(key,{data,results,savedAt:Date.now()});
              while (snapshots.size>8) snapshots.delete(snapshots.keys().next().value);
              draw(data);return;
            }
          } catch { /* Unsupported gateway: keep the established read paths. */ }
          if (disposed || !panel || run!==sequence || scope()!==key) return;
        }
        // ctx.rest is scoped to THIS plugin on the connected gateway. No local
        // CLI execution or credential handling occurs in the Desktop renderer.
        const results=cached ? cached.results.map(r=>({...r})) : Array.from({length:4},()=>({status:'pending'}));
        let remaining=4;
        const requests=[
          queryClient.fetchQuery({queryKey:['quota',key],staleTime:0,gcTime:120000,retry:false,queryFn:()=>host.request('model.options',{explicit_only:true,include_unconfigured:false,refresh:false})}),
          queryClient.fetchQuery({queryKey:['quota-antigravity',key],staleTime:60000,gcTime:120000,retry:false,queryFn:()=>ctx.rest('/antigravity',{timeoutMs:25000})}),
          queryClient.fetchQuery({queryKey:['quota-credits',key],staleTime:60000,gcTime:120000,retry:false,queryFn:()=>ctx.rest('/credits',{timeoutMs:20000})}),
          queryClient.fetchQuery({queryKey:['quota-nous-billing',key],staleTime:30000,gcTime:120000,retry:false,queryFn:async()=>{
            // Same read-only source as Settings → Billing. Strip payment/card
            // and organization identity fields before caching anything.
            const b=await host.request('billing.state',{});
            if (!b || b.ok===false || !b.logged_in || b.free_tier_account) return null;
            const u=b.usage;
            return {balance_usd:b.balance_usd,plan_usage:b.plan_usage,usage:u ? {available:u.available,plan_name:u.plan_name,renews_at:u.renews_at,total_spendable_display:u.total_spendable_display,subscription_remaining_display:u.subscription_remaining_display,topup_remaining_display:u.topup_remaining_display,plan_bar:u.plan_bar ? {pct_used:u.plan_bar.pct_used} : null} : null};
          }})
        ];
        const publish=()=>{
        const [inventory, agy, creditResult, billingResult]=results;
        const base=inventory.status==='fulfilled' && Array.isArray(inventory.value?.providers) ? inventory.value : null;
        let antigravity=agy.status==='fulfilled' ? agy.value : null;
        const hasAgy=base?.providers.some(p=>/antigravity/i.test(`${p.slug} ${p.name}`));
        if (!antigravity && hasAgy) antigravity={status:'error',windows:[]};
        if (base && !hasAgy && antigravity?.status==='unavailable') antigravity=null;
        const credits=creditResult.status==='fulfilled' && Array.isArray(creditResult.value?.providers) ? creditResult.value : null;
        const extraInventory=Array.isArray(credits?.inventory) ? credits.inventory : [];
        const billing=billingResult.status==='fulfilled' ? billingResult.value : null;
        if (!base && antigravity?.status!=='ok' && !credits?.providers.length && !extraInventory.length && !credits?.spend?.length && !billing) {if (remaining) return;throw new Error('Quota unavailable');}
        // The roster is independent of billing support: a failed/unsupported
        // balance endpoint must never erase a configured provider or bot.
        const roster=new Map((base?.providers || []).map(p=>[providerKey(p),p]));
        for (const p of extraInventory) {
          if (!p || typeof p.slug!=='string' || !p.slug) continue;
          const previous=roster.get(providerKey(p)) || {};
          roster.set(providerKey(p),{...previous,...p,configured:true,authenticated:previous.authenticated===true || p.authenticated===true,profiles:[...new Set([...(previous.profiles || []),...(p.profiles || [])])],usage:p.usage || previous.usage,plan_usage:p.plan_usage || previous.plan_usage});
        }
        for (const s of Array.isArray(credits?.spend) ? credits.spend : []) {
          if (!s || typeof s.slug!=='string' || !s.slug) continue;
          const previous=roster.get(providerKey(s)) || {slug:s.slug,name:s.name || s.slug,configured:true};
          roster.set(providerKey(s),{...previous,configured:true,profiles:[...new Set([...(previous.profiles || []),...(Array.isArray(s.profiles)?s.profiles:[])])],spend:[...(previous.spend || []),s]});
        }
        if (billing) {
          const previous=roster.get('nous') || {slug:'nous',name:'Nous Portal'};
          const u=billing.usage;
          const pct=u?.plan_bar?.pct_used;
          const usage=typeof pct==='number' && Number.isFinite(pct) && pct>=0 && pct<=100 ? {windows:[{label:'Subscription',used_percent:pct,resets_at:u.renews_at,scope:'account'}]} : previous.usage;
          roster.set('nous',{...previous,authenticated:true,billing,plan_usage:billing.plan_usage || previous.plan_usage,usage});
        }
        const data={...(base || {}),providers:[...roster.values()],antigravity,credits,usingCached:!!cached && remaining>0,refreshFailed:results.some(r=>r.refreshFailed),creditsPending:creditResult.status==='pending',inventoryUnavailable:inventory.status==='rejected'};
        if (disposed || !panel || run !== sequence || scope() !== key) return;
        if (!Array.isArray(data?.providers)) throw new Error('Invalid provider inventory');
        lastPayload=data;
        snapshots.delete(key);snapshots.set(key,{data,results:results.map(r=>({...r})),savedAt:Date.now()});
        while (snapshots.size>8) snapshots.delete(snapshots.keys().next().value);
        draw(data,remaining>0);
        };
        await Promise.allSettled(requests.map((request,index)=>Promise.resolve(request).then(value=>{
          results[index]={status:'fulfilled',value};remaining--;publish();
        },()=>{results[index]=results[index].status==='fulfilled' ? {...results[index],refreshFailed:true} : {status:'rejected'};remaining--;publish();})));
        publish();
        // Inventory triggers asynchronous server-side quota refresh. Read once
        // more after it warms; no background polling when the popover is closed.
        if (disposed || !panel || run !== sequence || scope() !== key) return;
        followup?.();followup=null;
        if (schedule) followup=ctx.setTimeout(()=>{followup=null;load(false);},3500);
      } catch {
        if (!panel || run !== sequence || scope() !== key) return;
        panel.setAttribute('aria-busy','false');
        const gateway=header(false,true);note(gateway,'Check the gateway connection, then retry.',true);
        panel.replaceChildren(gateway);position();
      }
    }
    function open(button) {
      if (panel && anchor === button) {close();return;}
      close();anchor=button;
      panel=el('div');panel.dataset.quotaPopover='';panel.id='hermes-quota-popover';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Quota & balances');panel.tabIndex=-1;
      document.body.append(panel);button?.setAttribute('aria-expanded','true');load(true);panel.focus({preventScroll:true});
    }
    function mount() {
      if (disposed) return;
      for (const row of rows) if (!row.isConnected) rows.delete(row);
      for (const sidebar of document.querySelectorAll('[data-tour="sessions-sidebar"]')) {
        const menu=sidebar.querySelector('[data-tour^="sidebar-nav-"]')?.closest('ul');
        if (!menu || menu.querySelector('[data-quota-trigger]')) continue;
        const row=el('li');row.dataset.quotaRow='';
        const button=el('button');button.type='button';button.dataset.quotaTrigger='';button.setAttribute('aria-label','Quota');button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','hermes-quota-popover');
        const icon=el('span','codicon codicon-dashboard');icon.setAttribute('aria-hidden','true');icon.style.fontSize='16px';
        button.append(icon,el('span',null,'Quota'));button.addEventListener('click',()=>open(button));row.append(button);menu.append(row);rows.add(row);
      }
      if (anchor && !anchor.isConnected) close();
    }
    const observer=new MutationObserver(mount);observer.observe(document.body,{subtree:true,childList:true});mount();
    ctx.addEventListener(document,'pointerdown',e=>{if(panel && !panel.contains(e.target) && !anchor?.contains(e.target)) close();},true);
    ctx.addEventListener(document,'keydown',e=>{
      if(!panel)return;
      if(e.key === 'Escape'){e.preventDefault();close(true);}
      if(e.key === 'Tab') {
        const controls=[...panel.querySelectorAll('button:not(:disabled), details > summary')];
        if(!controls.length){e.preventDefault();panel.focus();return;}
        const index=controls.indexOf(document.activeElement);
        if(e.shiftKey && index<=0){e.preventDefault();controls.at(-1).focus();}
        else if(!e.shiftKey && (index===-1 || index===controls.length-1)){e.preventDefault();controls[0].focus();}
      }
    });
    ctx.addEventListener(window,'resize',position);
    ctx.addEventListener(document,'scroll',position,true);
    const unsub=host.state.profile.subscribe(()=>{close();lastPayload=null;});
    const unsubGateway=host.state.gateway.subscribe(()=>{close();lastPayload=null;});
    ctx.register({id:'show',area:PALETTE_AREA,data:{id:'quota-show',label:'Show quota and balances',keywords:['usage','limits','subscription','credit','balance','budget'],run:()=>{const button=document.querySelector('[data-quota-trigger]');if(button)open(button);}}});
    ctx.onDispose(()=>{disposed=true;observer.disconnect();close();unsub?.();unsubGateway?.();for(const row of rows)row.remove();rows.clear();style.remove();snapshots.clear();});
  }
};
