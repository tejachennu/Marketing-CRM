# Business domains on a server that already runs nginx

Our shop server (`stores.magnetora.in`) runs the WAMA shop behind the server's existing nginx. nginx cannot
make certificates by itself, so each business domain is added once with one command.

## Once (WAMA)

In Vercel → project → Settings → Environment Variables add, then deploy:

| Name | Value |
|---|---|
| `STORE_GATEWAY_HOST` | `stores.magnetora.in` |
| `STORE_GATEWAY_IP` | the server's public IP |

This switches on **My own domain** in E-commerce → Website → Store address.

## For each business

1. **Business:** Website → Store address → My own domain → types `shop.theirname.com` → Connect.
2. **Business, at their domain company** (GoDaddy, Hostinger, …), adds the record WAMA shows:
   - `shop.theirname.com` → **CNAME** `shop` → `stores.magnetora.in`
   - `theirname.com` (no `shop.`) → **A** `@` → the server's IP
3. **WAMA, on the server**, once the record works (a few minutes, up to a day):
   ```
   cd /opt/wama-shop && git pull
   sudo bash deploy/nginx/add-store-domain.sh shop.theirname.com you@magnetora.in 3000
   ```
   (3000 = the port the shop runs on; use yours.) The script checks the store connected that domain in
   WAMA and that it points here, adds only its own nginx site, tests nginx, reloads it gently (never a
   restart), and gets the https certificate.
4. **Business:** Check again → **Connected**. The app says Connected only when the domain really opens the
   store over https.

Certificates renew by themselves (certbot's timer). To take a domain off:
`sudo bash deploy/nginx/remove-store-domain.sh shop.theirname.com`.
