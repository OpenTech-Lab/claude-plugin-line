import hashlib
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Optional

import aiosqlite
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from linebot.v3 import WebhookParser
from linebot.v3.exceptions import InvalidSignatureError
from linebot.v3.messaging import (
    ApiClient,
    Configuration,
    MessagingApi,
    ReplyMessageRequest,
    TextMessage,
)
from linebot.v3.webhooks import MessageEvent, TextMessageContent

load_dotenv()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
LINE_CHANNEL_SECRET = os.getenv("LINE_CHANNEL_SECRET", "")
LINE_CHANNEL_ACCESS_TOKEN = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "")
DEFAULT_MODEL = os.getenv("MODEL", "anthropic/claude-haiku-4-5-20251001")
SYSTEM_PROMPT = os.getenv(
    "SYSTEM_PROMPT",
    "You are a helpful assistant accessed via LINE messaging app. Keep replies concise (under 500 words).",
)
DB_PATH = os.getenv("DB_PATH", "data/conversations.db")
HISTORY_LIMIT = 10  # rows = 5 user/assistant pairs
REPLY_MAX_CHARS = 4800

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

parser = WebhookParser(LINE_CHANNEL_SECRET)
line_config = Configuration(access_token=LINE_CHANNEL_ACCESS_TOKEN)

# Simple in-memory rate limiter: {user_id: [timestamps]}
_rate_store: dict[str, list[float]] = {}
RATE_LIMIT_WINDOW = 60
RATE_LIMIT_MAX = 10

START_TIME = time.time()


async def _init_db(db: aiosqlite.Connection) -> None:
    await db.execute("""
        CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            ts DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_conv_user_ts ON conversations(user_id, ts)"
    )
    await db.execute("""
        CREATE TABLE IF NOT EXISTS user_settings (
            user_id TEXT PRIMARY KEY,
            model TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await _init_db(db)
    yield


app = FastAPI(lifespan=lifespan)


def _is_rate_limited(user_id: str) -> bool:
    now = time.time()
    timestamps = _rate_store.get(user_id, [])
    timestamps = [t for t in timestamps if now - t < RATE_LIMIT_WINDOW]
    if len(timestamps) >= RATE_LIMIT_MAX:
        _rate_store[user_id] = timestamps
        return True
    timestamps.append(now)
    _rate_store[user_id] = timestamps
    return False


def _uid_hash(user_id: str) -> str:
    return hashlib.sha256(user_id.encode()).hexdigest()[:8]


async def _get_model(db: aiosqlite.Connection, user_id: str) -> str:
    async with db.execute(
        "SELECT model FROM user_settings WHERE user_id = ?", (user_id,)
    ) as cursor:
        row = await cursor.fetchone()
    return row[0] if row else DEFAULT_MODEL


async def _set_model(db: aiosqlite.Connection, user_id: str, model: str) -> None:
    await db.execute(
        """INSERT INTO user_settings(user_id, model, updated_at)
           VALUES(?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id) DO UPDATE SET model=excluded.model, updated_at=excluded.updated_at""",
        (user_id, model),
    )
    await db.commit()


async def _get_history(db: aiosqlite.Connection, user_id: str) -> list[dict]:
    async with db.execute(
        """SELECT role, content FROM conversations
           WHERE user_id = ?
           ORDER BY ts DESC LIMIT ?""",
        (user_id, HISTORY_LIMIT),
    ) as cursor:
        rows = await cursor.fetchall()
    return [{"role": r[0], "content": r[1]} for r in reversed(rows)]


async def _save_turn(
    db: aiosqlite.Connection, user_id: str, user_text: str, assistant_text: str
) -> None:
    await db.executemany(
        "INSERT INTO conversations(user_id, role, content) VALUES(?, ?, ?)",
        [(user_id, "user", user_text), (user_id, "assistant", assistant_text)],
    )
    await db.commit()


async def _clear_history(db: aiosqlite.Connection, user_id: str) -> None:
    await db.execute("DELETE FROM conversations WHERE user_id = ?", (user_id,))
    await db.commit()


async def _call_openrouter(
    model: str, messages: list[dict]
) -> Optional[str]:
    async with httpx.AsyncClient(timeout=25.0) as client:
        resp = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "X-Title": "LINE-Claude-Bridge",
            },
            json={"model": model, "messages": messages},
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]


