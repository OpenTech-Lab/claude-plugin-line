resource "cloudflare_dns_record" "bot" {
  zone_id = var.cloudflare_zone_id
  name    = var.subdomain
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.bot.id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
}
