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