def _send_reply(reply_token: str, text: str) -> None:
    text = text[:REPLY_MAX_CHARS]
    with ApiClient(line_config) as api_client:
        MessagingApi(api_client).reply_message(
            ReplyMessageRequest(
                reply_token=reply_token,
                messages=[TextMessage(type="text", text=text)],
            )
        )


async def _handle_text(
    user_id: str, text: str, reply_token: str
) -> None:
    t0 = time.time()
    outcome = "ok"

    async with aiosqlite.connect(DB_PATH) as db:
        # Command dispatch
        if text == "/clear":
            await _clear_history(db, user_id)
            _send_reply(reply_token, "History cleared.")
            outcome = "command"
            _log(user_id, await _get_model(db, user_id), outcome, t0, 0)
            return

        if text.startswith("/model"):
            parts = text.split(None, 1)
            if len(parts) < 2 or not parts[1].strip():
                current = await _get_model(db, user_id)
                _send_reply(reply_token, f"Usage: /model <name>  (current: {current})")
            else:
                new_model = parts[1].strip()
                # Basic validation: must contain a slash (e.g. "provider/name")
                if "/" not in new_model:
                    current = await _get_model(db, user_id)
                    _send_reply(
                        reply_token,
                        f"Unknown model '{new_model}'. Use format provider/name. Keeping {current}.",
                    )
                else:
                    await _set_model(db, user_id, new_model)
                    _send_reply(reply_token, f"Model set to {new_model}.")
            outcome = "command"
            _log(user_id, await _get_model(db, user_id), outcome, t0, 0)
            return

        if text == "/status":
            model = await _get_model(db, user_id)
            async with db.execute(
                "SELECT COUNT(*) FROM conversations WHERE user_id = ?", (user_id,)
            ) as cursor:
                row = await cursor.fetchone()
            count = row[0] if row else 0
            uptime_s = int(time.time() - START_TIME)
            _send_reply(
                reply_token,
                f"Model: {model}\nHistory rows: {count}\nUptime: {uptime_s}s",
            )
            outcome = "command"
            _log(user_id, model, outcome, t0, count)
            return

        # Normal message flow
        model = await _get_model(db, user_id)
        history = await _get_history(db, user_id)
        messages = (
            [{"role": "system", "content": SYSTEM_PROMPT}]
            + history
            + [{"role": "user", "content": text}]
        )

        try:
            reply_text = await _call_openrouter(model, messages)
            if not reply_text or not reply_text.strip():
                reply_text = "Received an empty response."
            await _save_turn(db, user_id, text, reply_text)
        except httpx.TimeoutException:
            reply_text = "Sorry, couldn't reach Claude right now (timeout)."
            outcome = "error"
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                reply_text = "Rate limited by AI provider. Try again shortly."
            else:
                reply_text = f"AI unavailable ({e.response.status_code}). Try again shortly."
            outcome = "error"
        except (KeyError, IndexError):
            reply_text = "Received an empty response from the AI."
            outcome = "error"

        try:
            _send_reply(reply_token, reply_text)
        except Exception as e:
            # Reply token may have expired; log silently
            logger.warning("reply_failed user=%s err=%s", _uid_hash(user_id), str(e))

        _log(user_id, model, outcome, t0, len(history))


def _log(
    user_id: str, model: str, outcome: str, t0: float, history_len: int
) -> None:
    logger.info(
        json.dumps({
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "user_id_hash": _uid_hash(user_id),
            "model": model,
            "outcome": outcome,
            "response_time_ms": int((time.time() - t0) * 1000),
            "history_len": history_len,
        })
    )


@app.post("/webhook")
async def webhook(request: Request):
    body = await request.body()
    signature = request.headers.get("X-Line-Signature", "")

    try:
        events = parser.parse(body.decode(), signature)
    except InvalidSignatureError:
        return JSONResponse(status_code=400, content={"error": "invalid signature"})
    except Exception:
        return JSONResponse(status_code=400, content={"error": "bad request"})

    for event in events:
        if not isinstance(event, MessageEvent):
            continue
        if not isinstance(event.message, TextMessageContent):
            continue

        user_id = event.source.user_id
        text = event.message.text.strip()

        if not text:
            continue

        if _is_rate_limited(user_id):
            _send_reply(event.reply_token, "Too many requests. Please slow down.")
            continue

        await _handle_text(user_id, text, event.reply_token)

    return {"status": "ok"}


@app.get("/health")
async def health():
    return {"status": "ok"}
