/**
 * DiscordGram Standalone Server for Termux / Node.js
 * 
 * 100% Outbound Connections:
 * - Discord Gateway: Outbound WebSocket client
 * - Telegram: Outbound Long Polling (getUpdates)
 * ZERO incoming open ports, 100% secure behind firewall/NAT.
 */

const fs = require("fs");
const path = require("path");

const CONFIG_FILE = path.join(__dirname, "config.json");
const CHANNELS_FILE = path.join(__dirname, "channels.json");

let config = {};
try {
  config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
} catch (err) {
  console.error("FATAL: Could not read config.json:", err);
  process.exit(1);
}

// Load channels mapping
let channelMap = config.channels || {};
if (fs.existsSync(CHANNELS_FILE)) {
  try {
    channelMap = JSON.parse(fs.readFileSync(CHANNELS_FILE, "utf-8"));
  } catch {
    // Keep initial
  }
}

function saveChannels() {
  try {
    fs.writeFileSync(CHANNELS_FILE, JSON.stringify(channelMap, null, 2), "utf-8");
  } catch (err) {
    console.error("Error saving channels.json:", err);
  }
}

// Save initial channels if not yet created
if (!fs.existsSync(CHANNELS_FILE)) {
  saveChannels();
}

const DISCORD_API = "https://discord.com/api/v10";
const TELEGRAM_API = "https://api.telegram.org";

const DISCORD_BOT_TOKEN = config.DISCORD_BOT_TOKEN;
const TELEGRAM_BOT_TOKEN = config.TELEGRAM_BOT_TOKEN;
const DEFAULT_TELEGRAM_CHAT_ID = parseInt(config.DEFAULT_TELEGRAM_CHAT_ID, 10);
const AUTO_CREATE_TOPICS = config.AUTO_CREATE_TOPICS === "true" || config.AUTO_CREATE_TOPICS === true;

console.log("--------------------------------------------------");
console.log("🚀 Starting DiscordGram Standalone Bridge");
console.log(`• Node Version: ${process.version}`);
console.log(`• Default Telegram Supergroup: ${DEFAULT_TELEGRAM_CHAT_ID}`);
console.log(`• Initial Mapped Channels: ${Object.keys(channelMap).length}`);
console.log(`• Auto-create Topics: ${AUTO_CREATE_TOPICS}`);
console.log("--------------------------------------------------");

