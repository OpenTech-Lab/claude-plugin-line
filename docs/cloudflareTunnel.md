**Cloudflare Tunnel is free** for personal and most light-use cases.

### Cloudflare Tunnel (cloudflared) — Free Tier Summary (2026)

| Feature                    | Free Tier                          | Notes |
|---------------------------|------------------------------------|-------|
| Cost                      | **Completely Free**                | No bandwidth charges |
| Persistent URL            | Yes (with your own domain)         | Best feature |
| Random URL (Quick Tunnel) | Yes (`*.trycloudflare.com`)        | Good for testing |
| HTTPS / SSL               | Automatic (Cloudflare)             | Very reliable |
| Bandwidth Limit           | None (practically unlimited)       | Much better than ngrok free |
| Concurrent Requests       | High (no hard limit for normal use)| Good for LINE Bot |
| Custom Domain             | Yes                                | Requires adding domain to Cloudflare |

**Compared to ngrok free tier**: Cloudflare Tunnel is generally **better** for long-term use because:
- No random URL changing every time you restart
- No bandwidth limits
- More stable and secure

---

### How to Set Up Cloudflare Tunnel for Your LINE Bot (Linux)

#### Step 1: Install cloudflared

```bash
# Download latest version
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64

# Make it executable
chmod +x cloudflared-linux-amd64

# Move to /usr/local/bin (recommended)
sudo mv cloudflared-linux-amd64 /usr/local/bin/cloudflared
```

#### Step 2: Quick Test (Temporary URL)

While your FastAPI server is running on port 8000:

```bash
cloudflared tunnel --url http://localhost:8000
```

You will get a URL like:  
`https://random-name.trycloudflare.com`

**Your Webhook URL** becomes:
```
https://random-name.trycloudflare.com/webhook
```

---

#### Step 3: Recommended — Persistent Setup (Custom Subdomain)

This is better for a LINE Bot because the URL **never changes**.

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Add your domain (or use a free subdomain if you have one)
3. Go to **Zero Trust** → **Networks** → **Tunnels**
4. Click **Create a tunnel**
5. Choose **Cloudflared** → Give it a name (e.g. `line-claude-bot`)
6. Follow the instructions to run the command on your Linux machine.

Example command Cloudflare gives you:
```bash
cloudflared tunnel run --token YOUR_TOKEN_HERE
```

7. Then create a **Public Hostname**:
   - Subdomain: `bot` (example)
   - Domain: yourdomain.com
   - Service: `http://localhost:8000`

Final Webhook URL will be:
```
https://bot.yourdomain.com/webhook
```
