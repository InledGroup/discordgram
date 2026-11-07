import { DiscordMessage, TelegramMessage } from "./types";

/**
 * Escapa caracteres especiales para parse_mode HTML de Telegram
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Trunca texto largo para citas previas
 */
function truncateText(text: string, maxLen = 140): string {
  const clean = text.replace(/[\r\n]+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 3) + "...";
}

/**
 * Formatea la cita de respuesta de un mensaje de Discord para Telegram (usando <blockquote> HTML)
 */
export function formatDiscordReplyQuote(referenced: DiscordMessage | null | undefined): string {
  if (!referenced) return "";

  const authorName = referenced.author?.global_name || referenced.author?.username || "Usuario";
  let content = referenced.content ? truncateText(referenced.content) : "";

  if (!content && referenced.attachments && referenced.attachments.length > 0) {
    const isImage = referenced.attachments.some(a => a.content_type?.startsWith("image/"));
    const isVideo = referenced.attachments.some(a => a.content_type?.startsWith("video/"));
    content = isImage ? "[🖼️ Imagen]" : isVideo ? "[🎥 Vídeo]" : "[📎 Archivo adjunto]";
  }

  if (!content) {
    content = "[Mensaje anterior]";
  }

  return `<blockquote><b>↩️ En respuesta a @${escapeHtml(authorName)}:</b>\n${escapeHtml(content)}</blockquote>\n`;
}

/**
 * Formatea la cita de respuesta de un mensaje de Telegram para Discord (usando formato > Blockquote)
 */
export function formatTelegramReplyQuote(replyTo: TelegramMessage | null | undefined): string {
  if (!replyTo) return "";

  // Ignorar si es el mensaje automático de creación del tema del foro
  if (replyTo.forum_topic_created) return "";

  const from = replyTo.from;
  const authorName = from ? (from.first_name + (from.last_name ? ` ${from.last_name}` : "")) : "Usuario";

  let content = replyTo.text || replyTo.caption || "";
  if (content) {
    content = truncateText(content);
  } else if (replyTo.photo && replyTo.photo.length > 0) {
    content = "[🖼️ Foto]";
  } else if (replyTo.video) {
    content = "[🎥 Vídeo]";
  } else if (replyTo.animation) {
    content = "[🎞️ GIF]";
  } else if (replyTo.document) {
    content = `[📎 Documento: ${replyTo.document.file_name || "archivo"}]`;
  } else {
    content = "[Mensaje anterior]";
  }

  return `> ↩️ **En respuesta a @${authorName}:** ${content}\n\n`;
}
