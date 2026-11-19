"""Quota gateway adapter — backend API routes mounted at /api/plugins/quota/.

Serves the Desktop ``hermes-quota`` plugin's ``ctx.rest('/credits')`` call:
normalized credit balances for every provider configured with an API key in
the active profile (credential pool entries with ``auth_type: api_key`` plus
registry env-var keys). OAuth/subscription providers are intentionally out of
scope here — the Desktop reads those through ``model.options`` and the native
``billing.state`` RPC.

Contract (consumed by the Desktop frontend):

    GET /credits -> {
      providers: [{slug, name, status, messageCode?, balances: [
          {remaining, currency, scope: "account"|"key", label?}]}],
      inventory: [{slug, name, authenticated: true}],
      spend: [],
      fetchedAt: ISO-8601
    }

Rules honored from the frontend README:
* Money is a finite number with an explicit currency (USD, CNY, EUR, DIEM...),
  never a percentage. Zero and negative balances are preserved.
* Account balances and per-key spending budgets are separate scopes.
* Keys, raw provider bodies and raw errors never leave this handler — only
  normalized numbers, display labels and safe message codes.
* Results are cached ~55s per profile home; cache hits keep the original
  ``fetchedAt`` so the UI can show acquisition time.
"""

from __future__ import annotations

import asyncio
import logging
import math
import time
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from fastapi import APIRouter

log = logging.getLogger(__name__)

router = APIRouter()

_CACHE_TTL_SECONDS = 55.0
_REQUEST_TIMEOUT_SECONDS = 8.0
_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_cache_lock = asyncio.Lock()

# Slugs the core registry may not name (plugin-provided providers).
_EXTRA_NAMES = {
    "openrouter": "OpenRouter",
    "venice": "Venice AI",
    "venice-ai": "Venice AI",
}

# Providers with a known balance API. Everything else configured with an API
# key is reported as ``unsupported`` (the UI shows a safe, distinct label).
_FETCHERS = {"openrouter", "deepseek", "venice", "venice-ai", "openai-api", "openai"}


def _provider_name(slug: str) -> str:
    try:
        from hermes_cli.auth import PROVIDER_REGISTRY

        pconfig = PROVIDER_REGISTRY.get(slug)
        if pconfig is not None and getattr(pconfig, "name", None):
            return str(pconfig.name)
    except Exception:  # registry unavailable: fall back to static names
        pass
    return _EXTRA_NAMES.get(slug, slug.replace("-", " ").title())


