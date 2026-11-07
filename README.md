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
claude --dangerously-skip-permissions --settings '{"enabledPlugins":{"line@personal":true}}' --dangerously-load-development-channels plugin:line@personal
```

This starts Claude Code in channel-only mode — no interactive session, just LINE message handling. Leave this terminal running.

Verify the MCP server is up:

```bash
curl http://localhost:8000/health
# → {"status":"ok"}
```

> **Note:** `--dangerously-load-development-channels` both registers the channel **and** bypasses the plugin allowlist. Pass the channel name to this flag only — do **not** also pass `--channels`, which creates a duplicate non-dev entry that fails with "not on the approved channels allowlist". The `allowedChannelPlugins` setting in settings.json is enterprise-only and has no effect for personal plugins.
>
> `line@personal` stays **disabled** in `~/.claude/settings.json` so ordinary Claude sessions don't each spawn a server on port 8000. The channel flag does not enable a disabled plugin — without the `--settings` override the session starts, but the LINE MCP server never launches and nothing listens on 8000.

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
claude --dangerously-skip-permissions --settings '{"enabledPlugins":{"line@personal":true}}' --dangerously-load-development-channels plugin:line@personal
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

## Shared chats (pm2 bridge, Claude mode)

Everyone in a chat reads the bot's reply, so what a Claude-mode run may draw
on depends on who is in the chat.

**The rule.** A chat is `OWNER` only when it is a 1:1 chat and the sender and
the chat are both `CLAUDE_OWNER_USER_ID`. Every other chat (a group, a room,
or anyone else's 1:1) is `SHARED`. If `CLAUDE_OWNER_USER_ID` is unset, every
chat is `SHARED`. `CLAUDE_ALLOWED_USERS` still decides who may trigger claude
at all; an empty list allows everyone.

**Operator groups.** A group or room listed in `CLAUDE_OPERATOR_CHATS` gives
the owner's own messages the full `OWNER` setup there too (tools, MCP, memory,
files), and the prompt notes that other people read the reply. Anything those
tools return can appear in the group, so list only groups whose members may
see it. Other members' messages stay `SHARED`, and they still can't trigger
claude unless they are in `CLAUDE_ALLOWED_USERS`.

| | `OWNER` | `SHARED` |
|---|---|---|
| Tools, MCP servers, skills, hooks, CLAUDE.md | Your normal setup | None |
| OpenMemory (`MEMORY_ENABLED`) | Yes | Never |
| Tenant knowledge base (dashboard) | No | Yes |
| History | This chat's | This chat's |
| Login | Your normal `claude` login | `CLAUDE_SHARED_OAUTH_TOKEN` |
| Model in the bridge's log | `claude-code-local` | `claude-code-shared` |

**Launch profile.** A shared run is enforced by how `claude` is started, not by
prompt text:

```
claude --print --output-format text --no-session-persistence --restricted
  --permission-prompts none --setting-sources "" --strict-mcp-config
  --mcp-config '{"mcpServers":{}}' --tools "" --disable-slash-commands
  --system-prompt <fixed shared prompt> [--model $CLAUDE_CODE_MODEL] [--effort $CLAUDE_CODE_EFFORT]
cwd = $CLAUDE_SHARED_DIR/home   (empty, mode 700)
env = a new environment; nothing is copied from the bridge's:
  PATH=/usr/local/bin:/usr/bin:/bin  HOME=$CLAUDE_SHARED_DIR/home  LANG=C.UTF-8
  CLAUDE_CONFIG_DIR=$CLAUDE_SHARED_DIR/config
  CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_SHARED_OAUTH_TOKEN
  CLAUDE_CODE_DISABLE_ATTACHMENTS=1  CLAUDE_CODE_DISABLE_CLAUDE_MDS=1
  CLAUDE_CODE_DISABLE_AUTO_MEMORY=1  ENABLE_CLAUDEAI_MCP_SERVERS=false
  DISABLE_AUTOUPDATER=1
```

The prompt on stdin is the tenant persona, the tenant's knowledge base, this
chat's recent history, and the message. Create the token with
`claude setup-token` and store it as `CLAUDE_SHARED_OAUTH_TOKEN`. Never name it
`CLAUDE_CODE_OAUTH_TOKEN` in the bridge's environment: the owner's run
inherits that environment and would switch logins.

The run fails closed, and the chat gets `SHARED_UNAVAILABLE_MESSAGE`, when the
token is unset, `claude` is not on `PATH`, or
`$CLAUDE_SHARED_DIR/config/.claude.json` holds an account profile
(`oauthAccount`) or can't be read. The file is checked again after the run; if
a profile appeared, the reply is thrown away. Each shared run logs the resolved
`claude` binary, so auto-updates show up in the logs.

**Contract for other channels.** A channel that runs `claude` for a chat
should resolve an audience the same way (`OWNER` only for the owner's own 1:1
or an explicitly listed operator group, `SHARED` otherwise, `SHARED` when unsure) and pass it explicitly. In this
bridge, `_call_claude_code(..., audience=..., tenant_id=...)` has no default
for either, so no caller can fall into `OWNER` by omission, and a `SHARED` run
takes its argv, cwd and environment from `_shared_launch()`.

**End-to-end check.** The isolation leans on undocumented
`CLAUDE_CODE_DISABLE_*` switches, so re-run this after every `claude` update.
It plants marker words in CLAUDE.md and AGENTS.md files, a SessionStart hook
and a file outside the sandbox, then makes three real runs on the shared login:

```bash
LINE_BRIDGE_E2E=1 venv/bin/python -m pytest -q tests/test_shared_isolation_e2e.py
```

It is skipped unless `LINE_BRIDGE_E2E=1` and `CLAUDE_SHARED_OAUTH_TOKEN` are set.

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

The pm2 bridge in Claude mode (`CLAUDE_MODE=true`) also reads:

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_CODE_MODEL` | — | `--model` for every claude run (owner and shared), e.g. `claude-opus-5-5`. Empty uses claude's default |
| `CLAUDE_CODE_EFFORT` | — | `--effort` for every claude run: `low`, `medium`, `high`, `xhigh` or `max`. Empty uses the owner's settings (owner runs) or claude's default (shared runs). Subagents keep the effort in their own definitions |
| `CLAUDE_TIMEOUT_S` | `1200` | Seconds a `claude --print` run may take before it and its tool processes are stopped |
| `CLAUDE_REPLY_WINDOW_S` | `45` | A run still going after this gets a free "working on it" reply, and its answer is sent by push (counts toward the monthly message quota). LINE guarantees reply tokens for one minute only |
| `CLAUDE_ALLOWED_USERS` | — | Comma-separated LINE userIds allowed to trigger claude. Empty allows everyone |
| `CLAUDE_OWNER_USER_ID` | — | Your LINE userId. Only your own 1:1 chat gets the full setup; unset makes every chat shared. See [Shared chats](#shared-chats-pm2-bridge-claude-mode) |
| `CLAUDE_OPERATOR_CHATS` | — | Comma-separated group/room ids where your own messages also get the full setup. Other members read those replies |
| `CLAUDE_SHARED_OAUTH_TOKEN` | — | Token from `claude setup-token`, used only for shared chats. Unset means shared chats get `SHARED_UNAVAILABLE_MESSAGE` |
| `CLAUDE_SHARED_DIR` | `~/.local/state/line-claude-bridge/shared` | Empty home and config directory for shared runs; keep it outside any repo |
| `SHARED_UNAVAILABLE_MESSAGE` | `The assistant is not available in this chat right now.` | Reply sent when a shared run is refused |

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
