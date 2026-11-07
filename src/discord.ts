import { DISCORD_API } from "./config";
import { Env } from "./types";

export const PRIVATE_KEYWORDS = [
  "moderator",
  "moderators",
  "mod-only",
  "mods-only",
  "admin-only",
  "staff-only",
  "staff-chat",
  "raidprotect",
  "audit-log",
  "audit-logs",
  "pulsar-devs",
  "devs-only",
  "dev-only",
  "secret",
  "internal-only",
];

export interface DiscordChannelRaw {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
  guild_id?: string;
  permission_overwrites?: Array<{
    id: string;
    type: number;
    allow: string;
    deny: string;
  }>;
}

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
    throw new Error(`Discord API ${method} ${path} failed: ${res.status} ${errorText}`);
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
}

/**
 * Envía un mensaje a Discord a través del webhook del canal
 */
export async function sendDiscordMessage(params: SendDiscordParams): Promise<void> {
  const { env, channelId, content, username, avatarUrl } = params;
  const webhookUrl = await getOrCreateWebhook(env, channelId);

  const payload: Record<string, unknown> = {
    content: content || " ",
  };

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
    const errText = await res.text();
    throw new Error(`Discord webhook send failed: ${res.status} ${errText}`);
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
 * Comprueba de forma estricta si un canal es privado, de administración o restringido
 */
export function isChannelPrivate(
  channel: DiscordChannelRaw,
  categoriesById?: Map<string, DiscordChannelRaw>,
  guildId?: string
): boolean {
  const nameLower = (channel.name || "").toLowerCase();

  // 1. Coincidencia de palabras clave prohibidas en el nombre del canal
  for (const kw of PRIVATE_KEYWORDS) {
    if (nameLower.includes(kw)) {
      return true;
    }
  }

  // 2. Comprobar permisos explícitos en el canal (si @everyone tiene denegado VIEW_CHANNEL)
  const gId = guildId || channel.guild_id;
  if (channel.permission_overwrites && gId) {
    const everyoneOverwrite = channel.permission_overwrites.find((ow) => ow.id === gId);
    if (everyoneOverwrite) {
      const denyBits = BigInt(everyoneOverwrite.deny || "0");
      // VIEW_CHANNEL es el bit 10 (1 << 10 = 1024)
      if ((denyBits & (1n << 10n)) !== 0n) {
        return true;
      }
    }
  }

  // 3. Comprobar si la categoría padre es privada
  if (channel.parent_id && categoriesById) {
    const parentCategory = categoriesById.get(channel.parent_id);
    if (parentCategory) {
      const catName = (parentCategory.name || "").toLowerCase();
      for (const kw of PRIVATE_KEYWORDS) {
        if (catName.includes(kw)) {
          return true;
        }
      }

      if (parentCategory.permission_overwrites && gId) {
        const catEveryone = parentCategory.permission_overwrites.find((ow) => ow.id === gId);
        if (catEveryone) {
          const denyBits = BigInt(catEveryone.deny || "0");
          if ((denyBits & (1n << 10n)) !== 0n) {
            return true;
          }
        }
      }
    }
  }

  return false;
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
    console.error("Error fetching bot Discord guilds:", err);
    return [];
  }
}

/**
 * Lista todos los canales de texto PÚBLICOS de un servidor de Discord (excluyendo automáticamente chats privados)
 */
export async function listGuildTextChannels(
  env: Env,
  guildId: string
): Promise<Array<{ id: string; name: string }>> {
  try {
    const res = await discordFetch(env, "GET", `/guilds/${guildId}/channels`);
    const allChannels = (await res.json()) as DiscordChannelRaw[];

    // Mapear categorías (type 4 = GUILD_CATEGORY)
    const categoriesById = new Map<string, DiscordChannelRaw>();
    for (const c of allChannels) {
      if (c.type === 4) {
        categoriesById.set(c.id, c);
      }
    }

    // Filtrar solo canales de texto normales (type 0 = GUILD_TEXT) que NO sean privados
    const textChannels = allChannels.filter((c) => c.type === 0);

    const safeChannels = textChannels.filter((c) => {
      const isPrivate = isChannelPrivate(c, categoriesById, guildId);
      if (isPrivate) {
        console.log(`[discordgram] Skipping private/restricted channel: #${c.name} (${c.id})`);
      }
      return !isPrivate;
    });

    return safeChannels.map((c) => ({ id: c.id, name: c.name }));
  } catch (err) {
    console.error("Error listing guild channels from Discord:", err);
    return [];
  }
}

/**
 * Comprueba individualmente si un canal es privado consultando Discord API
 */
export async function checkIfChannelIsPrivate(
  env: Env,
  channelId: string,
  guildId?: string
): Promise<boolean> {
  try {
    const res = await discordFetch(env, "GET", `/channels/${channelId}`);
    const chan = (await res.json()) as DiscordChannelRaw;

    let categoriesById: Map<string, DiscordChannelRaw> | undefined;
    const gId = guildId || chan.guild_id || env.DISCORD_GUILD_ID;

    if (chan.parent_id && gId) {
      try {
        const catRes = await discordFetch(env, "GET", `/channels/${chan.parent_id}`);
        const cat = (await catRes.json()) as DiscordChannelRaw;
        categoriesById = new Map([[cat.id, cat]]);
      } catch {
        // Ignorar si no se puede leer la categoría
      }
    }

    return isChannelPrivate(chan, categoriesById, gId);
  } catch {
    return false;
  }
}

export function discordSafeName(name: string): string {
  return name.replace(/@/g, "").slice(0, 32);
}
