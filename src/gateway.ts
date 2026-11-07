import { DurableObject } from "cloudflare:workers";
import { Env } from "./types";

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const;

// GUILDS (1 << 0) + GUILD_MESSAGES (1 << 9) + MESSAGE_CONTENT (1 << 15)
const INTENTS = (1 << 0) | (1 << 9) | (1 << 15);

export class DiscordGateway extends DurableObject {
  private ws: WebSocket | null = null;
  private seq: number | null = null;
  private heartbeatIntervalMs = 41250;
  private connected = false;
  private reconnectAttempt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async getWebhookUrl(): Promise<string | null> {
    return (await this.ctx.storage.get<string>("webhookUrl")) ?? null;
  }

  async getStatusUrl(): Promise<string | null> {
    return (await this.ctx.storage.get<string>("statusUrl")) ?? null;
  }

  async alarm(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.connected) {
      await this.connectGateway(undefined, true);
      return;
    }
    await this.sendHeartbeat();
  }

  async scheduleAlarm(delayMs: number): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + delayMs);
  }

  async sendHeartbeat(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: OP.HEARTBEAT, d: this.seq }));
      await this.scheduleAlarm(this.heartbeatIntervalMs);
    }
  }

  async connectGateway(webhookUrl?: string, force = false): Promise<void> {
    if (webhookUrl) {
      await this.ctx.storage.put("webhookUrl", webhookUrl);
    }

    const url = await this.getWebhookUrl();
    if (!url) {
      throw new Error("connect() requiere una webhookUrl registrada");
    }

    if (!force && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.connected = true;
      return;
    }

    try {
      this.ws?.close();
    } catch {
      // Ignorar error al cerrar socket previo
    }

    const ws = new WebSocket(GATEWAY_URL);
    this.ws = ws;

    ws.addEventListener("message", (event) => {
      void this.handleGatewayMessage(event.data as string);
    });

    ws.addEventListener("close", () => {
      this.connected = false;
      this.retry();
    });

    ws.addEventListener("error", () => {
      this.connected = false;
    });
  }

  private retry(): void {
    const backoff = Math.min(30000, 1000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    void this.scheduleAlarm(backoff + Math.random() * 500);
  }

  private async handleGatewayMessage(raw: string): Promise<void> {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.s != null) this.seq = msg.s;

    switch (msg.op) {
      case OP.HELLO: {
        const hello = msg.d;
        this.heartbeatIntervalMs = hello.heartbeat_interval;
        this.connected = true;
        this.reconnectAttempt = 0;
        this.ws?.send(JSON.stringify({ op: OP.IDENTIFY, d: this.identifyPayload() }));
        await this.scheduleAlarm(this.heartbeatIntervalMs);
        break;
      }
      case OP.HEARTBEAT_ACK: {
        await this.scheduleAlarm(this.heartbeatIntervalMs);
        break;
      }
      case OP.RECONNECT: {
        this.connected = false;
        await this.connectGateway(undefined, true);
        break;
      }
      case OP.INVALID_SESSION: {
        this.connected = false;
        await this.delay(1500 + Math.random() * 1500);
        await this.connectGateway(undefined, true);
        break;
      }
      case OP.DISPATCH: {
        await this.handleDispatch(msg);
        break;
      }
    }
  }

  private identifyPayload() {
    return {
      token: (this.env as Env).DISCORD_BOT_TOKEN,
      intents: INTENTS,
      properties: {
        os: "cloudflare-workers",
        browser: "discordgram",
        device: "discordgram",
      },
    };
  }

  private async handleDispatch(msg: any): Promise<void> {
    if (msg.t === "READY") {
      const d = msg.d;
      this.connected = true;
      await this.reportStatus({ gateway: "connected", username: d.user?.username });
      return;
    }

    if (msg.t === "RESUMED") {
      this.connected = true;
      await this.reportStatus({ gateway: "connected", username: "resumed" });
      return;
    }

    if (msg.t === "MESSAGE_CREATE") {
      await this.ctx.storage.put("lastDispatch", new Date().toISOString());
      await this.forwardEvent("MESSAGE_CREATE", msg.d);
      return;
    }

    // Auto-detección cuando se crea un nuevo canal en Discord
    if (msg.t === "CHANNEL_CREATE") {
      await this.forwardEvent("CHANNEL_CREATE", msg.d);
      return;
    }

    if (msg.t === "CHANNEL_DELETE") {
      await this.forwardEvent("CHANNEL_DELETE", msg.d);
      return;
    }
  }

  private async forwardEvent(event: string, data: any): Promise<void> {
    const url = await this.getWebhookUrl();
    if (!url) return;

    try {
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-discordgram-gateway": "gateway-event",
        },
        body: JSON.stringify({ event, data }),
      });
    } catch (err) {
      console.error(`Error reenviando evento ${event} del gateway:`, err);
    }
  }

  private async reportStatus(status: any): Promise<void> {
    const url = await this.getStatusUrl();
    if (!url) return;

    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(status),
      });
    } catch {
      // Ignorar fallos de reporte interno
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async status() {
    const open = this.ws?.readyState === WebSocket.OPEN && this.connected;
    const lastDispatch = (await this.ctx.storage.get<string>("lastDispatch")) ?? null;
    const seenRecently =
      !!lastDispatch && Date.now() - new Date(lastDispatch).getTime() < 2 * 60 * 1000;

    return {
      connected: !!open || seenRecently,
      lastDispatch,
    };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname.endsWith("/connect")) {
      const { webhookUrl, statusUrl } = (await request.json()) as {
        webhookUrl?: string;
        statusUrl?: string;
      };
      if (statusUrl) await this.ctx.storage.put("statusUrl", statusUrl);
      await this.connectGateway(webhookUrl, true);
      return Response.json({ ok: true });
    }

    if (request.method === "GET" && url.pathname.endsWith("/status")) {
      return Response.json(await this.status());
    }

    return new Response("Not found", { status: 404 });
  }
}
