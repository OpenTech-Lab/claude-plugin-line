resource "cloudflare_zero_trust_tunnel_cloudflared" "bot" {
  account_id = var.cloudflare_account_id
  name       = var.tunnel_name
  secret     = base64encode(random_password.tunnel_secret.result)
}

resource "random_password" "tunnel_secret" {
  length  = 32
  special = false
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "bot" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.bot.id

  config {
    ingress_rule {
      hostname = "${var.subdomain}.${data.cloudflare_zone.domain.name}"
      service  = "http://localhost:8000"
    }
    ingress_rule {
      service = "http_status:404"
    }
  }
}

data "cloudflare_zone" "domain" {
  zone_id = var.cloudflare_zone_id
}
