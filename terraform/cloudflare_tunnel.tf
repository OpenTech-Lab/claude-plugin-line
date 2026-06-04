resource "random_id" "tunnel_secret" {
  byte_length = 32
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "bot" {
  account_id = var.cloudflare_account_id
  name       = var.tunnel_name
  secret     = random_id.tunnel_secret.b64_std
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "bot" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.bot.id

  config {
    ingress_rule {
      hostname = "${var.subdomain}.${var.domain}"
      service  = "http://localhost:8000"
    }
    ingress_rule {
      service = "http_status:404"
    }
  }
}
