import {
  createAltchaChallenge,
  createSessionCookie,
  renderLoginPage,
  verifyAltcha,
  verifyPassword,
  verifySession,
} from "./auth";
import { getDefaultChatId } from "./config";
import { serveDashboardHtml } from "./dashboard";
import {
  checkIfChannelIsPrivate,
  discordSafeName,
  getBotGuilds,
  getChannelName,
  listGuildTextChannels,
  sendDiscordMessage,
} from "./discord";
import { DiscordGateway } from "./gateway";
import { extractDiscordMedia, getTelegramMediaFile } from "./media";
import { formatDiscordReplyQuote, formatTelegramReplyQuote } from "./replies";
import { StatusStore } from "./status";
import {
  deleteChannelMapping,
  findDiscordForTelegram,
  findTelegramForDiscord,
  getChannelMap,
  saveChannelMapping,
} from "./storage";
import {
  createForumTopic,
  handleTelegramCommands,
  parseTelegramUpdate,
  resolveTelegramAvatar,
  sendTelegramMessage,
  verifyTelegramRequest,
} from "./telegram";
import { DiscordMessage, Env, TelegramMessage } from "./types";

export { DiscordGateway, StatusStore };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Webhooks principales (sin autenticación de sesión de navegador)
    if (path === "/telegram/webhook") {
      return await handleTelegramWebhook(request, env, ctx);
    }

    if (path === "/discord/events") {
      return await handleDiscordEvent(request, env, ctx);
    }

    // Reto ALTCHA público para el login
    if (path === "/api/altcha/challenge") {
      const challenge = await createAltchaChallenge(env);
      return Response.json(challenge);
    }

    // Ruta de Login
    if (path === "/login" && request.method === "POST") {
      try {
        const body = (await request.json()) as { password?: string; altcha?: string };
        const isAltchaValid = await verifyAltcha(body.altcha, env);
        if (!isAltchaValid) {
          return Response.json({ ok: false, error: "Verificación de seguridad inválida" }, { status: 400 });
        }

        const isPasswordValid = verifyPassword(body.password, env);
        if (!isPasswordValid) {
          return Response.json({ ok: false, error: "Contraseña incorrecta" }, { status: 401 });
        }

        const cookieHeader = await createSessionCookie(env);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": cookieHeader,
          },
        });
      } catch (err) {
        return Response.json({ ok: false, error: String(err) }, { status: 400 });
      }
    }

    // Ruta de Logout
    if (path === "/logout") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": "dg_session=; HttpOnly; Path=/; Max-Age=0",
        },
      });
    }

    // Comprobación de autenticación para el panel y sus APIs
    const isAuthenticated = await verifySession(request, env);

    // Si solicita el panel HTML principal
    if (path === "/" || path === "/index.html") {
      if (!isAuthenticated) {
        return renderLoginPage();
      }
      return serveDashboardHtml();
    }

    // Para todas las rutas /api/* restantes, exigir sesión
    if (!isAuthenticated) {
      return Response.json({ ok: false, error: "No autorizado. Inicia sesión en el panel." }, { status: 401 });
    }

    // API interna de conexión y estado
    if (path === "/api/connect" && request.method === "POST") {
      return await handleConnect(env, url);
    }

    if (path === "/api/status") {
      return await handleStatus(env);
    }

    // API de gestión de canales
    if (path === "/api/channels") {
      if (request.method === "GET") {
        const channels = await getChannelMap(env);
        return Response.json(channels);
      }
      if (request.method === "POST") {
        return await handleAddChannel(request, env);
      }
    }

    if (path.startsWith("/api/channels/") && request.method === "DELETE") {
      const channelId = path.split("/").pop();
      if (channelId) {
        await deleteChannelMapping(env, channelId);
        return Response.json({ ok: true });
      }
      return new Response("Missing channel id", { status: 400 });
    }

    if (path === "/api/channels/auto-sync" && request.method === "POST") {
      return await handleAutoSync(env);
    }

    return new Response("Not found", { status: 404 });
  },
};

