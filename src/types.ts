export interface Env {
  DISCORD_BOT_TOKEN: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  DEFAULT_TELEGRAM_CHAT_ID?: string;
  DISCORD_GUILD_ID?: string;
  AUTO_CREATE_TOPICS?: string;
  DASHBOARD_PASSWORD?: string;
  ALTCHA_HMAC_KEY?: string;

  DISCORD_GATEWAY: DurableObjectNamespace;
  STATUS_STORE: DurableObjectNamespace;
}

export interface ChannelTarget {
  chatId: number;
  threadId: number;
  name?: string;
}

export type ChannelMap = Record<string, ChannelTarget>;

export interface GatewayStatus {
  connected: boolean;
  lastDispatch: string | null;
  username?: string;
}

export interface AppStatus {
  gateway: GatewayStatus;
  lastTelegramPing: string | null;
  lastTelegramMessage: string | null;
  lastDiscordMessage: string | null;
  lastError: string | null;
  updatedAt: string;
}

export interface DiscordAttachment {
  id: string;
  filename: string;
  size: number;
  url: string;
  proxy_url?: string;
  content_type?: string;
  width?: number;
  height?: number;
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  bot?: boolean;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  content: string;
  author: DiscordUser;
  attachments?: DiscordAttachment[];
  referenced_message?: DiscordMessage | null;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
  title?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  message_thread_id?: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  reply_to_message?: TelegramMessage;
  photo?: TelegramPhotoSize[];
  video?: {
    file_id: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  };
  animation?: {
    file_id: string;
    file_name?: string;
    mime_type?: string;
  };
  document?: {
    file_id: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  };
  forum_topic_created?: {
    name: string;
    icon_color: number;
    icon_custom_emoji_id?: string;
  };
  is_topic_message?: boolean;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}
