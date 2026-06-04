#!/bin/bash
# Quick tunnel — generates a random trycloudflare.com URL (no domain needed).
# Use for local testing before Terraform-managed tunnel is set up.
set -e
cloudflared tunnel --url http://localhost:8000
