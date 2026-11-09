# discordgram

> High-performance bidirectional bridge between Discord servers and Telegram forum supergroups.
> Supports deployment on **Cloudflare Workers** or as a **Standalone Daemon** (Termux / Linux / Raspberry Pi) with 0 open ports and 0 cloud quotas.

> [!TIP]
> **Running on Termux / Raspberry Pi / VPS?** Check out the [Standalone Daemon Guide](standalone/README.md) for 100% outbound, unlimited synchronization without Cloudflare Durable Object limits.

---

## Features

1. Automated Channel Management
   - Automatic topic creation: When a new public text channel is created in Discord, a corresponding forum topic is automatically created in Telegram and paired instantly.
   - Interactive Telegram bot commands:
     - `/sync <DISCORD_CHANNEL_ID>`: Link the current Telegram topic to a Discord channel.
     - `/syncall`: Scan your Discord server and automatically create topics for all public text channels.
     - `/unsync`: Remove the synchronization link for the current topic.
     - `/synclist`: Display all currently synchronized channel pairs.
     - `/synchelp`: Display available commands and usage instructions.
   - Web Management Dashboard: View real-time Gateway status, link existing topics, or unlink channels with one click.

2. Privacy and Security Protections
   - Strict private channel exclusion: Channels with restricted permissions where the `@everyone` role is denied viewing access, as well as staff, moderator, and development channels (such as `pulsar-devs`, `moderator-only`, `raidprotect`, `audit-logs`), are automatically excluded from auto-synchronization and message forwarding.
   - Administrator-only authorization: In Telegram, synchronization commands (`/sync`, `/syncall`, `/unsync`) can only be executed by group administrators or the group creator.
   - Password and ALTCHA authentication: The web dashboard is secured behind a password check and an official ALTCHA Proof-of-Work verification widget, generating HMAC-signed HTTP-Only session cookies.

3. Reply Context Threading
   - When users reply to messages in Discord or Telegram, the bridged message includes a formatted quote containing the original author's name and message preview, preserving conversational context across platforms.

4. Media Synchronization
   - Discord to Telegram: Extracts image, video, and file attachments and delivers them directly via the Telegram Bot API.
   - Telegram to Discord: Fetches media files and uploads them natively as multipart attachments to channel webhooks, keeping your Telegram bot token private.

5. 24/7 Serverless Architecture
   - Maintains a persistent WebSocket connection to the Discord Gateway v10 inside a Cloudflare Durable Object.
   - Automatic reconnects with exponential backoff and scheduled keep-alive alarms.

---

## Project Structure

```
discordgram/
├── src/
│   ├── index.ts        # Primary request router, webhook handlers, and auth checks
│   ├── auth.ts         # ALTCHA challenge verification, password validation, session cookies
│   ├── config.ts       # Shared constants and default fallbacks
│   ├── types.ts        # TypeScript definitions for Discord, Telegram, and Worker env
│   ├── storage.ts      # Persistent channel mapping access via Durable Objects
│   ├── gateway.ts      # Durable Object managing Discord Gateway WebSocket connection
│   ├── status.ts       # Durable Object storing runtime status and dynamic mappings
│   ├── discord.ts      # Discord REST API client, webhook sender, and channel filters
│   ├── telegram.ts     # Telegram Bot API client, topic management, and commands
│   ├── media.ts        # Media extraction, download, and forwarding
│   ├── replies.ts      # Reply quote formatting for HTML and Markdown
│   └── dashboard.ts    # Web control panel interface
├── wrangler.toml       # Cloudflare Workers and Durable Objects configuration
├── package.json        # Dependencies and build scripts
└── tsconfig.json       # TypeScript compiler settings
```

---

## Prerequisites

1. Discord Bot:
   - Created in the Discord Developer Portal.
   - In the Bot tab under Privileged Gateway Intents, enable:
     - Server Members Intent
     - Message Content Intent
   - Required bot permissions in your server:
     - Manage Webhooks
     - Read Messages / View Channels
     - Send Messages

2. Telegram Bot:
   - Created with @BotFather.
   - Added to your Telegram supergroup as an Administrator with permissions:
     - Manage Topics
     - Post Messages

3. Telegram Supergroup:
   - Must have Topics / Forums enabled in group settings.

---

## Configuration

### 1. Variables in `wrangler.toml`

The `wrangler.toml` file contains general settings:

```toml
name = "discordgram"
main = "src/index.ts"
compatibility_date = "2024-04-05"
compatibility_flags = ["nodejs_compat"]

[vars]
# Automatically create Telegram topics when new Discord text channels are created
AUTO_CREATE_TOPICS = "true"
```

### 2. Configure Secrets in Cloudflare

Store sensitive tokens securely using Wrangler secrets:

```bash
# Discord Bot Token
npx wrangler secret put DISCORD_BOT_TOKEN

# Telegram Bot Token
npx wrangler secret put TELEGRAM_BOT_TOKEN

# Optional secret for verifying Telegram webhook requests
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET

# Target Telegram supergroup chat ID (e.g. -100xxxxxxxxxx)
npx wrangler secret put DEFAULT_TELEGRAM_CHAT_ID

# Discord Guild (Server) ID for auto-sync discovery
npx wrangler secret put DISCORD_GUILD_ID

# Web dashboard access password
npx wrangler secret put DASHBOARD_PASSWORD
```

---

## Deployment

1. Install project dependencies:
   ```bash
   npm install
   ```

2. Deploy the Worker to Cloudflare:
   ```bash
   npm run deploy
   ```

3. Register the Telegram Webhook:
   Point Telegram updates to your deployed worker endpoint:
   ```bash
   curl -F "url=https://<YOUR-WORKER-DOMAIN>/telegram/webhook" \
        -F "secret_token=<YOUR_TELEGRAM_WEBHOOK_SECRET>" \
        https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/setWebhook
   ```

4. Initialize Discord Gateway Connection:
   Navigate to `https://<YOUR-WORKER-DOMAIN>/` in your browser, enter your dashboard password, complete the verification, and click "Reconectar Gateway".

---

## Channel Synchronization Guide

You can pair channels using any of the following methods:

### Method 1: Link Existing Topics via Telegram Commands
Navigate to an existing topic in your Telegram supergroup and type:
```
/sync <DISCORD_CHANNEL_ID>
```
The bot will associate that specific topic ID with the Discord channel.

### Method 2: Batch Synchronization
To discover and automatically create topics for all public text channels in your Discord server:
```
/syncall
```
Private channels, moderator chats, and internal development channels are automatically skipped.

### Method 3: Web Dashboard
Open `https://<YOUR-WORKER-DOMAIN>/` in your browser:
1. Enter the Discord Channel ID.
2. In the Telegram Thread ID field, enter an existing topic ID (such as `0` for the General topic), or leave it empty to automatically create a new topic.
3. Click "+ Vincular".

---

## License

MIT