// --------------------------------------------------------------------------
// HTML / Formatting Helpers
// --------------------------------------------------------------------------
function escapeHtml(s) {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncateText(text, maxLen = 140) {
  const clean = text.replace(/[\r\n]+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 3) + "...";
}

function formatDiscordReplyQuote(referenced) {
  if (!referenced) return "";
  const authorName = referenced.author?.global_name || referenced.author?.username || "User";
  let content = referenced.content ? truncateText(referenced.content) : "";

  if (!content && referenced.attachments && referenced.attachments.length > 0) {
    const isImage = referenced.attachments.some(a => a.content_type?.startsWith("image/"));
    const isVideo = referenced.attachments.some(a => a.content_type?.startsWith("video/"));
    content = isImage ? "[🖼️ Photo]" : isVideo ? "[🎥 Video]" : "[📎 Attachment]";
  }

  if (!content) content = "[Previous message]";
  return `<blockquote><b>↩️ In reply to @${escapeHtml(authorName)}:</b>\n${escapeHtml(content)}</blockquote>\n`;
}

function formatTelegramReplyQuote(replyTo) {
  if (!replyTo || replyTo.forum_topic_created) return "";
  const from = replyTo.from;
  const authorName = from ? (from.first_name + (from.last_name ? ` ${from.last_name}` : "")) : "User";

  let content = replyTo.text || replyTo.caption || "";
  if (content) {
    content = truncateText(content);
  } else if (replyTo.photo && replyTo.photo.length > 0) {
    content = "[🖼️ Photo]";
  } else if (replyTo.video) {
    content = "[🎥 Video]";
  } else if (replyTo.animation) {
    content = "[🎞️ GIF]";
  } else if (replyTo.document) {
    content = `[📎 Document: ${replyTo.document.file_name || "file"}]`;
  } else {
    content = "[Previous message]";
  }

  return `> ↩️ **In reply to @${authorName}:** ${content}\n\n`;
}

// --------------------------------------------------------------------------
// Discord REST API & Webhooks
// --------------------------------------------------------------------------
const webhookCache = new Map();

async function getOrCreateDiscordWebhook(channelId) {
  if (webhookCache.has(channelId)) {
    return webhookCache.get(channelId);
  }

  const res = await fetch(`${DISCORD_API}/channels/${channelId}/webhooks`, {
    headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to list webhooks for channel ${channelId}: ${res.status} ${err}`);
  }

  const list = await res.json();
  const existing = list.find((w) => w.name === "tg-bridge");
  if (existing) {
    const url = `${DISCORD_API}/webhooks/${existing.id}/${existing.token}`;
    webhookCache.set(channelId, url);
    return url;
  }

  const createRes = await fetch(`${DISCORD_API}/channels/${channelId}/webhooks`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "tg-bridge" }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Failed to create webhook in channel ${channelId}: ${createRes.status} ${err}`);
  }

  const created = await createRes.json();
  const url = `${DISCORD_API}/webhooks/${created.id}/${created.token}`;
  webhookCache.set(channelId, url);
  return url;
}

async function sendToDiscord(channelId, content, username, avatarUrl) {
  const webhookUrl = await getOrCreateDiscordWebhook(channelId);
  const payload = { content: content || " " };

  const SUFFIX = " (sent from Telegram)";
  if (username) {
    const maxBase = 32 - SUFFIX.length;
    const base = username.length > maxBase ? username.slice(0, maxBase) : username;
    payload.username = `${base}${SUFFIX}`;
  }

  if (avatarUrl) {
    payload.avatar_url = avatarUrl;
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed sending to Discord webhook: ${res.status} ${err}`);
  }
}

// --------------------------------------------------------------------------
// Telegram API
// --------------------------------------------------------------------------
async function callTelegramApi(method, body = {}) {
  const res = await fetch(`${TELEGRAM_API}/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram API ${method} error ${res.status}: ${err}`);
  }

  return await res.json();
}

async function sendToTelegram(chatId, threadId, text, authorName, replyQuote, mediaUrls = []) {
  let bodyText = escapeHtml(text || "");
  let header = "";
  if (authorName) {
    header = `<b>${escapeHtml(authorName)}</b> (sent from Discord):\n`;
  }

  const quote = replyQuote || "";
  let finalContent = `${quote}${header}${bodyText}`.trim();

  if (mediaUrls.length > 0) {
    const mediaBlock = mediaUrls.join("\n");
    finalContent = finalContent ? `${finalContent}\n\n${mediaBlock}` : mediaBlock;
  }

  if (!finalContent) return;

  const payload = {
    chat_id: chatId,
    text: finalContent,
    parse_mode: "HTML",
    disable_web_page_preview: false,
  };

  if (threadId && threadId !== 0) {
    payload.message_thread_id = threadId;
  }

  await callTelegramApi("sendMessage", payload);
}

async function createTelegramForumTopic(chatId, name) {
  const cleanName = (name || "New Topic").slice(0, 128);
  const data = await callTelegramApi("createForumTopic", {
    chat_id: chatId,
    name: cleanName,
  });
  return {
    threadId: data.result.message_thread_id,
    name: data.result.name,
  };
}

async function getTelegramUserAvatar(user) {
  try {
    const photos = await callTelegramApi("getUserProfilePhotos", { user_id: user.id, limit: 1 });
    const first = photos.result?.photos?.[0]?.[0]?.file_id;
    if (!first) return null;

    const file = await callTelegramApi("getFile", { file_id: first });
    const filePath = file.result?.file_path;
    if (!filePath) return null;

    return `${TELEGRAM_API}/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// Channel Mapping Helpers
// --------------------------------------------------------------------------
function findDiscordChannelForTelegram(chatId, threadId) {
  const tId = threadId || 0;
  for (const [discordId, target] of Object.entries(channelMap)) {
    const targetChat = target.chatId;
    const targetThread = target.threadId || 0;
    if (targetChat === chatId && targetThread === tId) {
      return discordId;
    }
  }
  return null;
}

function findTelegramTargetForDiscord(channelId) {
  return channelMap[channelId] || null;
}

// --------------------------------------------------------------------------
// Telegram Long Polling Loop
// --------------------------------------------------------------------------
async function startTelegramPolling() {
  console.log("📡 Initializing Telegram Long Polling...");
  try {
    // Delete existing webhook so getUpdates works
    await callTelegramApi("deleteWebhook", { drop_pending_updates: false });
    console.log("✅ Telegram webhook cleared. Long Polling ready.");
  } catch (err) {
    console.warn("Notice clearing webhook:", err.message);
  }

  let offset = 0;

  async function poll() {
    try {
      const url = `${TELEGRAM_API}/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${offset}&timeout=30&allowed_updates=["message","edited_message"]`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`getUpdates status ${res.status}`);
      }

      const data = await res.json();
      const updates = data.result || [];

      for (const update of updates) {
        offset = update.update_id + 1;
        const msg = update.message || update.edited_message;
        if (!msg) continue;

        // Skip bot's own messages
        if (msg.from && msg.from.is_bot) continue;

        await handleTelegramIncomingMessage(msg);
      }
    } catch (err) {
      console.error("Polling error (will retry in 3s):", err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }

    setImmediate(poll);
  }

  poll();
}

async function handleTelegramIncomingMessage(msg) {
  const chatId = msg.chat.id;
  const threadId = msg.message_thread_id || 0;
  const text = msg.text || msg.caption || "";

  // 1. Check for Admin commands (/sync, /status, /link)
  if (text.startsWith("/")) {
    const handled = await handleTelegramCommand(msg, text, chatId, threadId);
    if (handled) return;
  }

  // 2. Find mapped Discord channel
  const discordChannelId = findDiscordChannelForTelegram(chatId, threadId);
  if (!discordChannelId) {
    return; // Not mapped
  }

  const from = msg.from;
  const username = from
    ? `${from.first_name || ""}${from.last_name ? " " + from.last_name : ""}`.trim() || from.username || "TelegramUser"
    : "TelegramUser";

  const replyQuote = formatTelegramReplyQuote(msg.reply_to_message);
  let content = `${replyQuote}${text}`.trim();

  // Handle Telegram Media
  const mediaUrls = [];
  if (msg.photo && msg.photo.length > 0) {
    const largest = msg.photo[msg.photo.length - 1];
    try {
      const file = await callTelegramApi("getFile", { file_id: largest.file_id });
      if (file.result?.file_path) {
        mediaUrls.push(`${TELEGRAM_API}/file/bot${TELEGRAM_BOT_TOKEN}/${file.result.file_path}`);
      }
    } catch {}
  }
  if (msg.document) {
    try {
      const file = await callTelegramApi("getFile", { file_id: msg.document.file_id });
      if (file.result?.file_path) {
        mediaUrls.push(`${TELEGRAM_API}/file/bot${TELEGRAM_BOT_TOKEN}/${file.result.file_path}`);
      }
    } catch {}
  }
  if (msg.video) {
    try {
      const file = await callTelegramApi("getFile", { file_id: msg.video.file_id });
      if (file.result?.file_path) {
        mediaUrls.push(`${TELEGRAM_API}/file/bot${TELEGRAM_BOT_TOKEN}/${file.result.file_path}`);
      }
    } catch {}
  }

  if (mediaUrls.length > 0) {
    content = content ? `${content}\n${mediaUrls.join("\n")}` : mediaUrls.join("\n");
  }

  if (!content) return;

  const avatarUrl = from ? await getTelegramUserAvatar(from) : null;

  try {
    await sendToDiscord(discordChannelId, content, username, avatarUrl);
    console.log(`[TG -> DC] Forwarded message from @${username} to Discord #${discordChannelId}`);
  } catch (err) {
    console.error(`[TG -> DC Error]:`, err.message);
  }
}

async function handleTelegramCommand(msg, text, chatId, threadId) {
  const [cmd, ...args] = text.split(/\s+/);
  const command = cmd.toLowerCase().split("@")[0];

  const reply = async (replyText) => {
    await callTelegramApi("sendMessage", {
      chat_id: chatId,
      message_thread_id: threadId !== 0 ? threadId : undefined,
      text: replyText,
      parse_mode: "HTML",
    });
  };

  if (command === "/status") {
    const count = Object.keys(channelMap).length;
    await reply(`🤖 <b>DiscordGram Status:</b>\n• Running on: Xiaomi Termux (Node.js)\n• Mapped Channels: ${count}\n• Mode: Outbound Long Polling (100% Secure)`);
    return true;
  }

  if (command === "/sync" || command === "/link") {
    const channelId = args[0]?.trim();
    if (!channelId) {
      await reply("ℹ️ <b>Usage:</b> <code>/sync &lt;DISCORD_CHANNEL_ID&gt;</code>");
      return true;
    }

    channelMap[channelId] = {
      chatId,
      threadId,
      name: `sync-${channelId}`,
    };
    saveChannels();
    await reply(`✅ Channel <code>${channelId}</code> successfully linked to this topic!`);
    console.log(`[Config] Linked channel ${channelId} to Telegram ${chatId}:${threadId}`);
    return true;
  }

  if (command === "/unlink") {
    const discordId = findDiscordChannelForTelegram(chatId, threadId);
    if (discordId) {
      delete channelMap[discordId];
      saveChannels();
      await reply(`✅ Unlinked channel <code>${discordId}</code> from this topic.`);
      return true;
    } else {
      await reply("⚠️ This topic is not linked to any Discord channel.");
      return true;
    }
  }

  return false;
}

// --------------------------------------------------------------------------
// Discord Gateway WebSocket Connection
// --------------------------------------------------------------------------
const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
};

let discordWs = null;
let heartbeatTimer = null;
let lastSeq = null;
let reconnectAttempts = 0;

function connectDiscordGateway() {
  console.log("🌐 Connecting to Discord Gateway WebSocket...");
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  try {
    discordWs?.close();
  } catch {}

  const ws = new WebSocket(GATEWAY_URL);
  discordWs = ws;

  ws.addEventListener("open", () => {
    console.log("✅ Discord Gateway WebSocket connected!");
  });

  ws.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleDiscordGatewayMessage(msg);
    } catch (err) {
      console.error("Error parsing Gateway message:", err);
    }
  });

  ws.addEventListener("close", (event) => {
    console.warn(`⚠️ Discord Gateway closed (code ${event.code}). Reconnecting...`);
    scheduleReconnect();
  });

  ws.addEventListener("error", (event) => {
    console.error("Discord Gateway error:", event);
  });
}

