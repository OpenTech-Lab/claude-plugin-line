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
LINE Push Message API  → LINE User / Group
```

## Prerequisites

- [Bun](https://bun.sh) runtime (`curl -fsSL https://bun.sh/install | bash`)
- [Claude Code](https://claude.ai/code) CLI installed and authenticated
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

### 3. Expose port 8000 via Cloudflare Tunnel

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
   cloudflared tunnel run --protocol http2 --token <your_tunnel_token>
   ```

Your webhook URL: `https://bot.yourdomain.com/webhook`

**Option B — Terraform (infrastructure as code)**

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars with your Cloudflare API token, account ID, zone ID
terraform init && terraform apply
terraform output webhook_url   # set this in LINE console
```

Start the tunnel:
```bash
cloudflared tunnel run --protocol http2 --token $(terraform output -raw tunnel_token)
```

**Option C — Quick tunnel (testing only, URL changes on restart)**

```bash
cloudflared tunnel --url http://localhost:8000
# Prints: https://something.trycloudflare.com
```

### 4. Set the LINE webhook URL

1. [LINE Developers Console](https://developers.line.biz) → your channel → **Messaging API** tab
2. **Webhook URL**: `https://bot.yourdomain.com/webhook`
3. Click **Verify** — should return success
4. Enable **Use webhook**

### 5. Start the LINE channel listener

In a **dedicated terminal**, run:

```bash
claude --dangerously-skip-permissions --dangerously-load-development-channels plugin:line@personal
```

This starts Claude Code in channel-only mode — no interactive session, just LINE message handling. Leave this terminal running.

Verify the MCP server is up:

```bash
curl http://localhost:8000/health
# → {"status":"ok"}
```

> **Note:** `--dangerously-load-development-channels` both registers the channel **and** bypasses the plugin allowlist. Pass the channel name to this flag only — do **not** also pass `--channels`, which creates a duplicate non-dev entry that fails with "not on the approved channels allowlist". The `allowedChannelPlugins` setting in settings.json is enterprise-only and has no effect for personal plugins.

### 6. Pair your LINE account

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

## Two ways to run

Both modes bind **port 8000**, so the Cloudflare tunnel and LINE webhook URL
never change. Run exactly one at a time — the second process fails fast with
`EADDRINUSE` if the other is still up. The `line-tunnel` pm2 process must keep
running in both modes; it carries the webhook traffic.

### Production: pm2 bridge (multi-tenant FastAPI)

```bash
pm2 start line-bridge
```

Auto-starts on boot (`pm2-toyofumi.service`). Per-tenant personas, guardrails,
and the dashboard all run through this path.

### Terminal: interactive Claude Code session

```bash
pm2 stop line-bridge
claude --dangerously-skip-permissions --dangerously-load-development-channels plugin:line@personal
```

LINE messages arrive directly in the Claude Code session (same as the official
Telegram channel). When done, restore production mode:

```bash
pm2 start line-bridge
```

---

## Group chats

### Enable group support in LINE console

Before adding the bot to a group, make sure **"Allow bot to join group chats"** is enabled:

1. [LINE Developers Console](https://developers.line.biz) → your channel → **Messaging API** tab
2. **Features** section → **Group and multi-person chats** → enable

### Add the bot to a group

1. Open LINE → the group → Members → Invite → select your bot
2. Send any message in the group
3. The bot sends you a **personal DM** with the group ID and the exact command to run:

```
Unknown group wants to chat:
Group ID: C1234567890abcdef

Run in Claude Code terminal:
/line:access allow-group C1234567890abcdef
```

4. Run that command in Claude Code:

```
/line:access allow-group C1234567890abcdef
```

By default the bot only responds when @mentioned (`groupTrigger: mention`). Change this with:

```
/line:access group-trigger all      # respond to every message
/line:access group-trigger prefix   # only messages starting with !
/line:access group-prefix /ask      # custom prefix
```

---

## Slash Commands

| Command | Effect |
|---------|--------|
| `/line:configure` | Show credentials status and access summary |
| `/line:configure <secret> <token>` | Save LINE credentials |
| `/line:access` | Show who's paired, DM policy, and group allowlist |
| `/line:access pair <code>` | Approve a pairing request |
| `/line:access deny <code>` | Reject a pairing request |
| `/line:access allow <userId>` | Add a LINE userId directly |
| `/line:access remove <userId>` | Remove from DM allowlist |
| `/line:access policy pairing\|allowlist\|disabled` | Change DM policy |
| `/line:access allow-group <groupId>` | Add a LINE group to the group allowlist |
| `/line:access remove-group <groupId>` | Remove a group from the allowlist |
| `/line:access group-trigger mention\|all\|prefix` | Set group trigger mode |
| `/line:access group-prefix <string>` | Set prefix for `prefix` trigger mode |

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

### Group trigger modes

| Mode | Behavior |
|------|----------|
| `mention` (default) | Only when the bot is @mentioned |
| `all` | Every message in the group |
| `prefix` | Only messages starting with the configured prefix (default `!`) |

---

## State Files

All state lives in `~/.claude/channels/line/` (outside this repo):

| File | Contents |
|------|----------|
| `.env` | LINE credentials (chmod 600) |
| `access.json` | DM policy, allowlist, pending pairings, group allowlist + trigger |
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
| `LINE_DEBUG` | — | Set to `1` to log all webhook payloads to `debug.log` |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Webhook verify fails in LINE console | Check `LINE_CHANNEL_SECRET` in `~/.claude/channels/line/.env` |
| Bot doesn't reply | Check `LINE_CHANNEL_ACCESS_TOKEN`; check that the channel listener is running |
| Server not starting | Run `bun install` in this directory; check `bun --version` ≥ 1.0 |
| Port 8000 already in use | Kill the old process: `lsof -ti :8000 \| xargs kill` |
| `curl /health` returns nothing | Channel listener not running; see step 5 |
| Bot receives messages but never replies | Channel listener not running; see step 5 |
| `not on the approved channels allowlist` | Pass the channel to `--dangerously-load-development-channels` **only** — no separate `--channels` flag |
| `entries must be tagged` | The channel name must come right after `--dangerously-load-development-channels` with no flags in between |
| QUIC timeout errors in cloudflared | Add `--protocol http2` to force TCP |
| Pairing code not received | Check tunnel is running and webhook URL is set + verified in LINE console |
| Bot added to group but no response | Check "Allow bot to join group chats" is enabled in LINE Developers Console; run `/line:access allow-group <id>` |
| Group ID unknown | Send any message in the group — the bot sends you a personal DM with the group ID |
| `access.json corrupt` warning | Server moved bad file to `access.json.corrupt-<timestamp>` and reset; re-pair |
