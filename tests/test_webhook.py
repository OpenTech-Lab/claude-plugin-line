import asyncio
import base64
import hashlib
import hmac
import json
import logging

import httpx
import pytest
from linebot.v3 import WebhookParser

import line_claude_bridge as bridge
from test_tenant_persona import _FakeDB

SECRET = "test-secret"


@pytest.fixture(autouse=True)
def webhook_env(monkeypatch):
    """Signed-webhook setup; records _handle_text calls and loading animations."""
    monkeypatch.setattr(bridge, "_seen_event_ids", {})
    monkeypatch.setattr(bridge, "_background_tasks", set())
    monkeypatch.setattr(bridge, "parser", WebhookParser(SECRET))

    async def fake_get_pg_pool(app):
        return None

    monkeypatch.setattr(bridge, "_get_pg_pool", fake_get_pg_pool)

    loading = []
    monkeypatch.setattr(bridge, "_show_loading", lambda user_id: loading.append(user_id))

    handled = []

    async def fake_handle_text(user_id, tenant_id, text, reply_token, pg_pool, **kwargs):
        handled.append({"user_id": user_id, "tenant_id": tenant_id, "text": text, **kwargs})

    monkeypatch.setattr(bridge, "_handle_text", fake_handle_text)
    return {"handled": handled, "loading": loading}


def _event(event_id, *, text="hello", source=None, mode="active", redelivery=False):
    return {
        "type": "message",
        "mode": mode,
        "timestamp": 1700000000000,
        "source": source or {"type": "user", "userId": "Uuser"},
        "webhookEventId": event_id,
        "deliveryContext": {"isRedelivery": redelivery},
        "replyToken": "reply-token",
        "message": {"type": "text", "id": "m1", "text": text, "quoteToken": "q"},
    }


