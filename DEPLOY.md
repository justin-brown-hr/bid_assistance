# VPS Deployment Guide

## 1. VPS Setup (Ubuntu 22.04)

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Install Chrome
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update
sudo apt install -y google-chrome-stable

# Verify installations
node --version  # should be v22.x
google-chrome --version
```

## 2. Upload Project

```bash
# Option A: Git clone
git clone YOUR_REPO_URL /home/ubuntu/freelancer-bot
cd /home/ubuntu/freelancer-bot

# Option B: SCP from local machine
# scp -r E:\Todo\Notification ubuntu@YOUR_VPS_IP:/home/ubuntu/freelancer-bot
```

## 3. Configure Environment

```bash
cd /home/ubuntu/freelancer-bot
cp .env.example .env
nano .env
```

Fill in all values:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `FREELANCER_EMAIL`
- `FREELANCER_PASSWORD`
- `FREELANCER_SEARCH_URLS`

**Important:** Do NOT set `HEADLESS=false` on VPS — leave it unset for headless mode.

## 4. Install Dependencies & Build

```bash
npm install
npm run build
```

## 5. Run with PM2 (24/7 operation)

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start the bot
pm2 start dist/index.js --name freelancer-bot

# View logs
pm2 logs freelancer-bot

# Auto-restart on VPS reboot
pm2 startup
# Copy and run the command PM2 prints
pm2 save
```

## 6. Useful Commands

```bash
# Check status
pm2 status

# View live logs
pm2 logs freelancer-bot --lines 100

# Restart after code changes
pm2 restart freelancer-bot

# Stop
pm2 stop freelancer-bot

# Delete
pm2 delete freelancer-bot
```

## 7. Deploy Updates

When you make code changes locally:

```bash
# On local machine
npm run build
scp -r dist ubuntu@YOUR_VPS_IP:/home/ubuntu/freelancer-bot/

# On VPS
ssh ubuntu@YOUR_VPS_IP
pm2 restart freelancer-bot
```

## 8. Monitoring

The bot sends Telegram alerts for:
- 🚨 Critical errors (crashes, unhandled exceptions)
- ⚠️ WebSocket disconnections (auto-reconnects)
- 📊 Daily report at 1:00 PM (project count summary)

PM2 logs are stored at: `~/.pm2/logs/freelancer-bot-out.log`

## 9. Session Management

- Session auto-refreshes every 5 days
- Session valid for 30 days
- Auto-relogin if session expires (headless, no manual intervention)
- If login fails (rare CAPTCHA), you'll see error in Telegram + PM2 logs

## 10. Troubleshooting

**Bot not starting:**
```bash
pm2 logs freelancer-bot --err
```

**Chrome not found:**
```bash
which google-chrome-stable
# Update CHROME_PATH in src/collect/wsCollector.ts if needed
```

**Session expired and can't auto-login:**
- Check `.env` has correct `FREELANCER_EMAIL` and `FREELANCER_PASSWORD`
- Manually run once with `HEADLESS=false` to see what's blocking login
- Check PM2 logs for CAPTCHA or login errors

**WebSocket keeps disconnecting:**
- Check VPS network stability
- Check PM2 logs for connection errors
- The bot auto-reconnects every 5s — notifications will resume automatically
