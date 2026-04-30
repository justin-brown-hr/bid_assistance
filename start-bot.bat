@echo off
cd /d "C:\Program Files\Notification\Notification"
pm2 start dist/index.js --name freelancer-bot
pm2 save
