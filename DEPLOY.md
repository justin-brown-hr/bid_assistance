# VPS Deployment Guide — noirehaven.com

Production host: **noirehaven.com** → VPS `82.38.44.49`  
App path (typical): `/home/user/work/bid_assistance`  
Reverse proxy: nginx site `noirehaven.com` (sample in `deploy/nginx-noirehaven.conf`)  
Dashboard port: **3030** (PM2 process `freelancer-helper`)

## Architecture

```
Browser → nginx (noirehaven.com) → 127.0.0.1:3030 (Node / PM2)
```

SSE (`/events`) needs long proxy timeouts — see [`deploy/nginx-noirehaven.conf`](deploy/nginx-noirehaven.conf).

## 1. VPS prerequisites (Ubuntu)

```bash
sudo apt update && sudo apt upgrade -y

# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Chrome (Freelancer login / scrape)
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update
sudo apt install -y google-chrome-stable

# Nginx + Certbot
sudo apt install -y nginx certbot python3-certbot-nginx

sudo npm install -g pm2
```

Do **not** set `HEADLESS=false` on VPS for normal runs (use headless Chrome).

## 2. App install / update

```bash
cd /home/user/work/bid_assistance
git pull
cp -n .env.example .env   # first time only
nano .env                 # set secrets; DASHBOARD_PORT=3030

npm install
**npm run build**   ← required every update (`dist/` is gitignored)

pm2 start ecosystem.config.cjs
# or after updates:
pm2 restart freelancer-helper

Or run the helper script:

```bash
chmod +x scripts/vps-update.sh
./scripts/vps-update.sh
```
pm2 save
pm2 startup   # once, follow printed command
```

## 3. Nginx (bid_assistance / sites)

Copy the sample site config:

```bash
sudo cp /home/user/work/bid_assistance/deploy/nginx-noirehaven.conf \
  /etc/nginx/sites-available/noirehaven.com
sudo ln -sf /etc/nginx/sites-available/noirehaven.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

If an older router project previously managed nginx, use this same site file (or merge the `proxy_pass` / SSE settings into that config).

## 4. DNS

Point A records:

- `noirehaven.com` → `82.38.44.49`
- `www.noirehaven.com` → `82.38.44.49` (optional)

## 5. HTTPS

```bash
sudo certbot --nginx -d noirehaven.com -d www.noirehaven.com
```

After certbot, confirm `/events` still has `proxy_buffering off` and long `proxy_read_timeout`.

## 6. Slack OAuth (production)

In the Slack app → **OAuth & Permissions → Redirect URLs**, add:

```
https://noirehaven.com/api/slack/oauth/callback
```

The app uses `X-Forwarded-Proto` / `Host` to build the redirect URI.

## 7. Smoke tests

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://noirehaven.com/
curl -sS https://noirehaven.com/api/me
# EventSource: open browser DevTools → Network → /events should stay open
pm2 logs freelancer-helper --lines 50
```

## 8. Browser alerts

Logged-in users on the Projects page get:

- Desktop **Notification** (allow when prompted)
- In-page **toast**
- Short **beep**

when a new project arrives over SSE.

## 9. Troubleshooting

**Analytics tab missing / Projects page broken after `git pull`**

`dist/` is **not** in git. PM2 runs `dist/index.js`, and the HTML shell (nav links, CSS) comes from compiled `dist/dashboardServer.js`.  
`app.js` is read from `src/` at runtime, so a pull can leave **new frontend + old backend** until you build.

On the VPS:

```bash
cd /home/user/work/bid_assistance
npm run build
pm2 restart freelancer-helper
curl -sS http://127.0.0.1:3030/ | grep headerAnalyticsLink
```

The last command should print `headerAnalyticsLink`. If it does not, the build did not update `dist/`.

```bash
pm2 status
pm2 logs freelancer-helper --err
sudo nginx -t
sudo journalctl -u nginx -n 50
```

**Chrome not found:** ensure `google-chrome-stable` is on `PATH`.

**Session / CAPTCHA:** check Freelancer credentials in `.env`; rare CAPTCHA may need a one-off visible login.
