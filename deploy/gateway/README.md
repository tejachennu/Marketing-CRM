# Store domain gateway

A small Ubuntu server that lets every business open its online store on its own domain
(`shop.theirname.com`), with no limit on the number of domains. The main app stays on Vercel.

```
customer → shop.theirname.com → gateway (Caddy, makes https on its own) → wamacrm.magnetora.in → that business's store
```

## One-time setup

1. **A server**: any Ubuntu 22.04 or 24.04 machine with a public IP (1 CPU, 1 GB RAM is plenty).
   Add a login user with `sudo`, and an SSH key for it.
2. **Its name**: in magnetora.in's DNS, add an `A` record `stores` → the server's IP.
   (Businesses will point their domains at `stores.magnetora.in`.)
3. **GitHub** → this repository → Settings → Secrets and variables → Actions:
   - Secrets: `GATEWAY_SSH_HOST`, `GATEWAY_SSH_USER`, `GATEWAY_SSH_KEY` (the private key), optional
     `GATEWAY_SSH_PORT`, `STORE_GATEWAY_KEY` (a long random text, at least 16 characters), `ACME_EMAIL`.
   - Variables: `GATEWAY_HOSTNAME` = `stores.magnetora.in`, `APP_URL` = `https://wamacrm.magnetora.in`.
4. **Vercel** → project → Settings → Environment Variables:
   - `STORE_GATEWAY_HOST` = `stores.magnetora.in`
   - `STORE_GATEWAY_IP` = the server's IP
   - `STORE_GATEWAY_KEY` = the same random text as in GitHub
   Then deploy the app so it picks them up.
5. **Run it**: GitHub → Actions → "Deploy store gateway" → Run workflow. It copies `Caddyfile` and
   `setup.sh`, installs Caddy, starts it and checks `https://stores.magnetora.in/healthz`.

Run the workflow again whenever `deploy/gateway/` changes. It is safe to run any number of times.

## How it works

- A business picks **My own domain** in E-commerce → Website → Store address and adds one record:
  `CNAME shop → stores.magnetora.in` (or `A @ → <server IP>` for a root domain).
- The first time someone opens that domain, Caddy asks
  `GET /api/public/store-domain-check?domain=…`. Only a domain a business has connected gets a yes,
  so the gateway never makes certificates for anything else.
- Caddy passes the visit to the app with `X-Store-Domain: <domain>` and `X-Gateway-Key`. The app's
  middleware trusts that header only with the right key, and shows that business's store.
- While `STORE_GATEWAY_HOST` / `STORE_GATEWAY_IP` are set in Vercel, the settings screen shows the
  gateway's records and checks the business's DNS directly. Without them it uses Vercel's domain API
  (`VERCEL_TOKEN`, `VERCEL_PROJECT_ID`), as before.

## If something is wrong

- `sudo systemctl status caddy` and `sudo journalctl -u caddy -n 100` on the server.
- Store visits are logged in `/var/log/caddy/stores.log`.
- A domain shows a certificate error: check its DNS points at the gateway, and that the business has
  connected exactly that domain (with or without `www.`).
