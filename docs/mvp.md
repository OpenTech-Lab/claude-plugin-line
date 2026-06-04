**Technical Documentation: LINE Bot Integration with Claude Code on Linux using OpenRouter**

**Version:** 1.0  
**Date:** June 2026  
**Author:** Grok (xAI)  
**Target Audience:** Developers with basic Linux, Python, and API knowledge.

### 1. Introduction

This document describes how to build a **LINE Bot** that connects to **Claude Code** running on a Linux machine (no GPU) using **OpenRouter** as the backend provider. 

The solution allows you (or others) to chat with Claude Code directly from the LINE mobile app. Claude Code runs locally on your Linux machine, giving it access to your filesystem, tools, and coding environment while using OpenRouter for model inference.

**Key Benefits:**
- No direct Anthropic API costs (use cheaper or free models via OpenRouter).
- Persistent Claude Code session with full Computer Use / MCP capabilities.
- Works on headless Linux servers.
- Scalable from simple webhook to advanced MCP Channels.

### 2. Architecture Overview

**Components:**
- **LINE Messaging API** → Webhook (public endpoint)
- **Bridge Server** (FastAPI on Linux) → Receives LINE messages
- **Claude Code** (running locally) → Processes requests via OpenRouter
- **OpenRouter** → LLM inference (Claude, Qwen, DeepSeek, etc.)
- **Optional**: ngrok (testing) or AWS Lambda (production)

**Data Flow:**
1. User sends message in LINE.
2. LINE sends webhook to Bridge Server.
3. Bridge forwards message to Claude Code / OpenRouter.
4. Response returns through LINE.

### 3. Prerequisites

- Linux machine (Ubuntu/Debian recommended) with internet access.
- Node.js & npm (for Claude Code).
- Python 3.10+ and pip.
- OpenRouter account + API Key (`sk-or-v1-...`).
- LINE Developers account with Messaging API Channel.
- (Optional) AWS account for Lambda, ngrok account for testing.

### 4. Step 1: Install and Configure Claude Code with OpenRouter

```bash
# Install Claude Code
curl -fsSL https://claude.ai/install.sh | bash

# Create settings (recommended method)
mkdir -p ~/.claude
cat > ~/.claude/settings.json << EOF
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://openrouter.ai/api/v1",
    "ANTHROPIC_API_KEY": "sk-or-v1-YOUR_OPENROUTER_KEY_HERE",
    "ANTHROPIC_AUTH_TOKEN": "sk-or-v1-YOUR_OPENROUTER_KEY_HERE"
  },
  "model": "anthropic/claude-sonnet-4.6"   // or qwen/qwen3-coder:free
}
EOF
```

**Recommended Models on OpenRouter (June 2026):**
- Best balance: `anthropic/claude-sonnet-4.6`
- Free / Cheap coding: `qwen/qwen3-coder:free`, `deepseek/deepseek-chat`
- Fast: `google/gemini-2.5-flash`

Test Claude Code:
```bash
claude
```

### 5. Step 2: Create the LINE Bridge Server (FastAPI)

**Install dependencies:**
```bash
pip install fastapi uvicorn requests python-dotenv
```

**Create `line_claude_bridge.py`:**

```python
from fastapi import FastAPI, Request
import os
import requests
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
LINE_ACCESS_TOKEN = os.getenv("LINE_CHANNEL_ACCESS_TOKEN")
MODEL = os.getenv("MODEL", "anthropic/claude-sonnet-4.6")

@app.post("/webhook")
async def webhook(request: Request):
    data = await request.json()
    
    for event in data.get("events", []):
        if event.get("type") == "message" and event["message"].get("type") == "text":
            user_id = event["source"].get("userId")
            text = event["message"]["text"]
            reply_token = event["replyToken"]

            # Call OpenRouter (or forward to local Claude Code session)
            try:
                resp = requests.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                        "HTTP-Referer": "https://yourdomain.com/line-bot",
                        "X-Title": "LINE-ClaudeCode-Bot",
                    },
                    json={
                        "model": MODEL,
                        "messages": [{"role": "user", "content": text}]
                    },
                    timeout=60
                )
                ai_reply = resp.json()["choices"][0]["message"]["content"]
            except Exception as e:
                ai_reply = f"Error: {str(e)}"

            # Reply to LINE
            requests.post(
                "https://api.line.me/v2/bot/message/reply",
                headers={"Authorization": f"Bearer {LINE_ACCESS_TOKEN}"},
                json={
                    "replyToken": reply_token,
                    "messages": [{"type": "text", "text": ai_reply[:2000]}]  # LINE limit
                }
            )
    
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

Create `.env` file:
```env
OPENROUTER_API_KEY=sk-or-v1-...
LINE_CHANNEL_ACCESS_TOKEN=your_line_token
MODEL=anthropic/claude-sonnet-4.6
```

Run the server:
```bash
python line_claude_bridge.py
```

### 6. Step 3: Expose the Webhook

**Option A - Testing (ngrok):**
```bash
ngrok http 8000
```
Copy the https URL and set it in LINE Developers Console → Messaging API → Webhook URL.

**Option B - Production (AWS Lambda):**
- Package the FastAPI app using Mangum or rewrite as Lambda handler.
- Use Lambda Function URL or API Gateway.

### 7. Step 4: Configure LINE Bot

1. Go to [LINE Developers Console](https://developers.line.biz/).
2. Create/Select Messaging API Channel.
3. Issue Channel Access Token.
4. Set Webhook URL to your ngrok/Lambda endpoint.
5. Enable webhook.

### 8. Advanced Option: Claude Code MCP Channels

Claude Code (v2.1+) supports **Channels** via MCP. You can build or use community plugins to push LINE events directly into a running Claude Code session (better context, tool use, file access).

This is more powerful than simple API calls but requires writing a custom MCP server for LINE.

### 9. Security & Best Practices

- Use HTTPS only.
- Add signature validation for LINE webhooks.
- Rate limiting on the bridge.
- Store conversation history in Redis or SQLite for better context.
- Run Claude Code in a tmux/screen session or as systemd service.
- Monitor OpenRouter usage and costs.

### 10. Troubleshooting

- **Webhook not triggering**: Check LINE console logs and ngrok status.
- **Permission errors**: Ensure Claude Code has access to your project directories.
- **Slow responses**: Use faster models (Haiku/Flash equivalents on OpenRouter).
- **Token limits**: Keep context short or implement summarization.

### 11. Cost Estimation (June 2026)

- OpenRouter free tier: Suitable for light use.
- Paid models: $0.5 – $3 per million tokens depending on model.
- LINE: Free for most personal use.
- Server: Negligible on always-on Linux machine.

