"""Tests for scripts/lbadmin, run as a real subprocess against a local fake API."""

import importlib.machinery
import importlib.util
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "lbadmin"
TOKEN = "test-token-not-real"


def load_module():
    loader = importlib.machinery.SourceFileLoader("lbadmin", str(SCRIPT))
    spec = importlib.util.spec_from_loader("lbadmin", loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


class FakeApi:
    """Records each request; replies with `responses[(method, path)]` or 200 {}."""

    def __init__(self):
        self.requests = []
        self.responses = {}
        api = self

        class Handler(BaseHTTPRequestHandler):
            def _handle(self):
                length = int(self.headers.get("Content-Length") or 0)
                api.requests.append({
                    "method": self.command,
                    "path": self.path,
                    "headers": dict(self.headers),
                    "body": self.rfile.read(length) if length else b"",
                })
                status, payload = api.responses.get((self.command, self.path), (200, {}))
                data = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            do_GET = do_POST = do_PUT = do_DELETE = _handle

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    @property
    def last(self):
        return self.requests[-1]

    def json_body(self):
        return json.loads(self.last["body"])


@pytest.fixture
def api():
    server = FakeApi()
    yield server
    server.server.shutdown()
    server.server.server_close()


@pytest.fixture
def run(api):
    def _run(*args, token=TOKEN):
        env = {k: v for k, v in os.environ.items() if not k.startswith("LINE_ADMIN_")}
        env["LINE_ADMIN_URL"] = api.url
        if token is not None:
            env["LINE_ADMIN_TOKEN"] = token
        return subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            env=env, capture_output=True, text=True, timeout=30,
        )
    return _run


# --- request construction ---------------------------------------------------

def test_build_request_sends_bearer_token_and_json_body(monkeypatch):
    lb = load_module()
    monkeypatch.setenv("LINE_ADMIN_URL", "http://example.test:9/")
    monkeypatch.setenv("LINE_ADMIN_TOKEN", TOKEN)
    req = lb.build_request("PUT", "/api/tenants/x", {"is_active": False})
    assert req.full_url == "http://example.test:9/api/tenants/x"
    assert req.get_method() == "PUT"
    assert req.get_header("Authorization") == f"Bearer {TOKEN}"
    assert req.get_header("Content-type") == "application/json"
    assert json.loads(req.data) == {"is_active": False}


def test_base_url_defaults_to_local_dashboard(monkeypatch):
    lb = load_module()
    monkeypatch.delenv("LINE_ADMIN_URL", raising=False)
    assert lb.base_url() == "http://localhost:3001"


def test_ids_are_encoded_as_single_path_segments():
    lb = load_module()
    assert lb.tenant_path("a/b c", "documents", lb.q("7?x")) == "/api/tenants/a%2Fb%20c/documents/7%3Fx"


# --- end to end through the CLI ------------------------------------------------

def test_missing_token_fails_clearly_without_calling_the_api(run, api):
    result = run("tenants", "list", token=None)
    assert result.returncode == 1
    assert "LINE_ADMIN_TOKEN is not set" in result.stderr
    assert api.requests == []


def test_tenants_list_prints_pretty_json_and_authenticates(run, api):
    api.responses[("GET", "/api/tenants")] = (200, [{"id": "C1", "type": "group"}])
    result = run("tenants", "list")
    assert result.returncode == 0, result.stderr
    assert api.last["headers"]["Authorization"] == f"Bearer {TOKEN}"
    assert json.loads(result.stdout) == [{"id": "C1", "type": "group"}]
    assert result.stdout.startswith("[\n  {")
    assert TOKEN not in result.stdout + result.stderr


def test_tenants_show_url_encodes_the_id(run, api):
    run("tenants", "show", "U1/../x")
    assert api.last["method"] == "GET"
    assert api.last["path"] == "/api/tenants/U1%2F..%2Fx"


def test_tenants_create_posts_id_type_and_display_name(run, api):
    result = run("tenants", "create", "C9", "--type", "group", "--name", "Team")
    assert result.returncode == 0, result.stderr
    assert (api.last["method"], api.last["path"]) == ("POST", "/api/tenants")
    assert api.json_body() == {"id": "C9", "type": "group", "display_name": "Team"}


def test_tenants_delete_requires_yes(run, api):
    result = run("tenants", "delete", "C9")
    assert result.returncode == 1
    assert "--yes" in result.stderr
    assert api.requests == []

    assert run("tenants", "delete", "C9", "--yes").returncode == 0
    assert (api.last["method"], api.last["path"]) == ("DELETE", "/api/tenants/C9")


