import { INITIAL_CHANNEL_MAP } from "./config";
import { ChannelMap, ChannelTarget, Env } from "./types";

/**
 * Obtiene el mapa completo de canales combinando el DO de almacenamiento y la configuración inicial
 */
export async function getChannelMap(env: Env): Promise<ChannelMap> {
  try {
    const store = env.STATUS_STORE.get(env.STATUS_STORE.idFromName("global"));
    const res = await store.fetch(new Request("https://internal/channels"));
    if (res.ok) {
      const data = (await res.json()) as ChannelMap;
      if (data && Object.keys(data).length > 0) {
        return data;
      }
    }
  } catch (err) {
    console.error("Error leyendo mapa de canales del almacenamiento:", err);
  }
  return { ...INITIAL_CHANNEL_MAP };
}

/**
 * Guarda o actualiza un canal en el almacenamiento persistente
 */
export async function saveChannelMapping(
  env: Env,
  channelId: string,
  target: ChannelTarget
): Promise<void> {
  const store = env.STATUS_STORE.get(env.STATUS_STORE.idFromName("global"));
  await store.fetch(new Request("https://internal/channels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channelId, target }),
  }));
}

/**
 * Elimina la sincronización de un canal
 */
export async function deleteChannelMapping(env: Env, channelId: string): Promise<void> {
  const store = env.STATUS_STORE.get(env.STATUS_STORE.idFromName("global"));
  await store.fetch(new Request(`https://internal/channels/${channelId}`, {
    method: "DELETE",
  }));
}

/**
 * Encuentra el ID de canal de Discord correspondiente a un chat y tema de Telegram
 */
export function findDiscordForTelegram(
  channelMap: ChannelMap,
  telegramChatId: number,
  threadId: number
): string | null {
  for (const [channelId, target] of Object.entries(channelMap)) {
    // Si threadId es 0 o null, coincide con el general
    const tId = target.threadId ?? 0;
    const incomingThreadId = threadId ?? 0;

    if (Number(target.chatId) === Number(telegramChatId) && tId === incomingThreadId) {
      return channelId;
    }
  }
  return null;
}

/**
 * Encuentra el objetivo de Telegram para un canal de Discord
 */
export function findTelegramForDiscord(
  channelMap: ChannelMap,
  channelId: string
): ChannelTarget | null {
  return channelMap[channelId] ?? null;
}
