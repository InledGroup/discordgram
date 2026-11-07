import { TELEGRAM_API } from "./config";
import { getChannelName, listGuildTextChannels } from "./discord";
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
    throw new Error(`Telegram API ${method} falló: ${res.status} ${errorText}`);
  }

  return await res.json();
}

/**
 * Crea un nuevo tema (forum topic) en un supergrupo de Telegram
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
 * Envía un mensaje o medio a Telegram formateado con parse_mode HTML y citas
 */
export async function sendTelegramMessage(env: Env, opts: SendTelegramOptions): Promise<void> {
  const { chatId, threadId, text, authorName, replyQuote, mediaItems } = opts;

  let bodyText = escapeHtml(text || "");
  let header = "";
  if (authorName) {
    header = `<b>${escapeHtml(authorName)}</b> (desde Discord):\n`;
  }

  const quote = replyQuote || "";
  const fullMessage = `${quote}${header}${bodyText}`.trim();

  const basePayload: Record<string, unknown> = {
    chat_id: chatId,
  };
  if (threadId !== undefined && threadId !== null && threadId !== 0) {
    basePayload.message_thread_id = threadId;
  }

  // Si hay imágenes o vídeos adjuntos desde Discord
  if (mediaItems && mediaItems.length > 0) {
    const firstMedia = mediaItems[0];
    const isSingle = mediaItems.length === 1;

    try {
      if (firstMedia.type === "photo" && isSingle) {
        // Enviar foto con caption si cabe (límite 1024 caracteres)
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
      console.warn("Fallo enviando medio directo a Telegram, usando fallback con enlaces:", mediaErr);
      // Fallback: Si Telegram falla al descargar la URL de Discord CDN, adjuntamos los links en el texto
    }
  }

  // Fallback o mensaje de texto habitual:
  let finalContent = fullMessage;
  if (mediaItems && mediaItems.length > 0) {
    const mediaLinks = mediaItems.map((m, idx) => {
      const label = m.type === "photo" ? "🖼️ Foto" : m.type === "video" ? "🎥 Vídeo" : "📎 Archivo";
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
 * Procesa comandos de bot en Telegram para gestionar canales de forma cómoda y automatizada
 */
export async function handleTelegramCommands(
  env: Env,
  message: TelegramMessage
): Promise<boolean> {
  const text = (message.text || "").trim();
  if (!text.startsWith("/")) return false;

  const [cmd, ...args] = text.split(/\s+/);
  const command = cmd.toLowerCase().split("@")[0]; // soporte para /cmd@botname
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

  switch (command) {
    case "/sync":
    case "/link": {
      const channelId = args[0]?.trim();
      if (!channelId) {
        await reply(
          "ℹ️ <b>Uso:</b> <code>/sync &lt;DISCORD_CHANNEL_ID&gt;</code>\n\n" +
          "Vincula este tema de Telegram con el canal de Discord especificado."
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
          `✅ <b>¡Canal vinculado con éxito!</b>\n\n` +
          `• <b>Discord:</b> #${escapeHtml(channelName)} (<code>${channelId}</code>)\n` +
          `• <b>Telegram:</b> Tema <code>${threadId}</code> en este grupo.`
        );
      } catch (err) {
        await reply(`❌ Error vinculando canal: ${escapeHtml(String(err))}`);
      }
      return true;
    }

    case "/unsync":
    case "/unlink": {
      const channelMap = await getChannelMap(env);
      const discordChannelId = findDiscordForTelegram(channelMap, chatId, threadId);

      if (!discordChannelId) {
        await reply("⚠️ Este tema de Telegram no está vinculado a ningún canal de Discord.");
        return true;
      }

      const existingName = channelMap[discordChannelId]?.name || discordChannelId;
      await deleteChannelMapping(env, discordChannelId);

      await reply(`✅ Desvinculada la sincronización con el canal <b>#${escapeHtml(existingName)}</b> de Discord.`);
      return true;
    }

    case "/synclist":
    case "/channels": {
      const channelMap = await getChannelMap(env);
      const entries = Object.entries(channelMap);

      if (entries.length === 0) {
        await reply("ℹ️ No hay ningún canal configurado actualmente.");
        return true;
      }

      const lines = entries.map(([chanId, target]) => {
        const name = target.name ? `#${target.name}` : `Canal ${chanId}`;
        const isCurrent = target.chatId === chatId && target.threadId === threadId;
        const pointer = isCurrent ? " 📍 <i>(este tema)</i>" : "";
        return `• <b>${escapeHtml(name)}</b> ➔ Tema <code>${target.threadId}</code>${pointer}`;
      });

      await reply(`📋 <b>Canales sincronizados (${entries.length}):</b>\n\n${lines.join("\n")}`);
      return true;
    }

    case "/syncall": {
      const guildId = args[0]?.trim() || env.DISCORD_GUILD_ID;
      if (!guildId) {
        await reply(
          "ℹ️ <b>Uso:</b> <code>/syncall &lt;DISCORD_GUILD_ID&gt;</code>\n" +
          "O define la variable <code>DISCORD_GUILD_ID</code> en tu <code>wrangler.toml</code>.\n\n" +
          "Esto creará automáticamente un tema en Telegram para cada canal de texto de tu Discord."
        );
        return true;
      }

      try {
        const channels = await listGuildTextChannels(env, guildId);
        if (channels.length === 0) {
          await reply("⚠️ No se encontraron canales de texto en el servidor de Discord.");
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
              console.error(`Error creando tema para canal #${ch.name}:`, topicErr);
            }
          }
        }

        if (createdCount === 0) {
          await reply("✅ Todos los canales de texto de Discord ya estaban sincronizados.");
        } else {
          await reply(
            `🎉 <b>¡${createdCount} canales nuevos sincronizados!</b>\n` +
            `Temas creados en Telegram:\n${createdNames.map((n) => `• #${escapeHtml(n)}`).join("\n")}`
          );
        }
      } catch (err) {
        await reply(`❌ Error en syncall: ${escapeHtml(String(err))}`);
      }
      return true;
    }

    case "/synchelp":
    case "/start": {
      await reply(
        "🤖 <b>Comandos de Discordgram:</b>\n\n" +
        "• <code>/sync &lt;id_canal_discord&gt;</code>: Vincula el tema actual a un canal de Discord.\n" +
        "• <code>/unsync</code>: Desvincula el tema actual.\n" +
        "• <code>/synclist</code>: Lista todos los canales vinculados.\n" +
        "• <code>/syncall</code>: Crea temas automáticamente para todos los canales de tu Discord.\n" +
        "• <code>/synchelp</code>: Muestra esta ayuda.\n\n" +
        "💡 <i>Los nuevos canales creados en Discord también se sincronizan automáticamente.</i>"
      );
      return true;
    }
  }

  return false;
}
