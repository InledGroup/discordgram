import { DurableObject } from "cloudflare:workers";
import { INITIAL_CHANNEL_MAP } from "./config";
import { AppStatus, ChannelMap, ChannelTarget, Env } from "./types";

export class StatusStore extends DurableObject {
  private memoryStatus: AppStatus | null = null;
  private memoryChannels: ChannelMap | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  private emptyStatus(): AppStatus {
    return {
      gateway: { connected: false, lastDispatch: null },
      lastTelegramPing: null,
      lastTelegramMessage: null,
      lastDiscordMessage: null,
      lastError: null,
      updatedAt: new Date().toISOString(),
    };
  }

  async readStatus(): Promise<AppStatus> {
    if (this.memoryStatus) return this.memoryStatus;
    const s = await this.ctx.storage.get<AppStatus>("status");
    this.memoryStatus = s ?? this.emptyStatus();
    return this.memoryStatus;
  }

  async writeStatus(status: AppStatus): Promise<void> {
    // Keep in RAM without burning storage writes on every single message
    this.memoryStatus = status;
  }

  async readChannels(): Promise<ChannelMap> {
    if (this.memoryChannels) return this.memoryChannels;
    const channels = await this.ctx.storage.get<ChannelMap>("channels");
    if (!channels || Object.keys(channels).length === 0) {
      await this.ctx.storage.put("channels", INITIAL_CHANNEL_MAP);
      this.memoryChannels = { ...INITIAL_CHANNEL_MAP };
      return this.memoryChannels;
    }
    this.memoryChannels = channels;
    return this.memoryChannels;
  }

  async setChannel(channelId: string, target: ChannelTarget): Promise<ChannelMap> {
    const channels = await this.readChannels();
    channels[channelId] = target;
    this.memoryChannels = channels;
    await this.ctx.storage.put("channels", channels);
    return channels;
  }

  async deleteChannel(channelId: string): Promise<ChannelMap> {
    const channels = await this.readChannels();
    delete channels[channelId];
    this.memoryChannels = channels;
    await this.ctx.storage.put("channels", channels);
    return channels;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // --- Rutas de Estado ---
    if (path.endsWith("/status") && request.method === "GET") {
      return Response.json(await this.readStatus());
    }

    if (path.endsWith("/update") && request.method === "POST") {
      const patch = (await request.json()) as Partial<AppStatus>;
      const current = await this.readStatus();
      const merged: AppStatus = { ...current };

      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        if (k === "gateway" && typeof v === "object" && v !== null) {
          merged.gateway = { ...current.gateway, ...v };
        } else {
          (merged as any)[k] = v;
        }
      }
      merged.updatedAt = new Date().toISOString();
      await this.writeStatus(merged);
      return Response.json({ ok: true });
    }

    // --- Rutas de Gestión de Canales ---
    if (path === "/channels" && request.method === "GET") {
      return Response.json(await this.readChannels());
    }

    if (path === "/channels" && request.method === "POST") {
      const body = (await request.json()) as { channelId: string; target: ChannelTarget };
      const updated = await this.setChannel(body.channelId, body.target);
      return Response.json({ ok: true, channels: updated });
    }

    if (path.startsWith("/channels/") && request.method === "DELETE") {
      const channelId = path.split("/").pop();
      if (channelId) {
        const updated = await this.deleteChannel(channelId);
        return Response.json({ ok: true, channels: updated });
      }
      return new Response("Missing channel id", { status: 400 });
    }

    return new Response("Not found", { status: 404 });
  }
}
