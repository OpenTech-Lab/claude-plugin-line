#!/bin/bash
# Named, Terraform-managed tunnel — routes to the bridge on localhost:8000.
set -e
cd "$(dirname "$0")/.."
CLOUDFLARE_TUNNEL_TOKEN=$(grep -E '^CLOUDFLARE_TUNNEL_TOKEN=' .env | cut -d= -f2-)
exec cloudflared tunnel run --protocol http2 --token "$CLOUDFLARE_TUNNEL_TOKEN"
