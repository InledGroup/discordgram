import { DiscordAttachment, Env, TelegramMessage } from "./types";
import { TELEGRAM_API } from "./config";

export interface MediaItem {
  type: "photo" | "video" | "document";
  url: string;
  filename?: string;
  contentType?: string;
}

/**
 * Extrae adjuntos de imagen o vídeo de un mensaje de Discord
 */
export function extractDiscordMedia(attachments?: DiscordAttachment[]): MediaItem[] {
  if (!attachments || attachments.length === 0) return [];

  const media: MediaItem[] = [];
  for (const att of attachments) {
    const ct = att.content_type?.toLowerCase() || "";
    const fn = att.filename?.toLowerCase() || "";

    if (
      ct.startsWith("image/") ||
      fn.endsWith(".jpg") ||
      fn.endsWith(".jpeg") ||
      fn.endsWith(".png") ||
      fn.endsWith(".gif") ||
      fn.endsWith(".webp")
    ) {
      media.push({
        type: "photo",
        url: att.url,
        filename: att.filename,
        contentType: att.content_type,
      });
    } else if (
      ct.startsWith("video/") ||
      fn.endsWith(".mp4") ||
      fn.endsWith(".mov") ||
      fn.endsWith(".webm")
    ) {
      media.push({
        type: "video",
        url: att.url,
        filename: att.filename,
        contentType: att.content_type,
      });
    } else {
      media.push({
        type: "document",
        url: att.url,
        filename: att.filename,
        contentType: att.content_type,
      });
    }
  }

  return media;
}

/**
 * Obtiene la ruta relativa del archivo en los servidores de Telegram
 */
export async function getTelegramMediaFilePath(
  env: Env,
  message: TelegramMessage
): Promise<{ filePath: string; filename: string } | null> {
  let fileId: string | undefined;
  let filename = "media";

  if (message.photo && message.photo.length > 0) {
    const best = message.photo[message.photo.length - 1];
    fileId = best.file_id;
    filename = `photo_${best.file_unique_id}.jpg`;
  } else if (message.video) {
    fileId = message.video.file_id;
    filename = message.video.file_name || `video_${Date.now()}.mp4`;
  } else if (message.animation) {
    fileId = message.animation.file_id;
    filename = message.animation.file_name || `animation_${Date.now()}.mp4`;
  } else if (message.document) {
    fileId = message.document.file_id;
    filename = message.document.file_name || `doc_${Date.now()}`;
  }

  if (!fileId) return null;

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/getFile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { ok: boolean; result?: { file_path?: string } };
    const filePath = data.result?.file_path;
    if (!filePath) return null;

    return {
      filePath,
      filename,
    };
  } catch (err) {
    console.error("Error obteniendo archivo de Telegram:", err);
    return null;
  }
}
