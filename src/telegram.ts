import { TELEGRAM_API } from "./config";
import { checkIfChannelIsPrivate, getBotGuilds, getChannelName, listGuildTextChannels } from "./discord";
import { MediaItem } from "./media";
import { escapeHtml } from "./replies";
import { deleteChannelMapping, findDiscordForTelegram, getChannelMap, saveChannelMapping } from "./storage";
import { Env, TelegramMessage, TelegramUpdate, TelegramUser } from "./types";

export async function callApi(env: Env, method: string, body: unknown): Promise<any> {
  const res = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Telegram API ${method} failed: ${res.status} ${errorText}`);
  }

  return await res.json();
}

/**
 * Checks if a user is an administrator or creator of the Telegram chat
 */
export async function isTelegramAdmin(env: Env, chatId: number, userId: number): Promise<boolean> {
  try {
    const res = await callApi(env, "getChatMember", {
      chat_id: chatId,
      user_id: userId,
    });
    const status = res.result?.status;
    return status === "creator" || status === "administrator";
  } catch (err) {
    console.error("Error verifying Telegram admin status:", err);
    return false;
  }
}

/**
 * Creates a new forum topic in a Telegram supergroup
 */
export async function createForumTopic(
  env: Env,
  chatId: number,
  name: string
): Promise<{ message_thread_id: number; name: string }> {
  const cleanName = name.slice(0, 128);
  const data = await callApi(env, "createForumTopic", {
    chat_id: chatId,
    name: cleanName,
  });

  return {
    message_thread_id: data.result.message_thread_id,
    name: data.result.name,
  };
}

export function verifyTelegramRequest(request: Request, env: Env): boolean {
  if (!env.TELEGRAM_WEBHOOK_SECRET) return true;
  const header = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  return header === env.TELEGRAM_WEBHOOK_SECRET;
}

export async function parseTelegramUpdate(request: Request): Promise<TelegramUpdate> {
  return (await request.json()) as TelegramUpdate;
}

export async function resolveTelegramAvatar(env: Env, user: TelegramUser): Promise<string | null> {
  try {
    const photos = await callApi(env, "getUserProfilePhotos", {
      user_id: user.id,
      limit: 1,
    });
    const first = photos.result?.photos?.[0]?.[0]?.file_id;
    if (!first) return null;

    const file = await callApi(env, "getFile", { file_id: first });
    const path = file.result?.file_path;
    if (!path) return null;

    return `${TELEGRAM_API}/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`;
  } catch {
    return null;
  }
}

export interface SendTelegramOptions {
  chatId: number;
  threadId?: number | null;
  text: string;
  authorName?: string;
  replyQuote?: string;
  mediaItems?: MediaItem[];
}

/**
 * Sends a message or media to Telegram formatted with HTML parse_mode
 */
export async function sendTelegramMessage(env: Env, opts: SendTelegramOptions): Promise<void> {
  const { chatId, threadId, text, authorName, replyQuote, mediaItems } = opts;

  let bodyText = escapeHtml(text || "");
  let header = "";
  if (authorName) {
    header = `<b>${escapeHtml(authorName)}</b> (sent from Discord):\n`;
  }

  const quote = replyQuote || "";
  const fullMessage = `${quote}${header}${bodyText}`.trim();

  const basePayload: Record<string, unknown> = {
    chat_id: chatId,
  };
  if (threadId !== undefined && threadId !== null && threadId !== 0) {
    basePayload.message_thread_id = threadId;
  }

  // If there are attached images or videos from Discord
  if (mediaItems && mediaItems.length > 0) {
    const firstMedia = mediaItems[0];
    const isSingle = mediaItems.length === 1;

    try {
      if (firstMedia.type === "photo" && isSingle) {
        if (fullMessage.length <= 1024) {
          await callApi(env, "sendPhoto", {
            ...basePayload,
            photo: firstMedia.url,
            caption: fullMessage || undefined,
            parse_mode: "HTML",
          });
          return;
        }
      } else if (firstMedia.type === "video" && isSingle) {
        if (fullMessage.length <= 1024) {
          await callApi(env, "sendVideo", {
            ...basePayload,
            video: firstMedia.url,
            caption: fullMessage || undefined,
            parse_mode: "HTML",
          });
          return;
        }
      }
    } catch (mediaErr) {
      console.warn("Direct media delivery to Telegram failed, falling back to URLs:", mediaErr);
    }
  }

  // Text message fallback or standard message
  let finalContent = fullMessage;
  if (mediaItems && mediaItems.length > 0) {
    const mediaLinks = mediaItems.map((m, idx) => {
      const label = m.type === "photo" ? "🖼️ Photo" : m.type === "video" ? "🎥 Video" : "📎 Attachment";
      return `<a href="${m.url}">${label} ${idx + 1}</a>`;
    }).join(" | ");

    finalContent = finalContent ? `${finalContent}\n\n${mediaLinks}` : mediaLinks;
  }

  if (!finalContent) return;

  await callApi(env, "sendMessage", {
    ...basePayload,
    text: finalContent,
    parse_mode: "HTML",
    disable_web_page_preview: false,
  });
}

/**
 * Handles bot commands in Telegram with strict admin authorization checks
 */
export async function handleTelegramCommands(
  env: Env,
  message: TelegramMessage
): Promise<boolean> {
  const text = (message.text || "").trim();
  if (!text.startsWith("/")) return false;

  const [cmd, ...args] = text.split(/\s+/);
  const command = cmd.toLowerCase().split("@")[0];
  const chatId = message.chat.id;
  const threadId = message.message_thread_id ?? 0;

  const reply = async (replyText: string) => {
    await callApi(env, "sendMessage", {
      chat_id: chatId,
      message_thread_id: threadId !== 0 ? threadId : undefined,
      text: replyText,
      parse_mode: "HTML",
    });
  };

  // 1. STRICT SECURITY: Verify if sender is an Administrator or Creator
  const from = message.from;
  if (!from) return false;

  const isAdmin = await isTelegramAdmin(env, chatId, from.id);
  if (!isAdmin) {
    await reply(
      "⛔ <b>Access Denied:</b> Only administrators of this group are authorized to execute synchronization commands."
    );
    return true;
  }

  switch (command) {
    case "/sync":
    case "/link": {
      const channelId = args[0]?.trim();
      if (!channelId) {
        await reply(
          "ℹ️ <b>Usage:</b> <code>/sync &lt;DISCORD_CHANNEL_ID&gt;</code>\n\n" +
          "Links this Telegram topic with the specified Discord channel."
        );
        return true;
      }

      // Check if channel is private / moderator-only / staff / raidprotect
      const isPrivate = await checkIfChannelIsPrivate(env, channelId);
      if (isPrivate) {
        await reply(
          `⛔ <b>Security Blocked:</b> Channel <code>${channelId}</code> was detected as a private or restricted channel (moderator-only, devs, raidprotect, admin, etc.).\n\n` +
          `Private channels are blocked from synchronization for security and privacy reasons.`
        );
        return true;
      }

      try {
        const channelName = await getChannelName(env, channelId);
        await saveChannelMapping(env, channelId, {
          chatId,
          threadId,
          name: channelName,
        });

        await reply(
          `✅ <b>Channel successfully linked!</b>\n\n` +
          `• <b>Discord:</b> #${escapeHtml(channelName)} (<code>${channelId}</code>)\n` +
          `• <b>Telegram:</b> Topic <code>${threadId}</code> in this group.`
        );
      } catch (err) {
        await reply(`❌ Error linking channel: ${escapeHtml(String(err))}`);
      }
      return true;
    }

    case "/unsync":
    case "/unlink": {
      const channelMap = await getChannelMap(env);
      const discordChannelId = findDiscordForTelegram(channelMap, chatId, threadId);

      if (!discordChannelId) {
        await reply("⚠️ This Telegram topic is not linked to any Discord channel.");
        return true;
      }

      const existingName = channelMap[discordChannelId]?.name || discordChannelId;
      await deleteChannelMapping(env, discordChannelId);

      await reply(`✅ Unlinked synchronization for Discord channel <b>#${escapeHtml(existingName)}</b>.`);
      return true;
    }

    case "/synclist":
    case "/channels": {
      const channelMap = await getChannelMap(env);
      const entries = Object.entries(channelMap);

      if (entries.length === 0) {
        await reply("ℹ️ No channels currently synchronized.");
        return true;
      }

      const lines = entries.map(([chanId, target]) => {
        const name = target.name ? `#${target.name}` : `Channel ${chanId}`;
        const isCurrent = target.chatId === chatId && target.threadId === threadId;
        const pointer = isCurrent ? " 📍 <i>(this topic)</i>" : "";
        return `• <b>${escapeHtml(name)}</b> ➔ Topic <code>${target.threadId}</code>${pointer}`;
      });

      await reply(`📋 <b>Synchronized channels (${entries.length}):</b>\n\n${lines.join("\n")}`);
      return true;
    }

    case "/syncall": {
      let guildId = args[0]?.trim() || env.DISCORD_GUILD_ID;
      if (!guildId) {
        const guilds = await getBotGuilds(env);
        if (guilds.length > 0) {
          guildId = guilds[0].id;
        }
      }

      if (!guildId) {
        await reply(
          "ℹ️ <b>Usage:</b> <code>/syncall &lt;DISCORD_GUILD_ID&gt;</code>\n\n" +
          "Could not automatically detect a Discord server. Please provide the server ID."
        );
        return true;
      }

      try {
        // listGuildTextChannels ALREADY strictly filters out private / staff / dev / raidprotect channels
        const channels = await listGuildTextChannels(env, guildId);
        if (channels.length === 0) {
          await reply("⚠️ No public text channels found to synchronize.");
          return true;
        }

        const channelMap = await getChannelMap(env);
        let createdCount = 0;
        const createdNames: string[] = [];

        for (const ch of channels) {
          if (!channelMap[ch.id]) {
            try {
              const topic = await createForumTopic(env, chatId, ch.name);
              await saveChannelMapping(env, ch.id, {
                chatId,
                threadId: topic.message_thread_id,
                name: ch.name,
              });
              createdCount++;
              createdNames.push(ch.name);
            } catch (topicErr) {
              console.error(`Error creating topic for #${ch.name}:`, topicErr);
            }
          }
        }

        if (createdCount === 0) {
          await reply("✅ All eligible public text channels are already synchronized.");
        } else {
          await reply(
            `🎉 <b>${createdCount} new public channels synchronized!</b>\n` +
            `Topics created:\n${createdNames.map((n) => `• #${escapeHtml(n)}`).join("\n")}\n\n` +
            `🔒 <i>Private and staff channels (devs, moderator-only, raidprotect, etc.) were safely excluded.</i>`
          );
        }
      } catch (err) {
        await reply(`❌ Error in syncall: ${escapeHtml(String(err))}`);
      }
      return true;
    }

    case "/synchelp":
    case "/start": {
      await reply(
        "🤖 <b>Discordgram Commands:</b>\n\n" +
        "• <code>/sync &lt;discord_channel_id&gt;</code>: Link this topic to a Discord channel.\n" +
        "• <code>/unsync</code>: Unlink this topic.\n" +
        "• <code>/synclist</code>: List all synchronized channels.\n" +
        "• <code>/syncall</code>: Automatically synchronize all public channels.\n" +
        "• <code>/synchelp</code>: Display this help.\n\n" +
        "🔒 <b>Security Note:</b> Only group administrators can run these commands. Private, staff, dev, and moderation channels are strictly excluded from synchronization."
      );
      return true;
    }
  }

  return false;
}
