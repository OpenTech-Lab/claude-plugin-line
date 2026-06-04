variable "cloudflare_api_token" {
  description = "Cloudflare API token with Zero Trust and DNS edit permissions"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for your domain"
  type        = string
}

variable "tunnel_name" {
  description = "Name for the Cloudflare Tunnel"
  type        = string
  default     = "line-claude-bot"
}

variable "subdomain" {
  description = "Subdomain for the bot webhook (e.g. 'bot' → bot.yourdomain.com)"
  type        = string
  default     = "bot"
}
