# Quota

A Hermes Desktop plugin that shows provider quotas and balances in a sidebar popup.

## Install

Copy `plugin.js` into `$HERMES_HOME/desktop-plugins/quota/` (default: `~/.hermes/desktop-plugins/quota/`). Desktop loads disk plugins automatically; if needed, use **⌘K → Reload desktop plugins**. Disable it in Desktop’s plugin settings.

This repository contains the Desktop frontend (`plugin.js`) and a gateway adapter for API-key credit balances (`gateway/quota/`). The built-in model and Nous billing RPCs do not require an additional adapter. Antigravity and spend still require compatible endpoints on the selected gateway; those adapters are not included. This plugin is not listed in the Hermes Marketplace.

Click **Quota** in the sidebar to open the lightweight anchored popover. Escape or clicking outside closes it. There is also a **Show quota and balances** command.

## Data

Uses the supported `model.options` gateway RPC with `explicit_only: true`, `include_unconfigured: false`, `refresh: false`. It does not read auth files or copy tokens into the renderer. Shows connected providers for the current gateway profile, separate pooled accounts, provider-reported remaining percentages, reset times, and Nous plan gauges. No quota is inferred from session token totals. Unknown or expired allowances never become a fabricated full gauge.

The gateway warms subscription usage asynchronously and throttles provider reads for approximately two minutes. The plugin rereads once after opening (3.5 seconds); it does not poll when closed. Refresh rereads the gateway cache, not force-refreshing credentials or catalogs. Providers without an exposed quota endpoint are labeled unavailable.

## Opening speed

Sources render independently as they settle: model quota, native Nous billing, API credits and Antigravity no longer wait on a global completion barrier before displaying results. A two-minute, bounded in-memory snapshot cache is keyed by connection and profile; reopening paints its last known values synchronously while refreshing. Late values merge into the visible roster. Refresh failures keep prior successful values with an explicit warning. Pending sources are not labeled as failed.

No provider timeouts were shortened to hide information, and no closed-popup polling was added. This improves time to useful display, not the response time of an upstream provider. Slow first-time balances can still arrive later. The change is frontend-only and uses Desktop's existing hot reload, without a gateway restart.

`tests/quota-performance-test.mjs` exercises real Chromium with deliberately delayed 11-second fixture responses and checks first useful quota before those responses finish, synchronous cached reopening, and eventual merging. Its evidence is a browser fixture, not measured live-provider network performance.

## Antigravity on a connected gateway

Desktop calls `ctx.rest('/antigravity')`, i.e. the authenticated `/api/plugins/quota/antigravity` endpoint on the **selected gateway**, not an executable on the Desktop machine. A compatible gateway adapter can run the official `agy -p=/quota` command using the gateway’s existing login. The Desktop plugin does not read Google OAuth files or receive credentials. No LLM prompt is used.

The normalized records are `{pool, window, remainingPercent, resetAt}` plus response status and fetch timestamp. Percentages already mean **remaining**. The UI groups by the exact returned pool name, preserves every reported window separately, and labels a pool Exhausted when any unexpired reported window has exactly 0% remaining. It neither estimates token counts nor invents missing limits. Expired snapshots display Update needed instead of assuming a refill. Reset dates are formatted in the Desktop's local timezone. The Antigravity REST result is cached for 60 seconds; Refresh does not bypass that cache.

An Antigravity backend failure does not hide other provider quotas, and a provider-inventory failure does not hide a successful Antigravity result. No Antigravity endpoint on an unrelated gateway is required.

## API-key credit balances

The same popup fetches `ctx.rest('/credits')` on the selected gateway and displays normalized finite balances with explicit currency units. Money is not rendered as a percentage bar. USD and DIEM stay separate, as do account balances and API-key spending budgets; zero and negative reported balances are preserved. Multiple accounts can carry individual account labels.

The UI merges balance rows into matching provider sections and still works if the subscription inventory or Antigravity source fails. Billing permission requirements, unsupported provider APIs, and temporary errors receive distinct safe labels. Provider response bodies, keys and raw errors never belong in this UI. Credit results are gateway/profile-scoped and cached for 60 seconds, with their original acquisition time retained on cache hits.

Fixture tests verify rendering, not which providers are available on your gateway.

## Gateway adapter: API-key credit balances

