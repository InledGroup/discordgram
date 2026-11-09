# DiscordGram — Standalone Daemon (Termux / Linux / Raspberry Pi)

A lightweight, 100% outbound, native Node.js bridge connecting **Discord channels** and **Telegram supergroup forum topics**.

---

## 🔒 1. Network & Security Architecture

* **Zero Open Incoming Ports**:
  * **Discord**: Connects via outbound client WebSocket to `wss://gateway.discord.gg`.
  * **Telegram**: Connects via outbound **Long Polling** (`getUpdates`).
* **Zero Exposure**: No open ports, no port forwarding on the router, no public IP required, and no reverse proxy or tunnels (Cloudflare Tunnel, ngrok, etc.).
* **Zero Cloud Quotas / Limits**: Runs natively in local RAM (~40–55 MB), eliminating Cloudflare Durable Objects storage writes, request limits, and duration limits.
* **Zero npm runtime dependencies**: Runs purely on Node.js 20+ native APIs (`globalThis.WebSocket`, `fetch`, `fs`, `path`).

---

## 📱 2. Android / Xiaomi Termux Setup & Battery Optimizations

To keep Termux running 24/7 without being killed by Android or MIUI/HyperOS power management:

### A. Apply via ADB (from connected PC)
```bash
# Whitelist Termux from Android battery optimizations (Doze mode)
adb shell dumpsys deviceidle whitelist +com.termux

# Allow Termux to run continuously in background
adb shell cmd appops set com.termux RUN_IN_BACKGROUND allow
adb shell cmd appops set com.termux RUN_ANY_IN_BACKGROUND allow

# Disable phantom process monitoring (for Android 12+)
adb shell "/system/bin/device_config put activity_manager max_phantom_processes 2147483647" 2>/dev/null || true
adb shell "settings put global settings_enable_monitor_phantom_procs false" 2>/dev/null || true
```

### B. In Android Settings (on the Xiaomi phone)
1. **Apps > Manage Apps > Termux**:
   * **Battery Saver**: Set to *No restrictions*.
   * **Autostart**: Turn *ON*.
2. **Recent Apps Screen**: Long press or pull down on the Termux card and tap the **Lock 🔒 icon** so it is never cleared by "Clean RAM".
3. **In Termux terminal**: Run `termux-wake-lock` (adds a persistent notification keeping the CPU awake).

---

## 🚀 3. Installation Guide

### Step 1: Install Node.js, Git, and PM2
Open Termux (or a Linux / Raspberry Pi terminal) and run:
```bash
pkg update && pkg install -y nodejs-lts git
npm install -g pm2
```

### Step 2: Set up DiscordGram
```bash
mkdir -p ~/discordgram
cd ~/discordgram

# Copy server.js and config.example.json here
cp config.example.json config.json
```

### Step 3: Configure `config.json`
Edit `config.json` (`nano config.json`):
```json
{
  "DISCORD_BOT_TOKEN": "your_discord_bot_token",
  "TELEGRAM_BOT_TOKEN": "your_telegram_bot_token",
  "DEFAULT_TELEGRAM_CHAT_ID": -1001234567890,
  "DISCORD_GUILD_ID": "your_discord_guild_id",
  "AUTO_CREATE_TOPICS": true,
  "channels": {
    "1521481806979797142": {
      "chatId": -1001234567890,
      "threadId": 3,
      "name": "general-español"
    }
  }
}
```

---

## ⚙️ 4. Process Management with PM2

PM2 ensures the bridge runs continuously, restarts automatically if an unhandled network error occurs, and resumes after reboot.

```bash
# Start the bridge
pm2 start ~/discordgram/server.js --name discordgram

# Save PM2 process list to persist across restarts
pm2 save

# Automatically restore PM2 processes whenever Termux opens:
echo 'pm2 resurrect 2>/dev/null' >> ~/.bashrc
```

### Useful Management Commands
| Action | Command |
| :--- | :--- |
| **Check Status & RAM** | `pm2 status` |
| **View Live Logs** | `pm2 logs discordgram` |
| **View Last 50 Logs** | `pm2 logs discordgram --lines 50 --nostream` |
| **Restart Bridge** | `pm2 restart discordgram` |
| **Stop Bridge** | `pm2 stop discordgram` |
| **Monitor CPU / Memory** | `pm2 monit` |

---

## 🔄 5. Managing Channel Mappings

Channel links are saved automatically in `channels.json`.

### Option A: Via Telegram (Admins only)
Inside any Telegram forum topic:
* **Link topic to Discord channel**:
  ```text
  /sync <DISCORD_CHANNEL_ID>
  ```
* **Unlink topic**:
  ```text
  /unlink
  ```
* **Check status**:
  ```text
  /status
  ```

### Option B: Automatic Topic Creation
When `"AUTO_CREATE_TOPICS": true`, whenever a new public text channel is created on Discord, DiscordGram automatically creates a matching forum topic in the Telegram supergroup and links them.
