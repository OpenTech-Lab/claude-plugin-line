import pytest
from linebot.v3.messaging import ApiException
from linebot.v3.webhooks import TextMessageContent

import line_claude_bridge as bridge


APPROVED = bridge.TenantStatus.APPROVED
UNKNOWN = bridge.TenantStatus.UNKNOWN
UNAVAILABLE = bridge.TenantStatus.UNAVAILABLE


@pytest.fixture(autouse=True)
def _reset_rate_store(monkeypatch):
    monkeypatch.setattr(bridge, "_rate_store", {})
    monkeypatch.setattr(bridge, "_tenant_config_cache", {})


class _FakeConn:
    def __init__(self, row=None, raise_exc=None):
        self._row = row
        self._raise_exc = raise_exc

    async def fetchrow(self, query, *args):
        if self._raise_exc:
            raise self._raise_exc
        return self._row


class _FakePool:
    def __init__(self, row=None, raise_exc=None):
        self._conn = _FakeConn(row, raise_exc)

    def acquire(self):
        return self

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, *exc):
        return False


PIRATE_ROW = {"is_active": False, "system_prompt": "You are a pirate.", "reply_mode": "all"}


@pytest.mark.asyncio
async def test_get_tenant_config_row_means_approved_and_is_cached():
    status, config = await bridge._get_tenant_config(_FakePool(row=PIRATE_ROW), "Uabc")
    assert (status, config) == (APPROVED, PIRATE_ROW)
    assert bridge._tenant_config_cache["Uabc"] == PIRATE_ROW


@pytest.mark.asyncio
async def test_get_tenant_config_no_row_means_unknown_and_evicts_cache():
    bridge._tenant_config_cache["Uabc"] = dict(PIRATE_ROW)
    status, config = await bridge._get_tenant_config(_FakePool(row=None), "Uabc")
    assert (status, config) == (UNKNOWN, None)
    assert "Uabc" not in bridge._tenant_config_cache


@pytest.mark.parametrize(
    "pool",
    [None, _FakePool(raise_exc=RuntimeError("connection lost"))],
    ids=["pool-none", "query-error"],
)
@pytest.mark.asyncio
async def test_get_tenant_config_unavailable_uses_cached_config(pool):
    bridge._tenant_config_cache["Uabc"] = dict(PIRATE_ROW)
    status, config = await bridge._get_tenant_config(pool, "Uabc")
    assert (status, config) == (APPROVED, PIRATE_ROW)


@pytest.mark.parametrize(
    "pool",
    [None, _FakePool(raise_exc=RuntimeError("connection lost"))],
    ids=["pool-none", "query-error"],
)
@pytest.mark.asyncio
async def test_get_tenant_config_unavailable_without_cache_fails_closed(pool, caplog):
    status, config = await bridge._get_tenant_config(pool, "Uabc")
    assert (status, config) == (UNAVAILABLE, None)
    assert "tenant_lookup_unavailable tenant=Uabc" in caplog.text


# ---------- pending queue (in-memory stand-in for the tenant tables) ----------

class _FakeDBConn:
    def __init__(self, db):
        self._db = db

    async def fetchrow(self, query, *args):
        self._db.check()
        assert "FROM tenants" in query
        return self._db.tenants.get(args[0])

    async def fetchval(self, query, *args):
        self._db.check()
        assert "INSERT INTO pending_tenants" in query
        tenant_id, tenant_type = args
        if tenant_id in self._db.pending:
            return None
        self._db.pending[tenant_id] = {"type": tenant_type, "status": "pending"}
        return tenant_id

    async def execute(self, query, *args):
        self._db.check()
        self._db.executed.append(query)


class _FakeDB(_FakePool):
    """Pool over dict-backed `tenants` / `pending_tenants`; records execute()s."""

    def __init__(self, tenants=None, pending=None, raise_exc=None):
        self.tenants = dict(tenants or {})
        self.pending = dict(pending or {})
        self.executed = []
        self.raise_exc = raise_exc
        self._conn = _FakeDBConn(self)

    def check(self):
        if self.raise_exc:
            raise self.raise_exc


@pytest.mark.parametrize("tenant_id, expected_type", [("Uabc", "user"), ("Cgrp", "group"), ("Rroom", "group")])
@pytest.mark.asyncio
async def test_queue_pending_true_on_new_insert(tenant_id, expected_type):
    db = _FakeDB()
    assert await bridge._queue_pending(db, tenant_id) is True
    assert db.pending[tenant_id]["type"] == expected_type


