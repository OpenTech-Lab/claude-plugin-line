# LINE Bot + Claude Code Bridge

Chat with Claude (via OpenRouter) directly from the LINE mobile app.  
A FastAPI server receives LINE webhooks and forwards them to OpenRouter, with per-user conversation history in SQLite. A Cloudflare Tunnel provides the public HTTPS endpoint — no port forwarding or ngrok needed.

## Architecture

```
LINE User (mobile)
    │
    ▼
LINE Messaging API
    │  POST /webhook
    ▼
Cloudflare Tunnel (cloudflared)
    │
    ▼
FastAPI Bridge (Docker)
    ├── linebot.v3  — signature validation + reply API
    ├── aiosqlite   — conversation history per user
    └── httpx       — async OpenRouter API calls
```

## Folder Structure

```
claude-code-line/
├── line_claude_bridge.py     # FastAPI bridge server
├── .env                      # secrets (gitignored)
├── .env.example              # template
├── requirements.txt
├── Dockerfile
├── docker-compose.yml        # bridge + cloudflared services
├── scripts/
│   ├── start-bridge.sh       # run without Docker
│   └── start-tunnel.sh       # quick Cloudflare tunnel (testing)
├── terraform/                # Cloudflare Tunnel + DNS as code
│   ├── main.tf
│   ├── providers.tf
│   ├── variables.tf
│   ├── cloudflare_tunnel.tf
│   ├── cloudflare_dns.tf
│   ├── outputs.tf
│   └── terraform.tfvars.example
└── docs/
    ├── mvp.md
    ├── workflow.md
    ├── cloudflareTunnel.md
    └── designs/
        └── line-claude-bridge.md
```

## Prerequisites

