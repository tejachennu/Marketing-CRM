# Store server for businesses' own domains (Hostinger)

This small server lets every business open its online store on its own domain (`shop.theirname.com`),
like Shopify. It runs on a **Hostinger VPS with Ubuntu**. The main WAMA app stays where it is.

```
customer → shop.theirname.com → our Hostinger server (Caddy, makes https by itself) → wamacrm.magnetora.in → that business's store
```

No limit on the number of domains, and nothing to register per domain: a business adds one DNS record
and it works.

---

## Part 1: Get the server ready (once)

1. **Buy / open a VPS in Hostinger:** hPanel → **VPS**. Choose the **plain Ubuntu 24.04** template, not a
   template with a control panel or web server. The smallest plan (KVM 1) is more than enough.
2. **Note its IP address:** hPanel → VPS → **Overview** → "IP address", for example `203.0.113.10`.
   Set a root password or add your SSH key on the same page.
3. **Open the firewall:** if you use hPanel → VPS → **Firewall**, allow ports **22, 80 and 443**.
   The setup script also opens them on the server itself.
4. **Give the server a name:** where **magnetora.in**'s DNS is managed (Hostinger hPanel → **Domains** →
   magnetora.in → **DNS / Nameservers**, if it is at Hostinger), add:

   | Type | Name | Points to | TTL |
   |---|---|---|---|
   | A | `stores` | the VPS IP, e.g. `203.0.113.10` | 3600 |

   Businesses will point their domains at **stores.magnetora.in**.

5. **Make a key** (a long random text that lets the app trust the server). On the VPS, run:
   ```
   openssl rand -hex 32
   ```
   Keep it safe. Do not paste it in chats or emails.

## Part 2: Install it on the server (you run this)

Log in to the VPS (hPanel → VPS → **Browser terminal**, or `ssh root@203.0.113.10`) and run:

```
apt-get update -y && apt-get install -y git
git clone --depth 1 -b v4 https://github.com/tejachennu/Marketing-CRM.git /opt/wama
cd /opt/wama/deploy/gateway

export GATEWAY_HOSTNAME=stores.magnetora.in
export APP_URL=https://wamacrm.magnetora.in
export ACME_EMAIL=you@magnetora.in
read -rs -p "Paste the key: " STORE_GATEWAY_KEY && export STORE_GATEWAY_KEY && echo
sudo -E bash setup.sh
```

(If this work is not on `v4` yet, use the branch it is on in place of `v4`.)

The script installs Caddy, opens ports 80/443, saves the settings in `/etc/caddy/gateway.env` (only root
and Caddy can read it), checks the config with `caddy validate`, and starts it. When it ends with
**"Caddy is running."**, open `https://stores.magnetora.in/healthz`. It should say `ok`.

**To update later:**
```
cd /opt/wama && git pull && cd deploy/gateway
set -a; . /etc/caddy/gateway.env; set +a
sudo -E bash setup.sh
```

## Part 3: Tell the WAMA app about the server

In the app's hosting settings (Vercel → project → Settings → Environment Variables), add:

| Name | Value |
|---|---|
| `STORE_GATEWAY_HOST` | `stores.magnetora.in` |
| `STORE_GATEWAY_IP` | the VPS IP |
| `STORE_GATEWAY_KEY` | the same key as on the server |

Then deploy the app once so it picks them up. From then on, **E-commerce → Website → Store address →
My own domain** works for every business.

---

## What a business does

1. Types its domain (for example `shop.glowstore.in`) and taps **Connect**.
2. Adds the one record shown, at its domain company (GoDaddy, Hostinger, …):
   - `shop.glowstore.in` → **CNAME** `shop` → `stores.magnetora.in`
   - `glowstore.in` (no `shop.`) → **A** `@` → the VPS IP
3. Taps **Check again** until it says **Connected**. The first visit makes the https certificate (a few
   seconds).

## How it is kept safe

- Caddy makes a certificate only after asking the app
  `GET /api/public/store-domain-check?domain=…`. The app says yes only for a domain a business has
  connected, so the server cannot be used for anything else.
- The server passes `X-Store-Domain` and `X-Gateway-Key` to the app. The app trusts the domain only with
  the right key (16 or more characters).
- On a business's domain only the store page opens. The dashboard and login never do.

## If something is wrong

| Problem | What to do |
|---|---|
| Setup says "Another program is using port 80 or 443" | The template came with a web server. Run `systemctl disable --now apache2 nginx lshttpd`, or reinstall the VPS with plain Ubuntu 24.04. |
| `https://stores.magnetora.in/healthz` does not open | Check the `A stores` record points to the VPS IP (`dig +short stores.magnetora.in`), and that ports 80/443 are open in hPanel → VPS → Firewall. |
| A business's domain shows a certificate error | Its record does not point at the server yet, or the business connected a slightly different name (with or without `www.`). |
| See what is happening | `systemctl status caddy`, `journalctl -u caddy -n 100`, and `/var/log/caddy/stores.log` |

## Optional: one-click updates from GitHub

`.github/workflows/deploy-gateway.yml` can run the same setup from GitHub (Actions → "Deploy store
gateway" → Run workflow). It runs only when started by hand. For it, add in GitHub → Settings → Secrets
and variables → Actions: secrets `GATEWAY_SSH_HOST` (VPS IP), `GATEWAY_SSH_USER` (`root`),
`GATEWAY_SSH_KEY` (a private SSH key whose public key is on the VPS), `STORE_GATEWAY_KEY` and
`ACME_EMAIL`. Also add the variable `GATEWAY_HOSTNAME` = `stores.magnetora.in`. You do not need this if
you update by hand as in Part 2.