@pytest.mark.asyncio
async def test_queue_pending_false_on_conflict():
    db = _FakeDB(pending={"Uabc": {"type": "user", "status": "denied"}})
    assert await bridge._queue_pending(db, "Uabc") is False


@pytest.mark.parametrize(
    "pool", [None, _FakeDB(raise_exc=RuntimeError("down"))], ids=["pool-none", "query-error"]
)
@pytest.mark.asyncio
async def test_queue_pending_false_when_db_unavailable(pool):
    assert await bridge._queue_pending(pool, "Uabc") is False


@pytest.mark.asyncio
async def test_log_activity_only_writes_activity_log():
    db = _FakeDB()
    await bridge._log_activity(db, "Uabc", "Uabc", "hello")
    assert len(db.executed) == 1
    assert "INSERT INTO activity_log" in db.executed[0]
    assert db.pending == {}


class _FakeProc:
    def __init__(self, stdout=b"ok", stderr=b"", returncode=0):
        self._stdout = stdout
        self._stderr = stderr
        self.returncode = returncode
        self.received_input = None

    async def communicate(self, input=None):
        self.received_input = input
        return self._stdout, self._stderr

    def kill(self):
        pass


@pytest.mark.asyncio
async def test_call_claude_code_includes_custom_system_prompt(monkeypatch):
    fake_proc = _FakeProc(stdout=b"hello back")

    async def fake_create_subprocess_exec(*args, **kwargs):
        return fake_proc

    monkeypatch.setattr(bridge.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    monkeypatch.setattr(bridge, "CLAUDE_ALLOWED_USERS", set())
    monkeypatch.setattr(bridge, "MEMORY_ENABLED", False)

    result = await bridge._call_claude_code("Uabc", "hi", "You are a pirate.")

    assert result == "hello back"
    sent_prompt = fake_proc.received_input.decode()
    assert "You are a pirate." in sent_prompt
    assert "hi" in sent_prompt


@pytest.mark.asyncio
async def test_call_claude_code_omits_empty_system_prompt(monkeypatch):
    fake_proc = _FakeProc(stdout=b"hello back")

    async def fake_create_subprocess_exec(*args, **kwargs):
        return fake_proc

    monkeypatch.setattr(bridge.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    monkeypatch.setattr(bridge, "CLAUDE_ALLOWED_USERS", set())
    monkeypatch.setattr(bridge, "MEMORY_ENABLED", False)

    await bridge._call_claude_code("Uabc", "hi", "")

    assert fake_proc.received_input.decode() == "hi"


@pytest.mark.asyncio
async def test_handle_text_inactive_tenant_sends_fixed_message(monkeypatch):
    async def fake_get_tenant_config(pool, tenant_id):
        return APPROVED, {"is_active": False, "system_prompt": None}

    monkeypatch.setattr(bridge, "_get_tenant_config", fake_get_tenant_config)

    sent = []
    monkeypatch.setattr(bridge, "_send_reply", lambda token, text: sent.append((token, text)))

    async def fail_if_called(*args, **kwargs):
        raise AssertionError("should not be called for an inactive tenant")

    monkeypatch.setattr(bridge, "_call_openrouter", fail_if_called)
    monkeypatch.setattr(bridge, "_call_claude_code", fail_if_called)

    await bridge._handle_text("Uabc", "Tabc", "hello", "reply-token", None)

    assert sent == [("reply-token", bridge.TENANT_INACTIVE_MESSAGE)]


@pytest.mark.asyncio
async def test_handle_text_uses_tenant_system_prompt(monkeypatch, tmp_path):
    db_path = str(tmp_path / "conversations.db")
    monkeypatch.setattr(bridge, "DB_PATH", db_path)
    monkeypatch.setattr(bridge, "CLAUDE_MODE", False)

    async with bridge.aiosqlite.connect(db_path) as db:
        await bridge._init_db(db)

    async def fake_get_tenant_config(pool, tenant_id):
        return APPROVED, {"is_active": True, "system_prompt": "You are a pirate."}

    monkeypatch.setattr(bridge, "_get_tenant_config", fake_get_tenant_config)

    captured = {}

    async def fake_call_openrouter(model, messages):
        captured["messages"] = messages
        return "Arrr, hello!"

    monkeypatch.setattr(bridge, "_call_openrouter", fake_call_openrouter)
    monkeypatch.setattr(bridge, "_send_reply", lambda token, text: None)

    await bridge._handle_text("Uabc", "Tabc", "hello", "reply-token", None)

    assert captured["messages"][0] == {"role": "system", "content": "You are a pirate."}


@pytest.mark.asyncio
async def test_handle_text_falls_back_to_global_system_prompt(monkeypatch, tmp_path):
    db_path = str(tmp_path / "conversations.db")
    monkeypatch.setattr(bridge, "DB_PATH", db_path)
    monkeypatch.setattr(bridge, "CLAUDE_MODE", False)

    async with bridge.aiosqlite.connect(db_path) as db:
        await bridge._init_db(db)

    async def fake_get_tenant_config(pool, tenant_id):
        return APPROVED, {"is_active": True, "system_prompt": None}

    monkeypatch.setattr(bridge, "_get_tenant_config", fake_get_tenant_config)

    captured = {}

    async def fake_call_openrouter(model, messages):
        captured["messages"] = messages
        return "hello!"

    monkeypatch.setattr(bridge, "_call_openrouter", fake_call_openrouter)
    monkeypatch.setattr(bridge, "_send_reply", lambda token, text: None)

    await bridge._handle_text("Uabc", "Tabc", "hello", "reply-token", None)

    assert captured["messages"][0] == {"role": "system", "content": bridge.SYSTEM_PROMPT}


@pytest.mark.asyncio
async def test_pg_pool_created_later_when_db_unreachable_at_startup(monkeypatch):
    # Regression: the DB container came up after the bridge, so the startup
    # attempt failed and pg_pool stayed None for the life of the process.
    from types import SimpleNamespace

    clock = [1000.0]
    monkeypatch.setattr(bridge.time, "monotonic", lambda: clock[0])
    calls = []
    db_up = [False]
    pool = _FakePool()

    async def fake_create_pool(*args, **kwargs):
        calls.append(args)
        if not db_up[0]:
            raise ConnectionRefusedError("Connection refused")
        return pool

    monkeypatch.setattr(bridge.asyncpg, "create_pool", fake_create_pool)
    app = SimpleNamespace(state=SimpleNamespace(pg_pool=None))

    # Startup: DB down.
    assert await bridge._get_pg_pool(app) is None
    assert len(calls) == 1

    # DB comes up, but we are still inside the retry window: no new attempt.
    db_up[0] = True
    clock[0] += bridge.PG_RETRY_INTERVAL - 1
    assert await bridge._get_pg_pool(app) is None
    assert len(calls) == 1

    # Window elapsed: the pool is created and stored.
    clock[0] += 1
    assert await bridge._get_pg_pool(app) is pool
    assert app.state.pg_pool is pool
    assert len(calls) == 2

    # Subsequent calls reuse the pool without reconnecting.
    assert await bridge._get_pg_pool(app) is pool
    assert len(calls) == 2


# ---------- @mention stripping ----------

def _text_message(text, mentionees=None):
    data = {"type": "text", "id": "1", "text": text, "quoteToken": "q"}
    if mentionees is not None:
        data["mention"] = {"mentionees": mentionees}
    return TextMessageContent.from_dict(data)


def _self_mention(index, length):
    return {"type": "user", "index": index, "length": length, "userId": "Ubot", "isSelf": True}


@pytest.mark.parametrize(
    "text, mentionees, expected_text, expected_mentioned",
    [
        pytest.param("@Bot hello", [_self_mention(0, 4)], " hello", True, id="leading"),
        pytest.param(
            "こんにちは@ボット元気？", [_self_mention(5, 4)], "こんにちは元気？", True, id="cjk-middle"
        ),
        # U+1F600 is a surrogate pair: 2 UTF-16 units, so "@Bot" starts at index 3.
        pytest.param(
            "\U0001F600 @Bot hi", [_self_mention(3, 4)], "\U0001F600  hi", True, id="emoji-before"
        ),
        pytest.param(
            "@Alice @Bot hi",
            [
                {"type": "user", "index": 0, "length": 6, "userId": "Ualice"},
                _self_mention(7, 4),
            ],
            "@Alice  hi",
            True,
            id="other-user-and-bot",
        ),
        pytest.param(
            "@All hi", [{"type": "all", "index": 0, "length": 4}], "@All hi", False, id="all-only"
        ),
        pytest.param("hello", None, "hello", False, id="no-mention"),
        # Span does not start with "@": counts as a mention but the text is kept.
        pytest.param("xBot hi", [_self_mention(0, 4)], "xBot hi", True, id="span-without-at"),
    ],
)
def test_strip_self_mentions(text, mentionees, expected_text, expected_mentioned):
    message = _text_message(text, mentionees)
    assert bridge._strip_self_mentions(message) == (expected_text, expected_mentioned)


# ---------- group reply gate and push fallback ----------

@pytest.fixture
def chat_env(monkeypatch, tmp_path):
    """Wire _handle_text to fakes; returns (set_config, sent replies, LLM calls)."""
    db_path = str(tmp_path / "conversations.db")
    monkeypatch.setattr(bridge, "DB_PATH", db_path)
    monkeypatch.setattr(bridge, "CLAUDE_MODE", False)

    config = {"is_active": True, "system_prompt": None, "reply_mode": "mention"}

    async def fake_get_tenant_config(pool, tenant_id):
        return APPROVED, dict(config)

    monkeypatch.setattr(bridge, "_get_tenant_config", fake_get_tenant_config)

    sent = []
    monkeypatch.setattr(bridge, "_send_reply", lambda token, text: sent.append((token, text)))
    monkeypatch.setattr(bridge, "_show_loading", lambda user_id: None)

    llm_calls = []

    async def fake_call_openrouter(model, messages):
        llm_calls.append(messages)
        return "bot reply"

    monkeypatch.setattr(bridge, "_call_openrouter", fake_call_openrouter)
    return config, sent, llm_calls


async def _init_chat_db():
    async with bridge.aiosqlite.connect(bridge.DB_PATH) as db:
        await bridge._init_db(db)


@pytest.mark.asyncio
async def test_group_in_mention_mode_ignores_message_without_mention(chat_env):
    config, sent, llm_calls = chat_env
    await _init_chat_db()

    await bridge._handle_text("Uabc", "Cgroup", "hello", "tok", None, is_group=True, mentioned=False)

    assert sent == []
    assert llm_calls == []


@pytest.mark.asyncio
async def test_group_in_mention_mode_replies_when_mentioned(chat_env):
    config, sent, llm_calls = chat_env
    await _init_chat_db()

    await bridge._handle_text("Uabc", "Cgroup", "hello", "tok", None, is_group=True, mentioned=True)

    assert sent == [("tok", "bot reply")]
    assert len(llm_calls) == 1


@pytest.mark.asyncio
async def test_group_in_all_mode_replies_without_mention(chat_env):
    config, sent, llm_calls = chat_env
    config["reply_mode"] = "all"
    await _init_chat_db()

    await bridge._handle_text("Uabc", "Cgroup", "hello", "tok", None, is_group=True, mentioned=False)

    assert sent == [("tok", "bot reply")]


@pytest.mark.asyncio
async def test_one_to_one_chat_replies_even_in_mention_mode(chat_env):
    config, sent, llm_calls = chat_env
    await _init_chat_db()

    await bridge._handle_text("Uabc", "Uabc", "hello", "tok", None)

    assert sent == [("tok", "bot reply")]


@pytest.mark.asyncio
async def test_inactive_group_without_mention_stays_silent(chat_env):
    config, sent, llm_calls = chat_env
    config["is_active"] = False

    await bridge._handle_text("Uabc", "Cgroup", "hello", "tok", None, is_group=True, mentioned=False)

    assert sent == []


@pytest.mark.asyncio
async def test_rate_limited_user_gets_slow_down_reply(chat_env, monkeypatch):
    config, sent, llm_calls = chat_env
    monkeypatch.setattr(bridge, "_is_rate_limited", lambda user_id: True)

    await bridge._handle_text("Uabc", "Uabc", "hello", "tok", None)

    assert sent == [("tok", "Too many requests. Please slow down.")]
    assert llm_calls == []


def _invalid_token_reply(token, text):
    exc = ApiException(status=400, reason="Bad Request")
    exc.body = '{"message":"Invalid reply token"}'
    raise exc


@pytest.mark.parametrize("push_fallback, expected_pushes", [(True, [("Uabc", "bot reply")]), (False, [])])
@pytest.mark.asyncio
async def test_expired_reply_token_falls_back_to_push_only_when_enabled(
    chat_env, monkeypatch, push_fallback, expected_pushes
):
    await _init_chat_db()
    monkeypatch.setattr(bridge, "PUSH_FALLBACK", push_fallback)
    monkeypatch.setattr(bridge, "_send_reply", _invalid_token_reply)
    pushes = []
    monkeypatch.setattr(bridge, "_send_push", lambda to, text: pushes.append((to, text)))

    await bridge._handle_text("Uabc", "Uabc", "hello", "tok", None)

    assert pushes == expected_pushes


# ---------- approval gate ----------

_REAL_GET_TENANT_CONFIG = bridge._get_tenant_config
_APPROVED_ROW = {"is_active": True, "system_prompt": None, "reply_mode": "mention"}


@pytest.fixture
def access_env(chat_env, monkeypatch):
    """chat_env, but with the real tenant lookup so approval state comes from the DB."""
    monkeypatch.setattr(bridge, "_get_tenant_config", _REAL_GET_TENANT_CONFIG)
    return chat_env


@pytest.mark.asyncio
async def test_unknown_dm_gets_approval_notice_once(access_env):
    _, sent, llm_calls = access_env
    db = _FakeDB()

    await bridge._handle_text("Unew", "Unew", "hello", "tok1", db)
    await bridge._handle_text("Unew", "Unew", "hello again", "tok2", db)

    assert sent == [("tok1", bridge.PENDING_APPROVAL_MESSAGE)]
    assert db.pending == {"Unew": {"type": "user", "status": "pending"}}
    assert llm_calls == []


@pytest.fixture
def loading(monkeypatch):
    calls = []
    monkeypatch.setattr(bridge, "_show_loading", lambda user_id: calls.append(user_id))
    return calls


@pytest.mark.asyncio
async def test_loading_animation_only_for_approved_one_to_one_chats(chat_env, loading):
    config, _, _ = chat_env
    config["reply_mode"] = "all"
    await _init_chat_db()

    await bridge._handle_text("Uabc", "Uabc", "hi", "tok1", None)
    await bridge._handle_text("Uabc", "Cgroup", "hi", "tok2", None, is_group=True)

    assert loading == ["Uabc"]


@pytest.mark.asyncio
async def test_unknown_dm_sees_no_loading_animation(access_env, loading):
    await bridge._handle_text("Unew", "Unew", "hello", "tok", _FakeDB())

    assert loading == []


@pytest.mark.asyncio
async def test_unknown_group_untagged_message_is_queued_silently(access_env):
    _, sent, llm_calls = access_env
    db = _FakeDB()

    await bridge._handle_text("Uabc", "Cnew", "hello", "tok", db, is_group=True, mentioned=False)

    assert sent == []
    assert "Cnew" in db.pending
    assert llm_calls == []


@pytest.mark.asyncio
async def test_unknown_group_tagged_message_gets_approval_notice(access_env):
    _, sent, llm_calls = access_env
    db = _FakeDB()

    await bridge._handle_text("Uabc", "Cnew", "hello", "tok", db, is_group=True, mentioned=True)

    assert sent == [("tok", bridge.PENDING_APPROVAL_MESSAGE)]
    assert llm_calls == []


@pytest.mark.parametrize("pending_status", ["pending", "denied"])
@pytest.mark.asyncio
async def test_already_queued_chat_is_silent(access_env, pending_status):
    _, sent, llm_calls = access_env
    db = _FakeDB(pending={"Uabc": {"type": "user", "status": pending_status}})

    await bridge._handle_text("Uabc", "Uabc", "hello", "tok", db)

    assert sent == []
    assert llm_calls == []


@pytest.mark.asyncio
async def test_unavailable_db_without_cache_is_silent(access_env):
    _, sent, llm_calls = access_env

    await bridge._handle_text("Uabc", "Uabc", "hello", "tok", None)

    assert sent == []
    assert llm_calls == []


@pytest.mark.asyncio
async def test_unavailable_db_with_cached_approval_replies_normally(access_env):
    _, sent, llm_calls = access_env
    await _init_chat_db()
    await bridge._handle_text("Uabc", "Uabc", "first", "tok1", _FakeDB(tenants={"Uabc": _APPROVED_ROW}))

    await bridge._handle_text("Uabc", "Uabc", "second", "tok2", _FakeDB(raise_exc=RuntimeError("down")))

    assert sent == [("tok1", "bot reply"), ("tok2", "bot reply")]
    assert len(llm_calls) == 2


@pytest.mark.asyncio
async def test_approved_tenant_replies_normally(access_env):
    _, sent, llm_calls = access_env
    await _init_chat_db()
    db = _FakeDB(tenants={"Uabc": _APPROVED_ROW})

    await bridge._handle_text("Uabc", "Uabc", "hello", "tok", db)

    assert sent == [("tok", "bot reply")]
    assert len(llm_calls) == 1
    assert db.pending == {}
