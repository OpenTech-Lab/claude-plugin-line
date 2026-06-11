import pytest

import line_claude_bridge as bridge


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


@pytest.mark.asyncio
async def test_get_tenant_config_returns_row_values():
    pool = _FakePool(row={"is_active": False, "system_prompt": "You are a pirate."})
    config = await bridge._get_tenant_config(pool, "Uabc")
    assert config == {"is_active": False, "system_prompt": "You are a pirate."}


@pytest.mark.asyncio
async def test_get_tenant_config_defaults_when_no_row():
    pool = _FakePool(row=None)
    config = await bridge._get_tenant_config(pool, "Uabc")
    assert config == {"is_active": True, "system_prompt": None}


@pytest.mark.asyncio
async def test_get_tenant_config_defaults_when_pool_is_none():
    config = await bridge._get_tenant_config(None, "Uabc")
    assert config == {"is_active": True, "system_prompt": None}


@pytest.mark.asyncio
async def test_get_tenant_config_defaults_on_query_error():
    pool = _FakePool(raise_exc=RuntimeError("connection lost"))
    config = await bridge._get_tenant_config(pool, "Uabc")
    assert config == {"is_active": True, "system_prompt": None}


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
        return {"is_active": False, "system_prompt": None}

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
        return {"is_active": True, "system_prompt": "You are a pirate."}

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
        return {"is_active": True, "system_prompt": None}

    monkeypatch.setattr(bridge, "_get_tenant_config", fake_get_tenant_config)

    captured = {}

    async def fake_call_openrouter(model, messages):
        captured["messages"] = messages
        return "hello!"

    monkeypatch.setattr(bridge, "_call_openrouter", fake_call_openrouter)
    monkeypatch.setattr(bridge, "_send_reply", lambda token, text: None)

    await bridge._handle_text("Uabc", "Tabc", "hello", "reply-token", None)

    assert captured["messages"][0] == {"role": "system", "content": bridge.SYSTEM_PROMPT}
