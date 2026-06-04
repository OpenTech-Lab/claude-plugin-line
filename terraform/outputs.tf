output "webhook_url" {
  description = "Set this as your LINE webhook URL in the LINE Developers Console"
  value       = "https://${var.subdomain}.${data.cloudflare_zone.domain.name}/webhook"
}

output "tunnel_token" {
  description = "Set CLOUDFLARE_TUNNEL_TOKEN in .env to this value"
  value       = cloudflare_zero_trust_tunnel_cloudflared.bot.tunnel_token
  sensitive   = true
}

output "tunnel_id" {
  description = "Cloudflare Tunnel ID"
  value       = cloudflare_zero_trust_tunnel_cloudflared.bot.id
}