function scheduleReconnect() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  const backoff = Math.min(30000, 1000 * 2 ** reconnectAttempts);
  reconnectAttempts += 1;
  setTimeout(connectDiscordGateway, backoff);
}

function handleDiscordGatewayMessage(msg) {
  if (msg.s !== null && msg.s !== undefined) {
    lastSeq = msg.s;
  }

  switch (msg.op) {
    case OP.HELLO: {
      const interval = msg.d.heartbeat_interval;
      console.log(`💓 Discord Heartbeat interval: ${interval}ms`);
      reconnectAttempts = 0;

      // Start heartbeat
      heartbeatTimer = setInterval(() => {
        if (discordWs && discordWs.readyState === WebSocket.OPEN) {
          discordWs.send(JSON.stringify({ op: OP.HEARTBEAT, d: lastSeq }));
        }
      }, interval);

      // Send Identify
      const identifyPayload = {
        op: OP.IDENTIFY,
        d: {
          token: DISCORD_BOT_TOKEN,
          intents: (1 << 0) | (1 << 9) | (1 << 15), // GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT
          properties: {
            os: "android",
            browser: "discordgram-termux",
            device: "xiaomi",
          },
        },
      };
      discordWs.send(JSON.stringify(identifyPayload));
      break;
    }

    case OP.HEARTBEAT: {
      if (discordWs && discordWs.readyState === WebSocket.OPEN) {
        discordWs.send(JSON.stringify({ op: OP.HEARTBEAT, d: lastSeq }));
      }
      break;
    }

    case OP.RECONNECT: {
      console.log("Discord requested reconnect.");
      discordWs?.close();
      break;
    }

    case OP.INVALID_SESSION: {
      console.log("Discord invalid session. Re-identifying...");
      setTimeout(connectDiscordGateway, 2000);
      break;
    }

    case OP.DISPATCH: {
      handleDiscordDispatch(msg.t, msg.d);
      break;
    }
  }
}

