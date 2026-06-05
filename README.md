# LINE Channel for Claude Code

Chat with Claude directly from LINE — messages relay through Claude Code via MCP, giving you full tool use (file access, bash, web search) in your LINE conversations.

## Architecture

```
LINE User (mobile)
    │
    ▼
LINE Messaging API
    │  POST /webhook
    ▼
Cloudflare Tunnel → localhost:8000
    │
    ▼
server.ts  (Bun + MCP stdio)
    ├── HTTP webhook server  — validates LINE signature, routes events
    ├── MCP notifications    — delivers messages to Claude Code
    └── MCP tools            — reply, download_attachment
    │
    ▼
Claude Code  (full tool use, conversation, reasoning)
    │
    ▼
LINE Push Message API  → LINE User
```

## Prerequisites

- [Bun](https://bun.sh) runtime (`curl -fsSL https://bun.sh/install | bash`)
- [Claude Code](https://claude.ai/code) CLI installed and running
- [LINE Developers account](https://developers.line.biz) with a Messaging API channel
- A public HTTPS URL pointing to `localhost:8000` — Cloudflare Tunnel works well (see below)

---

## Setup

### 1. Get your LINE credentials

1. Go to [LINE Developers Console](https://developers.line.biz)
2. Select your Messaging API channel
3. **Basic settings** tab → copy **Channel secret** → this is `LINE_CHANNEL_SECRET`
4. **Messaging API** tab → **Channel access token** → click **Issue** → copy → this is `LINE_CHANNEL_ACCESS_TOKEN`

### 2. Save credentials

Run in Claude Code:

```
/line:configure <LINE_CHANNEL_SECRET> <LINE_CHANNEL_ACCESS_TOKEN>
```

This writes credentials to `~/.claude/channels/line/.env` (chmod 600).

Or create the file manually:

```bash
mkdir -p ~/.claude/channels/line
cat > ~/.claude/channels/line/.env << 'EOF'
LINE_CHANNEL_SECRET=your_secret_here
LINE_CHANNEL_ACCESS_TOKEN=your_token_here
EOF
chmod 600 ~/.claude/channels/line/.env
```

### 3. Register the MCP server

Add to `~/.claude/claude.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "line": {
      "command": "bun",
      "args": ["run", "--cwd", "/path/to/this/directory", "--shell=bun", "start"]
    }
  }
}
```

Replace `/path/to/this/directory` with the absolute path to this folder.

### 4. Expose port 8000 via Cloudflare Tunnel

The LINE Messaging API requires a public HTTPS webhook URL. Cloudflare Tunnel routes LINE's HTTPS requests to `localhost:8000` on your machine.

**Option A — Cloudflare Dashboard (recommended)**

1. Install `cloudflared`:
   ```bash
   # Linux (amd64)
   wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
   chmod +x cloudflared-linux-amd64
   sudo mv cloudflared-linux-amd64 /usr/local/bin/cloudflared
   ```

2. Go to [https://one.dash.cloudflare.com](https://one.dash.cloudflare.com) → **Networks** → **Tunnels** → **Create a tunnel**
3. Name it `line-claude-bot`, copy the token from the install command shown
4. Add a **Public Hostname**: subdomain `bot`, your domain, service `HTTP`, URL `localhost:8000`
5. Start the tunnel:
   ```bash
   cloudflared tunnel run --token <your_tunnel_token>
   ```

Your webhook URL: `https://bot.yourdomain.com/webhook`

**Option B — Terraform (infrastructure as code)**

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars with your Cloudflare API token, account ID, zone ID
terraform init && terraform apply
terraform output webhook_url      # set this in LINE console
terraform output -raw tunnel_token | cloudflared tunnel run --token -
```

**Option C — Quick tunnel (testing only, URL changes on restart)**

```bash
cloudflared tunnel --url http://localhost:8000
# Prints: https://something.trycloudflare.com
```

### 5. Set the LINE webhook URL

1. [LINE Developers Console](https://developers.line.biz) → your channel → **Messaging API** tab
2. **Webhook URL**: `https://bot.yourdomain.com/webhook`
3. Click **Verify** — should return success
4. Enable **Use webhook**

### 6. Restart Claude Code

The MCP server starts automatically. Verify it's running:

```bash
curl http://localhost:8000/health
# → {"status":"ok"}
```

### 7. Pair your LINE account

Message your LINE bot from your phone. It replies with a pairing code:

```
Pairing required — run this in your Claude Code terminal:

/line:access pair a1b2c3
```

Run the command in Claude Code. Within 5 seconds your LINE app shows:

```
Paired! Say hi to Claude.
```

You're ready — send messages from LINE and Claude Code responds.

---

## Slash Commands

Once the MCP server is running, manage access from Claude Code:

| Command | Effect |
|---------|--------|
| `/line:configure` | Show credentials status and access summary |
| `/line:configure <secret> <token>` | Save LINE credentials |
| `/line:access` | Show who's paired and DM policy |
| `/line:access pair <code>` | Approve a pairing request |
| `/line:access deny <code>` | Reject a pairing request |
| `/line:access allow <userId>` | Add a LINE userId directly |
| `/line:access remove <userId>` | Remove from allowlist |
| `/line:access policy pairing\|allowlist\|disabled` | Change DM policy |

### DM policies

| Policy | Behavior |
|--------|----------|
| `pairing` (default) | Unknown senders get a pairing code; approved senders reach Claude |
| `allowlist` | Only explicitly allowed userIds; unknown senders silently dropped |
| `disabled` | All inbound messages dropped |

After pairing everyone you want, lock it down:
```
/line:access policy allowlist
```

---

## State Files

All state lives in `~/.claude/channels/line/` (outside this repo):

| File | Contents |
|------|----------|
| `.env` | LINE credentials (chmod 600) |
| `access.json` | DM policy, allowlist, pending pairings |
| `inbox/` | Downloaded media attachments |
| `approved/` | Transient pairing approval markers |

---

## Message Types

The server relays these LINE message types to Claude Code:

| Type | What Claude sees |
|------|-----------------|
| Text | The message text |
| Image | `(image)` + `image_path` pointing to downloaded file |
| Video | `(video)` + `attachment_message_id` for download |
| Audio | `(audio)` + `attachment_message_id` |
| File | `(file: filename.ext)` + `attachment_message_id` |

Use the `download_attachment` MCP tool to fetch video/audio/file to the local inbox.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LINE_CHANNEL_SECRET` | — | Required. From LINE Developers Console |
| `LINE_CHANNEL_ACCESS_TOKEN` | — | Required. From LINE Developers Console |
| `LINE_WEBHOOK_PORT` | `8000` | HTTP port for webhook server |
| `LINE_STATE_DIR` | `~/.claude/channels/line` | State directory |
| `LINE_ACCESS_MODE` | — | Set to `static` to lock access.json at boot |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Webhook verify fails in LINE console | Check `LINE_CHANNEL_SECRET` in `~/.claude/channels/line/.env` |
| Bot doesn't reply | Check `LINE_CHANNEL_ACCESS_TOKEN`; check Claude Code MCP server logs |
| Server not starting | Run `bun install` in this directory; check `bun --version` ≥ 1.0 |
| Port 8000 already in use | Stop old Python bridge: `pkill -f uvicorn` or `docker compose stop` |
| `curl /health` returns nothing | Claude Code session not started; MCP server hasn't launched yet |
| Pairing code not received | Check Cloudflare tunnel is running and webhook URL is set in LINE console |
| `access.json corrupt` warning | The server moved the bad file to `access.json.corrupt-<timestamp>` and reset; re-pair |