def test_tenant_set_maps_flags_to_route_fields(run, api, tmp_path):
    prompt = tmp_path / "p.txt"
    prompt.write_text("Be brief.\n", encoding="utf-8")
    result = run("tenant", "set", "C1", "--name", "N", "--prompt-file", str(prompt),
                 "--active", "false", "--reply-mode", "mention")
    assert result.returncode == 0, result.stderr
    assert (api.last["method"], api.last["path"]) == ("PUT", "/api/tenants/C1")
    assert api.json_body() == {
        "display_name": "N", "system_prompt": "Be brief.\n", "is_active": False, "reply_mode": "mention",
    }


def test_tenant_set_without_fields_is_rejected_locally(run, api):
    result = run("tenant", "set", "C1")
    assert result.returncode == 1
    assert api.requests == []


def test_kb_add_text_posts_title_and_content(run, api, tmp_path):
    doc = tmp_path / "faq.md"
    doc.write_text("# FAQ", encoding="utf-8")
    run("kb", "add-text", "C1", "--title", "FAQ", "--file", str(doc))
    assert (api.last["method"], api.last["path"]) == ("POST", "/api/tenants/C1/documents")
    assert api.json_body() == {"title": "FAQ", "content": "# FAQ"}


def test_kb_add_url_posts_website_source(run, api):
    run("kb", "add-url", "C1", "https://example.com/a", "--title", "A")
    assert api.json_body() == {"source_type": "website", "url": "https://example.com/a", "title": "A"}


def test_kb_upload_sends_multipart_file_and_title(run, api, tmp_path):
    doc = tmp_path / "notes.txt"
    doc.write_bytes(b"hello\nworld")
    result = run("kb", "upload", "C1", str(doc), "--title", "Notes")
    assert result.returncode == 0, result.stderr
    ctype = api.last["headers"]["Content-Type"]
    assert ctype.startswith("multipart/form-data; boundary=")
    body = api.last["body"]
    assert b'name="title"\r\n\r\nNotes\r\n' in body
    assert b'name="file"; filename="notes.txt"' in body
    assert b"hello\nworld" in body
    assert body.rstrip().endswith(b"--" + ctype.split("boundary=")[1].encode() + b"--")


def test_kb_show_edit_delete_hit_the_document_route(run, api):
    run("kb", "show", "C1", "42")
    assert (api.last["method"], api.last["path"]) == ("GET", "/api/tenants/C1/documents/42")

    run("kb", "edit", "C1", "42", "--title", "New")
    assert (api.last["method"], api.last["path"]) == ("PUT", "/api/tenants/C1/documents/42")
    assert api.json_body() == {"title": "New"}

    assert run("kb", "delete", "C1", "42").returncode == 1
    run("kb", "delete", "C1", "42", "--yes")
    assert (api.last["method"], api.last["path"]) == ("DELETE", "/api/tenants/C1/documents/42")


def test_guardrails_and_metadata_set_send_the_json_object(run, api):
    run("guardrails", "set", "C1", "--json", '{"blocked_words": ["x"]}')
    assert (api.last["method"], api.last["path"]) == ("PUT", "/api/tenants/C1/guardrails")
    assert api.json_body() == {"blocked_words": ["x"]}

    run("metadata", "set", "C1", "--json", '{"plan": "pro"}')
    assert (api.last["method"], api.last["path"]) == ("PUT", "/api/tenants/C1/metadata")
    assert api.json_body() == {"plan": "pro"}


def test_set_json_must_be_an_object(run, api):
    result = run("metadata", "set", "C1", "--json", "[1]")
    assert result.returncode == 1
    assert api.requests == []


def test_pending_approve_and_deny_post(run, api):
    run("pending", "approve", "U 1")
    assert (api.last["method"], api.last["path"]) == ("POST", "/api/pending/U%201/approve")
    run("pending", "deny", "U1")
    assert (api.last["method"], api.last["path"]) == ("POST", "/api/pending/U1/deny")


def test_activity_filters_by_tenant_and_limits_client_side(run, api):
    api.responses[("GET", "/api/activity?tenant_id=C+1")] = (200, [{"id": i} for i in range(5)])
    result = run("activity", "--tenant", "C 1", "--limit", "2")
    assert result.returncode == 0, result.stderr
    assert api.last["path"] == "/api/activity?tenant_id=C+1"
    assert json.loads(result.stdout) == [{"id": 0}, {"id": 1}]


def test_error_response_goes_to_stderr_with_exit_1(run, api):
    api.responses[("GET", "/api/tenants/nope")] = (404, {"error": "Tenant not found"})
    result = run("tenants", "show", "nope")
    assert result.returncode == 1
    assert result.stdout == ""
    assert "HTTP 404" in result.stderr
    assert '"error": "Tenant not found"' in result.stderr


def test_script_is_executable_with_python_shebang():
    assert os.access(SCRIPT, os.X_OK)
    assert SCRIPT.read_text().startswith("#!/usr/bin/env python3\n")
