# Claude Code with Line Bridge

## Folder Structure
``` bash
line-claude-bot/
├── line_claude_bridge.py          # Main FastAPI Bridge Server
├── .env                           # Environment variables (gitignore this)
├── .env.example
├── requirements.txt               # Python dependencies
├── Dockerfile
├── docker-compose.yml             # Run with docker on server
├── README.md                      # Project documentation
│
├── terraform/                     # All Terraform related files
│   ├── main.tf
│   ├── providers.tf
│   ├── variables.tf
│   ├── terraform.tfvars           # (gitignore this)
│   ├── outputs.tf
│   ├── cloudflare_tunnel.tf
│   └── cloudflare_dns.tf
│
├── scripts/                       # Helper scripts
│   ├── start-bridge.sh
│   └── start-tunnel.sh
│
└── .gitignore
```