def _finite(value: Any) -> Optional[float]:
    """Accept JSON numbers (and numeric strings providers sometimes send)."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    elif isinstance(value, str):
        try:
            number = float(value.strip())
        except ValueError:
            return None
    else:
        return None
    return number if math.isfinite(number) else None


def _api_key_credentials() -> list[dict[str, str]]:
    """Every usable API-key credential in the active profile, without exposing
    the key material outside this module. Pool entries win; registry env vars
    cover providers whose keys live only in ``.env``."""
    from hermes_cli.auth import read_credential_pool
    from hermes_cli.config import get_env_value_prefer_dotenv

    credentials: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()

    def add(slug: str, label: str, key: str) -> None:
        key = (key or "").strip()
        if not key or (slug, key) in seen:
            return
        seen.add((slug, key))
        credentials.append({"slug": slug, "label": label or slug, "key": key})

    try:
        pool = read_credential_pool()
    except Exception:
        log.warning("quota: credential pool unreadable", exc_info=True)
        pool = {}
    for slug, entries in sorted(pool.items()):
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict) or entry.get("auth_type") != "api_key":
                continue
            key = entry.get("api_key") or entry.get("access_token") or ""
            source = str(entry.get("source") or "")
            if not key and source.startswith("env:"):
                key = get_env_value_prefer_dotenv(source[4:]) or ""
            add(slug, str(entry.get("label") or source or slug), key)

    # Registry env-var keys for providers absent from the pool.
    try:
        from hermes_cli.auth import PROVIDER_REGISTRY

        for slug, pconfig in PROVIDER_REGISTRY.items():
            if slug in {c["slug"] for c in credentials}:
                continue
            for env_var in getattr(pconfig, "api_key_env_vars", ()) or ():
                key = get_env_value_prefer_dotenv(env_var) or ""
                if key:
                    add(slug, env_var, key)
                    break
    except Exception:
        log.debug("quota: registry env scan skipped", exc_info=True)
    return credentials


class _BalanceFetchError(Exception):
    def __init__(self, message_code: str):
        super().__init__(message_code)
        self.message_code = message_code


def _classify_status(status_code: int) -> str:
    if status_code in (401, 403):
        return "permission_required"
    return "fetch_failed"


async def _get_json(client: httpx.AsyncClient, url: str, key: str) -> Any:
    response = await client.get(url, headers={"Authorization": f"Bearer {key}"})
    if response.status_code != 200:
        raise _BalanceFetchError(_classify_status(response.status_code))
    try:
        return response.json()
    except ValueError:
        raise _BalanceFetchError("fetch_failed")


async def _fetch_openrouter(client: httpx.AsyncClient, key: str) -> list[dict[str, Any]]:
    balances: list[dict[str, Any]] = []
    data = (await _get_json(client, "https://openrouter.ai/api/v1/credits", key)).get("data") or {}
    total_credits = _finite(data.get("total_credits"))
    if total_credits is None:
        raise _BalanceFetchError("fetch_failed")
    total_usage = _finite(data.get("total_usage")) or 0.0
    balances.append({"remaining": total_credits - total_usage, "currency": "USD", "scope": "account", "label": "Account balance"})
    # Per-key spending budget is a separate scope; unlimited keys report none.
    try:
        key_data = (await _get_json(client, "https://openrouter.ai/api/v1/key", key)).get("data") or {}
        limit_remaining = _finite(key_data.get("limit_remaining"))
        if limit_remaining is not None and _finite(key_data.get("limit")) is not None:
            balances.append({"remaining": limit_remaining, "currency": "USD", "scope": "key", "label": "API key budget"})
    except _BalanceFetchError:
        pass  # account balance already reported; a failed key read is not fatal
    return balances


async def _fetch_deepseek(client: httpx.AsyncClient, key: str) -> list[dict[str, Any]]:
    data = await _get_json(client, "https://api.deepseek.com/user/balance", key)
    balances: list[dict[str, Any]] = []
    for info in data.get("balance_infos") or []:
        remaining = _finite(info.get("total_balance"))
        currency = str(info.get("currency") or "").upper()
        if remaining is not None and len(currency) == 3 and currency.isalpha():
            balances.append({"remaining": remaining, "currency": currency, "scope": "account", "label": "Account balance"})
    if not balances:
        raise _BalanceFetchError("fetch_failed")
    return balances


async def _fetch_venice(client: httpx.AsyncClient, key: str) -> list[dict[str, Any]]:
    # Requires a Venice ADMIN key; inference keys 401 -> permission_required.
    data = await _get_json(client, "https://api.venice.ai/api/v1/billing/balance", key)
    raw = data.get("balances") or {}
    balances: list[dict[str, Any]] = []
    diem = _finite(raw.get("diem"))
    if diem is not None:
        balances.append({"remaining": diem, "currency": "DIEM", "scope": "account", "label": "DIEM balance"})
    usd = _finite(raw.get("usd"))
    if usd is not None:
        balances.append({"remaining": usd, "currency": "USD", "scope": "account", "label": "USD balance"})
    if not balances:
        raise _BalanceFetchError("fetch_failed")
    return balances


async def _fetch_openai(client: httpx.AsyncClient, key: str) -> list[dict[str, Any]]:
    # Legacy credit-grants endpoint: still served for prepaid accounts, 404 on
    # postpaid organizations (their spend needs the admin-key Costs API).
    try:
        data = await _get_json(client, "https://api.openai.com/v1/dashboard/billing/credit_grants", key)
    except _BalanceFetchError as exc:
        if exc.message_code == "fetch_failed":
            raise _BalanceFetchError("unsupported")
        raise
    granted = _finite(data.get("total_granted"))
    used = _finite(data.get("total_used")) or 0.0
    if granted is None:
        raise _BalanceFetchError("unsupported")
    return [{"remaining": granted - used, "currency": "USD", "scope": "account", "label": "Account balance"}]


_FETCH_IMPL = {
    "openrouter": _fetch_openrouter,
    "deepseek": _fetch_deepseek,
    "venice": _fetch_venice,
    "venice-ai": _fetch_venice,
    "openai-api": _fetch_openai,
    "openai": _fetch_openai,
}


async def _fetch_record(client: httpx.AsyncClient, credential: dict[str, str]) -> dict[str, Any]:
    slug = credential["slug"]
    record: dict[str, Any] = {"slug": slug, "name": _provider_name(slug), "balances": []}
    fetch = _FETCH_IMPL.get(slug)
    if fetch is None:
        record.update(status="unsupported", messageCode="unsupported")
        return record
    try:
        record["balances"] = await fetch(client, credential["key"])
        record["status"] = "ok"
    except _BalanceFetchError as exc:
        record.update(status="error", messageCode=exc.message_code)
    except (httpx.HTTPError, asyncio.TimeoutError):
        record.update(status="error", messageCode="fetch_failed")
    except Exception:
        # Never leak provider bodies or internal errors into the UI payload.
        log.warning("quota: balance fetch failed for %s", slug, exc_info=True)
        record.update(status="error", messageCode="fetch_failed")
    return record


async def _build_payload() -> dict[str, Any]:
    credentials = await asyncio.to_thread(_api_key_credentials)
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        records = await asyncio.gather(*(_fetch_record(client, c) for c in credentials))
    # One record per credential; the Desktop groups them under the provider
    # and labels each account when a provider has several keys.
    for record, credential in zip(records, credentials):
        if len([r for r in records if r["slug"] == record["slug"]]) > 1:
            record["name"] = credential["label"]
    inventory = [
        {"slug": slug, "name": _provider_name(slug), "authenticated": True}
        for slug in sorted({r["slug"] for r in records})
    ]
    # OAuth session limits (Anthropic/Claude): the core's read-only quota path
    # never refreshes an expired OAuth token, so a stale access token silently
    # hides the session gauges. Refresh through the credential pool's own
    # locked, persisted rotation and report the windows as inventory usage.
    anthropic = await asyncio.to_thread(_anthropic_usage_inventory)
    if anthropic is not None:
        inventory.append(anthropic)
    return {
        "providers": list(records),
        "inventory": inventory,
        "spend": [],
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
    }


def _usage_wire_windows(snapshot: Any) -> list[dict[str, Any]]:
    windows: list[dict[str, Any]] = []
    for w in getattr(snapshot, "windows", ()) or ():
        if w.used_percent is None:
            continue
        windows.append({
            "label": w.label,
            "used_percent": float(w.used_percent),
            "resets_at": w.reset_at.isoformat() if w.reset_at else None,
            "scope": w.scope,
        })
    return windows


def _anthropic_usage_from(entries: list[Any], refresh: Any, fetch: Any, is_expiring: Any) -> Optional[dict[str, Any]]:
    """Pure core of the Anthropic usage read: ``refresh(entry)`` must be the
    pool's own persisted rotation (single-use refresh tokens), ``fetch(token)``
    the usage snapshot. Injectable for fixture tests."""
    accounts: list[dict[str, Any]] = []
    for entry in entries:
        if getattr(entry, "auth_type", None) != "oauth":
            continue
        token = (getattr(entry, "access_token", None) or "").strip()
        if not token:
            continue
        try:
            if is_expiring(entry):
                refreshed = refresh(entry)
                if refreshed is None:
                    continue
                entry = refreshed
                token = (getattr(entry, "access_token", None) or "").strip()
                if not token:
                    continue
            snapshot = fetch(token)
        except Exception:
            log.warning("quota: Anthropic usage read failed", exc_info=True)
            continue
        windows = _usage_wire_windows(snapshot) if snapshot is not None else []
        if windows:
            accounts.append({"label": getattr(entry, "label", None) or "Claude account", "state": "ok", "windows": windows})
    if not accounts:
        return None
    inventory: dict[str, Any] = {"slug": "anthropic", "name": _provider_name("anthropic"), "authenticated": True}
    if len(accounts) == 1:
        inventory["usage"] = {"windows": accounts[0]["windows"]}
    else:
        inventory["usage"] = {"accounts": accounts}
    return inventory


def _anthropic_usage_inventory() -> Optional[dict[str, Any]]:
    try:
        from agent.credential_pool import load_pool
        from agent.credential_pool_plugin import plugin_row_is_expiring
        from agent.account_usage import fetch_account_usage
    except Exception:
        return None
    try:
        pool = load_pool("anthropic")
        entries, _pending = pool._available_entries(clear_expired=False, refresh=False)
    except Exception:
        log.debug("quota: anthropic pool unreadable", exc_info=True)
        return None

    def refresh(entry: Any) -> Any:
        # Public, locked, force-refresh of exactly this entry; commits the
        # rotated token pair so no single-use grant is spent uncommitted.
        return pool.try_refresh_matching(credential_id=entry.id)

    def fetch(token: str) -> Any:
        return fetch_account_usage("anthropic", **{"api_key": token})
    return _anthropic_usage_from(entries, refresh, fetch, plugin_row_is_expiring)


@router.get("/credits")
async def credits() -> dict[str, Any]:
    try:
        from hermes_constants import get_hermes_home

        home = str(get_hermes_home())
    except Exception:
        home = "default"
    async with _cache_lock:
        cached = _cache.get(home)
        if cached and time.monotonic() - cached[0] < _CACHE_TTL_SECONDS:
            return cached[1]
        payload = await _build_payload()
        _cache[home] = (time.monotonic(), payload)
        return payload


@router.get("/antigravity")
async def antigravity() -> dict[str, Any]:
    # Antigravity quota is served by a separate gateway adapter (official agy
    # CLI). This adapter does not read Google OAuth files; report unavailable
    # so the Desktop hides the section instead of showing an error.
    return {"status": "unavailable", "windows": []}


@router.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "service": "quota"}
