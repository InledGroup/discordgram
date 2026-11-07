import { DiscordMessage, TelegramMessage } from "./types";

/**
 * Escapes special characters for Telegram HTML parse_mode
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Truncates long text for preview reply quotes
 */
function truncateText(text: string, maxLen = 140): string {
  const clean = text.replace(/[\r\n]+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 3) + "...";
}

/**
 * Formats a Discord reply quote for Telegram (using HTML <blockquote>)
 */
export function formatDiscordReplyQuote(referenced: DiscordMessage | null | undefined): string {
  if (!referenced) return "";

  const authorName = referenced.author?.global_name || referenced.author?.username || "User";
  let content = referenced.content ? truncateText(referenced.content) : "";

  if (!content && referenced.attachments && referenced.attachments.length > 0) {
    const isImage = referenced.attachments.some(a => a.content_type?.startsWith("image/"));
    const isVideo = referenced.attachments.some(a => a.content_type?.startsWith("video/"));
    content = isImage ? "[🖼️ Photo]" : isVideo ? "[🎥 Video]" : "[📎 Attachment]";
  }

  if (!content) {
    content = "[Previous message]";
  }

  return `<blockquote><b>↩️ In reply to @${escapeHtml(authorName)}:</b>\n${escapeHtml(content)}</blockquote>\n`;
}

/**
 * Formats a Telegram reply quote for Discord (using markdown > Blockquote)
 */
export function formatTelegramReplyQuote(replyTo: TelegramMessage | null | undefined): string {
  if (!replyTo) return "";

  // Ignore if it's the forum topic creation message
  if (replyTo.forum_topic_created) return "";

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