async function handleDiscordDispatch(eventType, data) {
  if (eventType === "READY") {
    console.log(`🤖 Logged in to Discord as @${data.user?.username} (ID: ${data.user?.id})`);
    return;
  }

  if (eventType === "MESSAGE_CREATE") {
    // Ignore bots and webhooks (avoids looping our own messages!)
    if (data.author?.bot || data.webhook_id) {
      return;
    }

    const channelId = data.channel_id;
    let target = findTelegramTargetForDiscord(channelId);

    // Auto-create topic if channel not mapped and auto-create enabled
    if (!target && AUTO_CREATE_TOPICS && DEFAULT_TELEGRAM_CHAT_ID) {
      try {
        console.log(`[Auto-topic] New channel ${channelId} detected, creating Telegram topic...`);
        // Get channel name from Discord
        const chanRes = await fetch(`${DISCORD_API}/channels/${channelId}`, {
          headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
        });
        if (chanRes.ok) {
          const chanData = await chanRes.json();
          const topicName = chanData.name || `channel-${channelId}`;
          const newTopic = await createTelegramForumTopic(DEFAULT_TELEGRAM_CHAT_ID, topicName);
          target = {
            chatId: DEFAULT_TELEGRAM_CHAT_ID,
            threadId: newTopic.threadId,
            name: topicName,
          };
          channelMap[channelId] = target;
          saveChannels();
          console.log(`[Auto-topic] Created topic "${topicName}" (Thread ID: ${newTopic.threadId})`);
        }
      } catch (err) {
        console.error("Auto-topic error:", err.message);
      }
    }

    if (!target) return;

    const authorName = data.author?.global_name || data.author?.username || "DiscordUser";
    const replyQuote = formatDiscordReplyQuote(data.referenced_message);
    const mediaUrls = (data.attachments || []).map((a) => a.url);

    try {
      await sendToTelegram(
        target.chatId,
        target.threadId,
        data.content,
        authorName,
        replyQuote,
        mediaUrls
      );
      console.log(`[DC -> TG] Forwarded message from @${authorName} to Telegram ${target.chatId}:${target.threadId}`);
    } catch (err) {
      console.error(`[DC -> TG Error]:`, err.message);
    }
  }

  if (eventType === "CHANNEL_DELETE") {
    if (channelMap[data.id]) {
      console.log(`[Channel Delete] Unmapping deleted channel ${data.id}`);
      delete channelMap[data.id];
      saveChannels();
    }
  }
}

// --------------------------------------------------------------------------
// Start Everything
// --------------------------------------------------------------------------
startTelegramPolling();
connectDiscordGateway();

process.on("SIGINT", () => {
  console.log("Shutting down DiscordGram...");
  discordWs?.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("Shutting down DiscordGram...");
  discordWs?.close();
  process.exit(0);
});