async function handleTelegramWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  if (!verifyTelegramRequest(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const update = await parseTelegramUpdate(request);
  const message = update.message;

  if (!message) {
    return new Response("ok");
  }

  // Comprobar si es un comando (/sync, /syncall, /unsync, etc.)
  if (message.text && message.text.startsWith("/")) {
    const handled = await handleTelegramCommands(env, message);
    if (handled) {
      return new Response("ok");
    }
  }

  // Reenviar a Discord si tiene texto, caption o multimedia
  const hasContent = !!(message.text || message.caption);
  const hasMedia = !!(
    (message.photo && message.photo.length > 0) ||
    message.video ||
    message.animation ||
    message.document
  );

  if (hasContent || hasMedia) {
    ctx.waitUntil(forwardTelegramMessage(env, message));
  }

  return new Response("ok");
}

async function forwardTelegramMessage(env: Env, message: TelegramMessage): Promise<void> {
  try {
    const chatId = message.chat.id;
    const threadId = message.message_thread_id ?? 0;

    const channelMap = await getChannelMap(env);
    const discordChannelId = findDiscordForTelegram(channelMap, chatId, threadId);

    if (!discordChannelId) {
      return;
    }

    // 1. Contexto de respuesta
    const replyQuote = formatTelegramReplyQuote(message.reply_to_message);

    // 2. Contenido de texto
    const rawText = message.text ?? message.caption ?? "";
    const content = `${replyQuote}${rawText}`.trim();

    // 3. Autor y avatar
    const from = message.from;
    const username = from
      ? from.first_name + (from.last_name ? ` ${from.last_name}` : "")
      : "Telegram";
    let avatarUrl: string | null = null;
    if (from) {
      avatarUrl = await resolveTelegramAvatar(env, from);
    }

    // 4. Medios (fotos, vídeos, documentos)
    let fileBlob: Blob | null = null;
    let fileName: string | undefined;

    const mediaInfo = await getTelegramMediaFile(env, message);
    if (mediaInfo) {
      try {
        const fileRes = await fetch(mediaInfo.fileUrl);
        if (fileRes.ok) {
          fileBlob = await fileRes.blob();
          fileName = mediaInfo.filename;
        }
      } catch (dlErr) {
        console.error("Error descargando medio de Telegram:", dlErr);
      }
    }

    await sendDiscordMessage({
      env,
      channelId: discordChannelId,
      content,
      username: discordSafeName(username),
      avatarUrl,
      fileBlob,
      fileName,
    });

    await recordStatus(env, {
      lastTelegramMessage: new Date().toISOString(),
      lastError: null,
    });
  } catch (err) {
    console.error("Error reenviando mensaje de Telegram a Discord:", err);
    await recordStatus(env, { lastError: String(err) });
  }
}

async function handleDiscordEvent(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  if (request.headers.get("x-discordgram-gateway") !== "gateway-event") {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as { event: string; data: any };

  if (body.event === "MESSAGE_CREATE") {
    ctx.waitUntil(forwardDiscordToTelegram(env, body.data as DiscordMessage));
  } else if (body.event === "CHANNEL_CREATE") {
    ctx.waitUntil(handleDiscordChannelCreated(env, body.data));
  } else if (body.event === "CHANNEL_DELETE") {
    ctx.waitUntil(deleteChannelMapping(env, body.data.id));
  }

  return new Response("ok");
}

/**
 * Cuando se crea un nuevo canal de texto en Discord, se crea automáticamente un tema en Telegram (estilo Flake)
 */
async function handleDiscordChannelCreated(env: Env, channelData: any): Promise<void> {
  try {
    if (env.AUTO_CREATE_TOPICS === "false") return;
    // type 0 = GUILD_TEXT
    if (channelData.type !== 0) return;

    // Strict security check: Skip private / moderator-only / staff / devs / raidprotect channels
    const isPrivate = await checkIfChannelIsPrivate(env, channelData.id, channelData.guild_id);
    if (isPrivate) {
      console.log(`[discordgram] Skipping auto-sync for private channel: #${channelData.name} (${channelData.id})`);
      return;
    }

    const channelMap = await getChannelMap(env);
    if (channelMap[channelData.id]) return;

    const chatId = getDefaultChatId(env);
    const topic = await createForumTopic(env, chatId, channelData.name);

    await saveChannelMapping(env, channelData.id, {
      chatId,
      threadId: topic.message_thread_id,
      name: channelData.name,
    });

    console.log(`[discordgram] Auto-synchronized new channel #${channelData.name} -> Topic ${topic.message_thread_id}`);
  } catch (err) {
    console.error("Error auto-creating topic for new Discord channel:", err);
  }
}

async function forwardDiscordToTelegram(env: Env, message: DiscordMessage): Promise<void> {
  if (message.author?.bot) return;

  // Extra security check: Never forward messages from private channels
  if (await checkIfChannelIsPrivate(env, message.channel_id, message.guild_id)) {
    return;
  }

  const channelMap = await getChannelMap(env);
  const target = findTelegramForDiscord(channelMap, message.channel_id);
  if (!target) return;

  // Extraer medios e imágenes/vídeos adjuntos
  const mediaItems = extractDiscordMedia(message.attachments);
  if (!message.content && mediaItems.length === 0) return;

  const username = message.author?.global_name || message.author?.username || "Discord";

  // Contexto de respuesta
  const replyQuote = formatDiscordReplyQuote(message.referenced_message);

  try {
    await sendTelegramMessage(env, {
      chatId: target.chatId,
      threadId: target.threadId,
      text: message.content,
      authorName: username,
      replyQuote,
      mediaItems,
    });

    await recordStatus(env, {
      lastDiscordMessage: new Date().toISOString(),
      lastError: null,
    });
  } catch (err) {
    console.error("Error reenviando mensaje de Discord a Telegram:", err);
    await recordStatus(env, { lastError: String(err) });
  }
}

async function handleAddChannel(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as {
      channelId: string;
      chatId?: number;
      threadId?: number;
      name?: string;
    };

    if (!body.channelId) {
      return new Response("Missing channelId", { status: 400 });
    }

    // Security check: Block private / restricted channels
    const isPrivate = await checkIfChannelIsPrivate(env, body.channelId);
    if (isPrivate) {
      return Response.json(
        { ok: false, error: "Security restriction: Channel is private/restricted (moderators, devs, raidprotect). Synchronization is blocked." },
        { status: 400 }
      );
    }

    const chatId = body.chatId || getDefaultChatId(env);
    let threadId = body.threadId;
    let name = body.name;

    if (!name) {
      name = await getChannelName(env, body.channelId);
    }

    // Si no se proporcionó threadId, auto-crear tema en Telegram
    if (threadId === undefined || threadId === null) {
      const topic = await createForumTopic(env, chatId, name);
      threadId = topic.message_thread_id;
    }

    await saveChannelMapping(env, body.channelId, {
      chatId,
      threadId,
      name,
    });

    return Response.json({
      ok: true,
      mapping: { channelId: body.channelId, chatId, threadId, name },
    });
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
}

async function handleAutoSync(env: Env): Promise<Response> {
  try {
    let guildId = env.DISCORD_GUILD_ID;
    if (!guildId) {
      const guilds = await getBotGuilds(env);
      if (guilds.length > 0) {
        guildId = guilds[0].id;
        console.log(`[discordgram] Servidor auto-detectado: ${guilds[0].name} (${guildId})`);
      }
    }

    if (!guildId) {
      return Response.json(
        { ok: false, error: "No se detectó ningún servidor de Discord. Asegúrate de que el bot esté en tu servidor o configura DISCORD_GUILD_ID." },
        { status: 400 }
      );
    }

    const channels = await listGuildTextChannels(env, guildId);
    const channelMap = await getChannelMap(env);
    const chatId = getDefaultChatId(env);

    let createdCount = 0;
    const results: string[] = [];

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
          results.push(ch.name);
        } catch (topicErr) {
          console.error(`Error creando tema para #${ch.name}:`, topicErr);
        }
      }
    }

    return Response.json({ ok: true, createdCount, results });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

async function handleStatus(env: Env): Promise<Response> {
  const store = env.STATUS_STORE.get(env.STATUS_STORE.idFromName("global"));
  const stored = await store
    .fetch(new Request("https://internal/status"))
    .then((r) => r.json() as Promise<any>);

  let gateway = stored.gateway ?? { connected: false, lastDispatch: null };
  try {
    const gw = env.DISCORD_GATEWAY.get(env.DISCORD_GATEWAY.idFromName("global"));
    const live = await gw
      .fetch(new Request("https://internal/status"))
      .then((r) => r.json() as Promise<any>);
    gateway = live;
  } catch {
    // Gateway DO no listo
  }

  return Response.json({ ...stored, gateway });
}

async function recordStatus(env: Env, patch: Record<string, unknown>): Promise<void> {
  try {
    const stub = env.STATUS_STORE.get(env.STATUS_STORE.idFromName("global"));
    await stub.fetch(
      new Request("https://internal/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
    );
  } catch {
    // Ignorar telemetría interna
  }
}

async function handleConnect(env: Env, url: URL): Promise<Response> {
  const stub = env.DISCORD_GATEWAY.get(env.DISCORD_GATEWAY.idFromName("global"));
  const statusUrl = `${url.origin}/discord/events`;
  await stub.fetch(
    new Request("https://internal/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webhookUrl: statusUrl, statusUrl }),
    })
  );
  return Response.json({ ok: true });
}
