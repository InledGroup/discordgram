import { ChannelMap } from "./types";

/**
 * Mapeo inicial de canales Discord <-> Temas de Telegram.
 * Por defecto está vacío; los canales se crean y sincronizan dinámicamente
 * mediante el panel web, comandos en Telegram o al crearlos en Discord.
 */
export const INITIAL_CHANNEL_MAP: ChannelMap = {};

export const DISCORD_API = "https://discord.com/api/v10";
export const TELEGRAM_API = "https://api.telegram.org";

export function getDefaultChatId(env: { DEFAULT_TELEGRAM_CHAT_ID?: string }): number {
  if (env.DEFAULT_TELEGRAM_CHAT_ID) {
    const parsed = parseInt(env.DEFAULT_TELEGRAM_CHAT_ID, 10);
    if (!isNaN(parsed) && parsed !== 0) return parsed;
  }
  throw new Error(
    "DEFAULT_TELEGRAM_CHAT_ID no está configurado. Especifica el ID de tu supergrupo en wrangler.toml o en variables de entorno."
  );
}