`gateway/quota/` is the backend that serves `ctx.rest('/credits')` (mounted at `/api/plugins/quota/credits` on the selected gateway). It reports balances for every provider configured with an **API key** in the active profile — credential-pool entries with `auth_type: api_key` plus registry env-var keys. OAuth/subscription providers are out of scope here; the Desktop reads those through `model.options` and native `billing.state`.

Supported balance APIs:

| Provider | Source | Reported |
|---|---|---|
| OpenRouter | `GET /api/v1/credits` + `GET /api/v1/key` | Account balance (credits − usage, USD) and per-key spending budget when the key has a limit |
| DeepSeek | `GET /user/balance` | Account balance per reported currency (CNY/USD) |
| Venice AI | `GET /api/v1/billing/balance` | DIEM and USD balances (requires a Venice **admin** key; inference keys get a billing-permission label) |
| OpenAI API | `GET /v1/dashboard/billing/credit_grants` | Prepaid credit balance (USD); postpaid organizations report unsupported |

Other API-key providers (Gemini/Google AI Studio, Anthropic, xAI, ...) have no public balance API for plain API keys and are labeled **No balance API available for this provider** — never a fabricated zero. Keys, raw provider bodies and raw errors never leave the adapter; only finite numbers, display labels and safe message codes. Results are cached ~55s per profile home with the original acquisition time retained. `/antigravity` reports `unavailable` unless a separate Antigravity adapter is installed.

Install on the gateway machine:

```sh
cp -R gateway/quota ~/.hermes/plugins/quota
hermes plugins enable quota
```

The gateway hot-mounts the routes on the first request — no restart needed. Backend fixture tests (no live credentials or network):

```sh
<hermes-runtime-python> -m unittest discover -s gateway/tests -v
```

## Nous: same source as Settings → Billing

The popup calls the native, read-only `billing.state` gateway RPC used by Settings. It strips payment-method, card and organization identity fields before caching. The display uses the same server-formatted **Available credits**, **Included credits**, and **Purchased credits** as Settings, retaining reported zero purchases rather than mistaking them for zero total available credit. When only the raw balance is provided, a validated decimal balance is shown in USD. Legacy subscription percentages use `usage.plan_bar.pct_used` and renewal time; usage-window plans retain their separate `plan_usage.gauges`. The query is gateway/profile-scoped with a 30-second cache and no polling while closed. This readout does not require the custom credits backend to load.

## Dollar-spend fallback

Where account funds are available in a currency, they take precedence. Otherwise, the popup selects provider-reported spend over a Hermes-recorded estimate for that currency. Per-key spending budgets are not treated as wallet balances and do not suppress spend. Amounts carry their native currency, UTC month, source and acquisition time; spend never becomes a remaining-percentage bar.

The optional top-level `/credits` response `spend[]` contains provider aggregates, not repeated totals attached to every shared key. Estimates explicitly say **Hermes activity only; excludes other apps**, with a warning when recorded costs are incomplete. Missing/invalid amounts are unavailable, not zero. Billing-permission or export-setup requirements remain visible. Nous continues using native Settings Billing independently.

Backend provider access, cost-record coverage, and activation are separate verification gates. New code installed on an already-mounted gateway does not imply that its running handler reloaded. No new cloud billing resources or browser sessions should be configured implicitly.

## UI integration

The current `sidebar.nav` SDK contribution supports routes only, not click actions or custom renderers. This plugin therefore owns one DOM row appended to the sidebar's existing navigation menu, located through its stable `data-tour` hook. All DOM nodes, observers, timers and listeners are disposed on unload. No app source is modified. This hook may need updating if Desktop changes its sidebar structure. The DOM hook is not a supported catalog contribution; a Marketplace submission would require replacing it with a supported SDK surface.

## Verification

The default view shows provider names, quotas, resets, and monetary amounts. Info and warning icons open keyboard-accessible details for scope, ownership, freshness, and missing data. The clock icon indicates a reset time, and the refresh control becomes a spinner while fetching.

The tests use synthetic fixtures rather than live credentials or billing. Browser artifacts are saved in `.test-artifacts/`. Gateway deployment material and local audit evidence are not part of this Desktop source repository.

```sh
npm ci
npx playwright install chromium
npm test
npm run test:browser
npm run test:performance
```