async def _post(*events):
    body = json.dumps({"destination": "Ubot", "events": list(events)})
    signature = base64.b64encode(
        hmac.new(SECRET.encode(), body.encode(), hashlib.sha256).digest()
    ).decode()
    transport = httpx.ASGITransport(app=bridge.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.post(
            "/webhook",
            content=body,
            headers={"X-Line-Signature": signature, "Content-Type": "application/json"},
        )


async def _drain():
    while bridge._background_tasks:
        await asyncio.gather(*list(bridge._background_tasks), return_exceptions=True)
    await asyncio.sleep(0)  # let done callbacks run


@pytest.mark.asyncio
async def test_webhook_acks_before_message_handling_finishes(monkeypatch):
    release = asyncio.Event()
    finished = []

    async def slow_handle_text(*args, **kwargs):
        await release.wait()
        finished.append(True)

    monkeypatch.setattr(bridge, "_handle_text", slow_handle_text)

    resp = await asyncio.wait_for(_post(_event("e1")), timeout=2)

    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
    assert finished == []
    assert len(bridge._background_tasks) == 1

    release.set()
    await _drain()
    assert finished == [True]
    assert bridge._background_tasks == set()


@pytest.mark.asyncio
async def test_redelivered_event_with_same_id_is_handled_once(webhook_env):
    await _post(_event("e1"))
    await _post(_event("e1", redelivery=True))
    await _drain()

    assert len(webhook_env["handled"]) == 1


@pytest.mark.asyncio
async def test_redelivery_with_unseen_id_is_processed(webhook_env):
    # e.g. the bridge restarted after LINE's first delivery attempt.
    await _post(_event("e-new", redelivery=True))
    await _drain()

    assert len(webhook_env["handled"]) == 1


@pytest.mark.asyncio
async def test_standby_event_is_skipped(webhook_env):
    await _post(_event("e1", mode="standby"))
    await _drain()

    assert webhook_env["handled"] == []
    assert "e1" not in bridge._seen_event_ids


@pytest.mark.asyncio
async def test_failing_event_task_is_logged_and_released(monkeypatch, caplog):
    async def broken_handle_text(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(bridge, "_handle_text", broken_handle_text)

    with caplog.at_level(logging.ERROR, logger=bridge.logger.name):
        resp = await _post(_event("e1"))
        await _drain()

    assert resp.status_code == 200
    assert bridge._background_tasks == set()
    failures = [r for r in caplog.records if "event task failed" in r.getMessage()]
    assert len(failures) == 1
    assert failures[0].exc_info is not None


@pytest.mark.asyncio
async def test_group_mention_is_stripped_and_flagged(webhook_env):
    event = _event(
        "e1",
        text="@Bot what's up",
        source={"type": "group", "groupId": "Cgroup", "userId": "Uuser"},
    )
    event["message"]["mention"] = {
        "mentionees": [
            {"type": "user", "index": 0, "length": 4, "userId": "Ubot", "isSelf": True}
        ]
    }
    await _post(event)
    await _drain()

    assert webhook_env["handled"] == [
        {
            "user_id": "Uuser",
            "tenant_id": "Cgroup",
            "text": "what's up",
            "is_group": True,
            "mentioned": True,
        }
    ]


@pytest.mark.asyncio
async def test_invalid_signature_is_rejected(webhook_env):
    transport = httpx.ASGITransport(app=bridge.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/webhook",
            content=json.dumps({"destination": "Ubot", "events": [_event("e1")]}),
            headers={"X-Line-Signature": "bad"},
        )

    assert resp.status_code == 400
    assert webhook_env["handled"] == []


# ---------- join / follow ----------

@pytest.fixture
def membership_env(monkeypatch):
    """Point the webhook at an in-memory tenant DB; record replies."""
    monkeypatch.setattr(bridge, "_tenant_config_cache", {})
    db = _FakeDB()

    async def fake_get_pg_pool(app):
        return db

    monkeypatch.setattr(bridge, "_get_pg_pool", fake_get_pg_pool)
    sent = []
    monkeypatch.setattr(bridge, "_send_reply", lambda token, text: sent.append((token, text)))
    return db, sent


GROUP_SOURCE = {"type": "group", "groupId": "Cgroup"}
USER_SOURCE = {"type": "user", "userId": "Unew"}


def _membership_event(event_type, event_id, source):
    event = {
        "type": event_type,
        "mode": "active",
        "timestamp": 1700000000000,
        "source": source,
        "webhookEventId": event_id,
        "deliveryContext": {"isRedelivery": False},
    }
    if event_type in ("join", "follow"):
        event["replyToken"] = f"tok-{event_id}"
    if event_type == "follow":
        event["follow"] = {"isUnblocked": False}
    return event


@pytest.mark.asyncio
async def test_join_unknown_group_is_queued_and_notified(membership_env):
    db, sent = membership_env

    await _post(_membership_event("join", "j1", GROUP_SOURCE))
    await _drain()

    assert db.pending == {"Cgroup": {"type": "group", "status": "pending"}}
    assert sent == [("tok-j1", bridge.PENDING_APPROVAL_MESSAGE)]


@pytest.mark.asyncio
async def test_join_approved_group_does_nothing(membership_env):
    db, sent = membership_env
    db.tenants["Cgroup"] = {"is_active": True, "system_prompt": None, "reply_mode": "mention"}

    await _post(_membership_event("join", "j1", GROUP_SOURCE))
    await _drain()

    assert db.pending == {}
    assert sent == []


@pytest.mark.asyncio
async def test_follow_from_unknown_user_is_queued_and_notified(membership_env):
    db, sent = membership_env

    await _post(_membership_event("follow", "f1", USER_SOURCE))
    await _drain()

    assert db.pending == {"Unew": {"type": "user", "status": "pending"}}
    assert sent == [("tok-f1", bridge.PENDING_APPROVAL_MESSAGE)]


@pytest.mark.asyncio
async def test_duplicate_join_event_is_handled_once(membership_env, monkeypatch):
    db, sent = membership_env
    queued = []
    real_queue_pending = bridge._queue_pending

    async def counting_queue_pending(pool, tenant_id):
        queued.append(tenant_id)
        return await real_queue_pending(pool, tenant_id)

    monkeypatch.setattr(bridge, "_queue_pending", counting_queue_pending)

    await _post(_membership_event("join", "j1", GROUP_SOURCE))
    await _post(_membership_event("join", "j1", GROUP_SOURCE))
    await _drain()

    assert queued == ["Cgroup"]
    assert sent == [("tok-j1", bridge.PENDING_APPROVAL_MESSAGE)]


@pytest.mark.parametrize(
    "event_type, source", [("leave", GROUP_SOURCE), ("unfollow", USER_SOURCE)]
)
@pytest.mark.asyncio
async def test_leave_and_unfollow_are_ignored(membership_env, event_type, source):
    db, sent = membership_env

    await _post(_membership_event(event_type, "x1", source))
    await _drain()

    assert db.pending == {}
    assert sent == []
    assert "x1" not in bridge._seen_event_ids