- Python 3.11+
- Docker + Docker Compose (for production)
- [OpenRouter account](https://openrouter.ai) + API key
- [LINE Developers account](https://developers.line.biz) with a Messaging API channel
- `cloudflared` CLI (for testing without Docker)
- Terraform + a Cloudflare domain (for production tunnel)

---

## Quick Start (local testing, no Docker)

### 1. Clone and install

```bash
git clone <this-repo>
cd claude-code-line

python -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
OPENROUTER_API_KEY=sk-or-v1-...        # from openrouter.ai/keys
LINE_CHANNEL_SECRET=...                 # LINE Developers Console → Basic settings
LINE_CHANNEL_ACCESS_TOKEN=...           # LINE Developers Console → Messaging API → Issue token
CLOUDFLARE_TUNNEL_TOKEN=               # leave blank for quick-tunnel testing
MODEL=anthropic/claude-haiku-4-5-20251001
SYSTEM_PROMPT=You are a helpful assistant accessed via LINE messaging app. Keep replies concise.
```

### 3. Start the bridge

```bash
mkdir -p data
uvicorn line_claude_bridge:app --host 0.0.0.0 --port 8000

# Verify it's running:
curl http://localhost:8000/health
# → {"status":"ok"}
```

### 4. Expose with Cloudflare quick tunnel

In a second terminal:

```bash
# Install cloudflared if you haven't:
# https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

bash scripts/start-tunnel.sh
# Prints: https://something.trycloudflare.com
```

Copy the `https://something.trycloudflare.com` URL.

### 5. Configure LINE webhook

1. Go to [LINE Developers Console](https://developers.line.biz)
2. Select your Messaging API channel
3. **Messaging API** tab → **Webhook URL**: paste `https://something.trycloudflare.com/webhook`
4. Click **Verify** — should return success
5. Enable **Use webhook**

Send a message to your bot in LINE. It should reply within ~5 seconds.

---

## Chat Commands

Once the bot is running, send these commands in LINE:

| Command | Effect |
|---------|--------|
| `/clear` | Erase your conversation history (fresh context) |
| `/model <name>` | Switch OpenRouter model, e.g. `/model qwen/qwen3-coder:free` |
| `/status` | Show current model, history row count, and uptime |
| (any other text) | Chat with Claude |

### Recommended models on OpenRouter

| Model | Speed | Cost |
|-------|-------|------|
| `anthropic/claude-haiku-4-5-20251001` | Fast | Low |
| `qwen/qwen3-coder:free` | Fast | Free |
| `google/gemini-2.5-flash` | Very fast | Low |
| `anthropic/claude-sonnet-4-6` | Slower | Medium |

---

## Getting CLOUDFLARE_TUNNEL_TOKEN

There are two ways to create a Cloudflare Tunnel and get the token. Choose one.

---

### Option A — Cloudflare Dashboard (simpler, no Terraform)

This is the fastest way to get a permanent tunnel with a custom subdomain.

**Step 1: Install cloudflared**

```bash
# Linux (amd64)
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x cloudflared-linux-amd64
sudo mv cloudflared-linux-amd64 /usr/local/bin/cloudflared

# Verify
cloudflared --version
```

**Step 2: Create the tunnel in Zero Trust dashboard**

1. Go to [https://one.dash.cloudflare.com](https://one.dash.cloudflare.com)
2. Select your account
3. Left sidebar → **Networks** → **Tunnels**
4. Click **Create a tunnel**
5. Choose **Cloudflared** → click Next
6. Name it `line-claude-bot` → click Save tunnel
7. On the next screen, Cloudflare shows an install command like:

   ```
   cloudflared service install eyJhIjoiABC...long_token...XYZ
   ```

   **Copy the long token** — the part after `cloudflared service install `.  
   That is your `CLOUDFLARE_TUNNEL_TOKEN`.

8. Paste it into `.env`:

   ```env
   CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoiABC...long_token...XYZ
   ```

**Step 3: Set a Public Hostname**

Still in the dashboard (on the same tunnel page):

1. Click the **Public Hostname** tab
2. Click **Add a public hostname**
3. Fill in:
   - **Subdomain**: `bot` (or anything you like)
   - **Domain**: choose your domain from the dropdown
   - **Service → Type**: `HTTP`
   - **URL**: `localhost:8000`
4. Click **Save**

Your webhook URL is now `https://bot.yourdomain.com/webhook` — use this in LINE Developers Console.

**Step 4: Start the tunnel**

```bash
# The Docker Compose setup runs cloudflared automatically using the token.
# To test manually without Docker:
cloudflared tunnel run --token $CLOUDFLARE_TUNNEL_TOKEN
```

---

### Option B — Terraform (infrastructure as code)

Use this if you want the tunnel managed reproducibly as code.

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` with your Cloudflare credentials:

```hcl
cloudflare_api_token  = "..."   # see below
cloudflare_account_id = "..."   # Cloudflare dashboard → right sidebar
cloudflare_zone_id    = "..."   # Cloudflare dashboard → your domain → right sidebar
tunnel_name           = "line-claude-bot"
subdomain             = "bot"
```

**Getting the API token:**

1. [Cloudflare dashboard](https://dash.cloudflare.com) → top-right avatar → **My Profile**
2. **API Tokens** → **Create Token**
3. Use the **Edit zone DNS** template, then also add:
   - **Account** → *Cloudflare Tunnel* → **Edit**
4. Click **Continue to summary** → **Create Token**
5. Copy the token (shown only once)

**Run Terraform:**

```bash
terraform init
terraform plan     # preview — should show 3 resources
terraform apply    # creates tunnel + DNS record
```

**Get your token and webhook URL:**

```bash
terraform output -raw tunnel_token   # paste into .env as CLOUDFLARE_TUNNEL_TOKEN
terraform output webhook_url         # set this in LINE Developers Console
```

---

## Production Setup (Docker)

### 1. Get CLOUDFLARE_TUNNEL_TOKEN

Follow **Option A** (dashboard) or **Option B** (Terraform) above.  
Make sure `CLOUDFLARE_TUNNEL_TOKEN` is set in `.env` before starting.

### 2. Start with Docker Compose

```bash
docker compose up --build -d

# Check logs
docker compose logs -f bridge
docker compose logs -f tunnel
```

The bridge auto-restarts on reboot (`restart: unless-stopped`).  
Conversation history persists in `./data/conversations.db`.

### 3. Verify

```bash
curl https://<your-subdomain>.<your-domain>/health
# → {"status":"ok"}
```

Send a test message from LINE.

---

## Upgrade: Claude Code Native (Approach C)

The current bridge calls OpenRouter's API. For full Claude Code tool use (file access, bash, MCP) through LINE, see `docs/designs/line-claude-bridge.md` — "Approach C" section.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `linebot.v3` import error | Install `line-bot-sdk>=3.0.0`, not `linebot.v3` |
| Webhook verify fails in LINE console | Check `LINE_CHANNEL_SECRET` in `.env` |
| Bot doesn't reply | Check `LINE_CHANNEL_ACCESS_TOKEN`; check `docker compose logs bridge` |
| 429 from OpenRouter | Switch to a faster/free model with `/model qwen/qwen3-coder:free` |
| Tunnel URL changes on restart | Use Terraform-managed tunnel for a permanent subdomain |
| `No matching distribution for linebot.v3` | Use `line-bot-sdk>=3.0.0` in requirements.txt |
