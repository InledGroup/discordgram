import { DISCORD_API } from "./config";
import { Env } from "./types";

export async function discordFetch(
  env: Env,
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  const res = await fetch(`${DISCORD_API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Discord API ${method} ${path} falló: ${res.status} ${errorText}`);
  }

  return res;
}

const webhookCache = new Map<string, string>();

/**
 * Obtiene o crea un webhook con nombre "tg-bridge" en el canal indicado
 */
export async function getOrCreateWebhook(env: Env, channelId: string): Promise<string> {
  const cached = webhookCache.get(channelId);
  if (cached) return cached;

  const webhookName = "tg-bridge";
  const res = await discordFetch(env, "GET", `/channels/${channelId}/webhooks`);
  const list = (await res.json()) as Array<{ id: string; token: string; name: string }>;

  const existing = list.find((w) => w.name === webhookName);
  if (existing) {
    const url = `${DISCORD_API}/webhooks/${existing.id}/${existing.token}`;
    webhookCache.set(channelId, url);
    return url;
  }

  const createRes = await discordFetch(env, "POST", `/channels/${channelId}/webhooks`, {
    name: webhookName,
  });
  const created = (await createRes.json()) as { id: string; token: string };
  const url = `${DISCORD_API}/webhooks/${created.id}/${created.token}`;
  webhookCache.set(channelId, url);
  return url;
}

export interface SendDiscordParams {
  env: Env;
  channelId: string;
  content: string;
  username?: string;
  avatarUrl?: string | null;
  fileBlob?: Blob | null;
  fileName?: string;
}

/**
 * Envía un mensaje a Discord a través del webhook del canal (con soporte para adjuntos)
 */
export async function sendDiscordMessage(params: SendDiscordParams): Promise<void> {
  const { env, channelId, content, username, avatarUrl, fileBlob, fileName } = params;
  const webhookUrl = await getOrCreateWebhook(env, channelId);

  const payload: Record<string, unknown> = {
    content: content || (fileBlob ? "" : " "),
  };

  const SUFFIX = " (Telegram)";
  if (username) {
    const maxBase = 32 - SUFFIX.length;
    const base = username.length > maxBase ? username.slice(0, maxBase) : username;
    payload.username = `${base}${SUFFIX}`;
  }

  if (avatarUrl) {
    payload.avatar_url = avatarUrl;
  }

  let res: Response;

  if (fileBlob) {
    const formData = new FormData();
    formData.append("files[0]", fileBlob, fileName || "archivo");
    formData.append("payload_json", JSON.stringify(payload));

    res = await fetch(webhookUrl, {
      method: "POST",
      body: formData,
    });
  } else {
    res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Fallo enviando a webhook de Discord: ${res.status} ${errText}`);
  }
}

/**
 * Obtiene el nombre legible de un canal de Discord
 */
export async function getChannelName(env: Env, channelId: string): Promise<string> {
  try {
    const res = await discordFetch(env, "GET", `/channels/${channelId}`);
    const chan = (await res.json()) as { name?: string };
    return chan.name ?? channelId;
  } catch {
    return channelId;
  }
}

/**
 * Obtiene los servidores (guilds) a los que pertenece el bot de Discord
 */
export async function getBotGuilds(
  env: Env
): Promise<Array<{ id: string; name: string }>> {
  try {
    const res = await discordFetch(env, "GET", "/users/@me/guilds");
    const guilds = (await res.json()) as Array<{ id: string; name: string }>;
    return guilds.map((g) => ({ id: g.id, name: g.name }));
  } catch (err) {
    console.error("Error obteniendo servidores del bot de Discord:", err);
    return [];
  }
}

/**
 * Lista todos los canales de texto de un servidor (guild) de Discord
 */
export async function listGuildTextChannels(
  env: Env,
  guildId: string
): Promise<Array<{ id: string; name: string }>> {
  try {
    const res = await discordFetch(env, "GET", `/guilds/${guildId}/channels`);
    const channels = (await res.json()) as Array<{ id: string; name: string; type: number }>;
    // type 0 es canal de texto normal
    return channels
      .filter((c) => c.type === 0)
      .map((c) => ({ id: c.id, name: c.name }));
  } catch (err) {
    console.error("Error obteniendo canales del servidor de Discord:", err);
    return [];
  }
}

export function discordSafeName(name: string): string {
  return name.replace(/@/g, "").slice(0, 32);
}
