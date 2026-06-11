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
