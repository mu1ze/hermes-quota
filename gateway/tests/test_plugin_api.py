"""Fixture tests for the Quota gateway adapter (no live credentials/network).

Run with the Hermes runtime interpreter, e.g.:
    <hermes-venv>/bin/python -m unittest discover -s gateway/tests -v
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
import unittest
from pathlib import Path

import httpx

_API_PATH = Path(__file__).resolve().parents[1] / "quota" / "dashboard" / "plugin_api.py"
_spec = importlib.util.spec_from_file_location("quota_plugin_api", _API_PATH)
assert _spec is not None and _spec.loader is not None
api = importlib.util.module_from_spec(_spec)
sys.modules["quota_plugin_api"] = api
_spec.loader.exec_module(api)


def run(coro):
    return asyncio.run(coro)


def client_for(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def fetch(slug: str, handler, key: str = "sk-test-123"):
    async def go():
        async with client_for(handler) as client:
            return await api._fetch_record(client, {"slug": slug, "label": "test", "key": key})
    return run(go())


class OpenRouterTests(unittest.TestCase):
    def test_account_and_key_budget(self):
        def handler(request):
            if request.url.path == "/api/v1/credits":
                return httpx.Response(200, json={"data": {"total_credits": 25.0, "total_usage": 4.25}})
            if request.url.path == "/api/v1/key":
                return httpx.Response(200, json={"data": {"limit": 10.0, "limit_remaining": 7.5, "usage": 2.5}})
            raise AssertionError(request.url)
        record = fetch("openrouter", handler)
        self.assertEqual(record["status"], "ok")
        self.assertEqual(record["balances"][0], {"remaining": 20.75, "currency": "USD", "scope": "account", "label": "Account balance"})
        self.assertEqual(record["balances"][1], {"remaining": 7.5, "currency": "USD", "scope": "key", "label": "API key budget"})

    def test_unlimited_key_has_no_budget_row(self):
        def handler(request):
            if request.url.path == "/api/v1/credits":
                return httpx.Response(200, json={"data": {"total_credits": 5.0, "total_usage": 0.0}})
            return httpx.Response(200, json={"data": {"limit": None, "limit_remaining": None}})
        record = fetch("openrouter", handler)
        self.assertEqual(len(record["balances"]), 1)
        self.assertEqual(record["balances"][0]["remaining"], 5.0)

    def test_zero_balance_preserved(self):
        def handler(request):
            if request.url.path == "/api/v1/credits":
                return httpx.Response(200, json={"data": {"total_credits": 5.0, "total_usage": 5.0}})
            return httpx.Response(200, json={"data": {"limit": None}})
        record = fetch("openrouter", handler)
        self.assertEqual(record["balances"][0]["remaining"], 0.0)

    def test_key_read_failure_keeps_account_balance(self):
        def handler(request):
            if request.url.path == "/api/v1/credits":
                return httpx.Response(200, json={"data": {"total_credits": 3.0, "total_usage": 1.0}})
            return httpx.Response(500)
        record = fetch("openrouter", handler)
        self.assertEqual(record["status"], "ok")
        self.assertEqual(len(record["balances"]), 1)

    def test_auth_failure_is_permission_required(self):
        record = fetch("openrouter", lambda request: httpx.Response(401, json={"error": {"message": "bad key sk-test-123"}}))
        self.assertEqual(record["status"], "error")
        self.assertEqual(record["messageCode"], "permission_required")
        self.assertNotIn("sk-test-123", json.dumps(record))

    def test_malformed_body_is_fetch_failed(self):
        record = fetch("openrouter", lambda request: httpx.Response(200, json={"data": {"total_credits": "lots"}}))
        self.assertEqual(record["messageCode"], "fetch_failed")


class DeepSeekTests(unittest.TestCase):
    def test_multi_currency(self):
        def handler(request):
            self.assertEqual(request.url.path, "/user/balance")
            return httpx.Response(200, json={"is_available": True, "balance_infos": [
                {"currency": "CNY", "total_balance": "110.00"},
                {"currency": "USD", "total_balance": "0.00"},
            ]})
        record = fetch("deepseek", handler)
        self.assertEqual(record["status"], "ok")
        self.assertEqual([(b["currency"], b["remaining"]) for b in record["balances"]], [("CNY", 110.0), ("USD", 0.0)])

    def test_negative_balance_preserved(self):
        def handler(request):
            return httpx.Response(200, json={"balance_infos": [{"currency": "USD", "total_balance": -1.5}]})
        record = fetch("deepseek", handler)
        self.assertEqual(record["balances"][0]["remaining"], -1.5)


class VeniceTests(unittest.TestCase):
    def test_diem_and_usd(self):
        def handler(request):
            self.assertEqual(request.url.path, "/api/v1/billing/balance")
            return httpx.Response(200, json={"canConsume": True, "consumptionCurrency": "DIEM",
                                             "balances": {"diem": 90.5, "usd": 25}, "diemEpochAllocation": 100})
        record = fetch("venice", handler)
        self.assertEqual([(b["currency"], b["remaining"]) for b in record["balances"]], [("DIEM", 90.5), ("USD", 25.0)])

    def test_inference_key_401_is_permission_required(self):
        record = fetch("venice-ai", lambda request: httpx.Response(401))
        self.assertEqual(record["messageCode"], "permission_required")

    def test_null_diem_not_reported(self):
        def handler(request):
            return httpx.Response(200, json={"balances": {"diem": None, "usd": 10}})
        record = fetch("venice", handler)
        self.assertEqual([(b["currency"], b["remaining"]) for b in record["balances"]], [("USD", 10.0)])


class OpenAITests(unittest.TestCase):
    def test_credit_grants(self):
        def handler(request):
            return httpx.Response(200, json={"total_granted": 18.0, "total_used": 3.0})
        record = fetch("openai-api", handler)
        self.assertEqual(record["balances"][0], {"remaining": 15.0, "currency": "USD", "scope": "account", "label": "Account balance"})

    def test_postpaid_404_is_unsupported(self):
        record = fetch("openai-api", lambda request: httpx.Response(404))
        self.assertEqual(record["messageCode"], "unsupported")

    def test_admin_only_403_is_permission_required(self):
        record = fetch("openai-api", lambda request: httpx.Response(403))
        self.assertEqual(record["messageCode"], "permission_required")


class UnsupportedTests(unittest.TestCase):
    def test_gemini_makes_no_network_call(self):
        def handler(request):
            raise AssertionError("unsupported provider must not hit the network")
        record = fetch("gemini", handler)
        self.assertEqual(record["status"], "unsupported")
        self.assertEqual(record["messageCode"], "unsupported")
        self.assertEqual(record["balances"], [])

    def test_anthropic_unsupported(self):
        record = fetch("anthropic", lambda request: httpx.Response(200))
        self.assertEqual(record["status"], "unsupported")


class AnthropicUsageTests(unittest.TestCase):
    @staticmethod
    def entry(auth_type="oauth", token="sk-ant-oat01-old", label="claude-1", entry_id="e1"):
        from types import SimpleNamespace
        return SimpleNamespace(id=entry_id, auth_type=auth_type, access_token=token, label=label)

    @staticmethod
    def snapshot():
        from datetime import datetime, timezone
        from types import SimpleNamespace
        return SimpleNamespace(windows=[
            SimpleNamespace(label="Current session", used_percent=42.0,
                            reset_at=datetime(2026, 1, 1, 5, 0, tzinfo=timezone.utc), scope="account"),
            SimpleNamespace(label="Current week", used_percent=10.0, reset_at=None, scope="account"),
            SimpleNamespace(label="Unknown", used_percent=None, reset_at=None, scope="account"),
        ])

    def test_expired_token_refreshed_before_fetch(self):
        seen = {}
        refreshed = self.entry(token="sk-ant-oat01-new")
        def refresh(entry):
            seen["refreshed"] = entry.id
            return refreshed
        def fetch(token):
            seen["fetched_with"] = token
            return self.snapshot()
        inv = api._anthropic_usage_from([self.entry()], refresh, fetch, lambda e: True)
        self.assertEqual(seen, {"refreshed": "e1", "fetched_with": "sk-ant-oat01-new"})
        self.assertEqual(inv["slug"], "anthropic")
        self.assertTrue(inv["authenticated"])
        windows = inv["usage"]["windows"]
        self.assertEqual(len(windows), 2, "windows without a percent are dropped")
        self.assertEqual(windows[0], {"label": "Current session", "used_percent": 42.0,
                                      "resets_at": "2026-01-01T05:00:00+00:00", "scope": "account"})
        self.assertIsNone(windows[1]["resets_at"])

    def test_fresh_token_not_refreshed(self):
        def refresh(entry):
            raise AssertionError("fresh token must not consume a rotation")
        inv = api._anthropic_usage_from([self.entry()], refresh, lambda t: self.snapshot(), lambda e: False)
        self.assertIn("windows", inv["usage"])

    def test_failed_refresh_reports_nothing(self):
        inv = api._anthropic_usage_from([self.entry()], lambda e: None, lambda t: self.snapshot(), lambda e: True)
        self.assertIsNone(inv)

    def test_api_key_entries_skipped(self):
        inv = api._anthropic_usage_from([self.entry(auth_type="api_key", token="sk-ant-api03-x")],
                                        lambda e: e, lambda t: self.snapshot(), lambda e: False)
        self.assertIsNone(inv)

    def test_fetch_failure_reports_nothing(self):
        def fetch(token):
            raise RuntimeError("401")
        self.assertIsNone(api._anthropic_usage_from([self.entry()], lambda e: e, fetch, lambda e: False))
        self.assertIsNone(api._anthropic_usage_from([self.entry()], lambda e: e, lambda t: None, lambda e: False))

    def test_multiple_accounts_use_accounts_shape(self):
        entries = [self.entry(entry_id="e1", label="claude-1"), self.entry(entry_id="e2", label="claude-2")]
        inv = api._anthropic_usage_from(entries, lambda e: e, lambda t: self.snapshot(), lambda e: False)
        accounts = inv["usage"]["accounts"]
        self.assertEqual([a["label"] for a in accounts], ["claude-1", "claude-2"])
        self.assertTrue(all(a["state"] == "ok" and a["windows"] for a in accounts))
        self.assertNotIn("windows", inv["usage"])


class AntigravityTests(unittest.TestCase):
    LIVE_FIXTURE = (
        "Gemini Models\tWeekly Limit Remaining\t97%\t2026-11-26T18:26:10Z\n"
        "Gemini Models\tFive Hour Limit Remaining\t91%\t2026-11-19T23:26:10Z\n"
        "Claude and GPT models\tWeekly Limit Remaining\t99%\t2026-11-26T18:58:59Z\n"
        "Claude and GPT models\tFive Hour Limit Remaining\t98%\t2026-11-19T23:58:59Z\n"
        "Gemini 4 Argon\tGemini 4 Argon Weekly Limit\t100%\t2026-11-26T19:16:43Z\n"
    )

    def test_parses_live_fixture(self):
        windows = api._parse_agy_usage(self.LIVE_FIXTURE)
        self.assertEqual(len(windows), 5)
        self.assertEqual(windows[0], {"pool": "Gemini Models", "window": "Weekly Limit Remaining",
                                      "remainingPercent": 97.0, "resetAt": "2026-11-26T18:26:10Z"})
        self.assertEqual(windows[4]["pool"], "Gemini 4 Argon")
        self.assertEqual(windows[4]["remainingPercent"], 100.0)

    def test_invalid_rows_dropped_not_guessed(self):
        text = (
            "Welcome to agy!\n"                                   # noise
            "Gemini Models\tWeekly\t97%\n"                        # missing reset column
            "Gemini Models\tWeekly\t101%\t2026-11-26T18:26:10Z\n"  # out of range
            "Gemini Models\tWeekly\t-5%\t2026-11-26T18:26:10Z\n"   # negative
            "Gemini Models\tWeekly\tlots%\t2026-11-26T18:26:10Z\n" # not a number
            "Gemini Models\tWeekly\t97%\tnot-a-date\n"            # bad reset
            "\tWeekly\t97%\t2026-11-26T18:26:10Z\n"               # empty pool
            "Gemini Models\t\t97%\t2026-11-26T18:26:10Z\n"        # empty window
            "Gemini Models\tWeekly\t0%\t2026-11-26T18:26:10Z\n"   # exhausted: valid
        )
        windows = api._parse_agy_usage(text)
        self.assertEqual(len(windows), 1)
        self.assertEqual(windows[0]["remainingPercent"], 0.0)

    def test_fractional_percent(self):
        windows = api._parse_agy_usage("Pool\tWindow\t97.5%\t2026-11-26T18:26:10Z")
        self.assertEqual(windows[0]["remainingPercent"], 97.5)

    def test_epoch_zero_reset_normalized_to_none(self):
        text = (
            "Claude and GPT models\tWeekly Limit Remaining\t100%\t1970-01-01T00:00:00Z\n"
            "Claude and GPT models\tFive Hour Limit Remaining\t100%\t1970-01-01T00:00:00Z\n"
        )
        windows = api._parse_agy_usage(text)
        self.assertEqual(len(windows), 2)
        self.assertEqual(windows[0]["remainingPercent"], 100.0)
        self.assertIsNone(windows[0]["resetAt"])
        self.assertIsNone(windows[1]["resetAt"])

    def test_result_shapes(self):
        ok = api._agy_result_from(0, self.LIVE_FIXTURE)
        self.assertEqual(ok["status"], "ok")
        self.assertEqual(len(ok["windows"]), 5)
        self.assertIn("fetchedAt", ok)
        self.assertEqual(api._agy_result_from(1, self.LIVE_FIXTURE)["status"], "error")
        self.assertEqual(api._agy_result_from(0, "sign in required")["status"], "error")
        self.assertEqual(api._agy_result_from(0, "")["windows"], [])

    def test_missing_binary_is_unavailable(self):
        original = api._agy_binary
        api._agy_binary = lambda: None
        try:
            self.assertEqual(api._agy_usage_sync(), {"status": "unavailable", "windows": []})
        finally:
            api._agy_binary = original


class PayloadTests(unittest.TestCase):
    def test_payload_shape_and_cache(self):
        calls = {"n": 0}

        async def fake_build():
            calls["n"] += 1
            return {"providers": [{"slug": "openrouter", "name": "OpenRouter", "status": "ok",
                                   "balances": [{"remaining": 1.0, "currency": "USD", "scope": "account"}]}],
                    "inventory": [{"slug": "openrouter", "name": "OpenRouter", "authenticated": True}],
                    "spend": [], "fetchedAt": "2026-01-01T00:00:00+00:00"}

        original_build, original_home = api._build_payload, None
        api._build_payload = fake_build
        api._cache.clear()
        try:
            first = run(api.credits())
            second = run(api.credits())
        finally:
            api._build_payload = original_build
            api._cache.clear()
        self.assertEqual(calls["n"], 1, "second call within TTL must be a cache hit")
        self.assertEqual(first["fetchedAt"], second["fetchedAt"], "cache hits keep acquisition time")
        self.assertEqual(first["providers"][0]["balances"][0]["currency"], "USD")
        self.assertTrue(all(isinstance(b["remaining"], (int, float)) for r in first["providers"] for b in r["balances"]))

    def test_multi_key_records_carry_labels(self):
        async def go():
            def handler(request):
                if request.url.path == "/api/v1/credits":
                    return httpx.Response(200, json={"data": {"total_credits": 2.0, "total_usage": 0.0}})
                return httpx.Response(200, json={"data": {"limit": None}})
            creds = [{"slug": "openrouter", "label": "KEY_A", "key": "sk-a"},
                     {"slug": "openrouter", "label": "KEY_B", "key": "sk-b"}]
            async with client_for(handler) as client:
                records = await asyncio.gather(*(api._fetch_record(client, c) for c in creds))
            for record, credential in zip(records, creds):
                if len([r for r in records if r["slug"] == record["slug"]]) > 1:
                    record["name"] = credential["label"]
            return records
        records = run(go())
        self.assertEqual([r["name"] for r in records], ["KEY_A", "KEY_B"])
        self.assertNotIn("sk-a", json.dumps(records))
        self.assertNotIn("sk-b", json.dumps(records))


if __name__ == "__main__":
    unittest.main()
