/**
 * Discord Gateway WebSocket client.
 *
 * Handles the full Gateway lifecycle:
 *   HELLO → Identify → READY → event stream
 *
 * Supports resumption on disconnect and sequence-number tracking.
 */
import WebSocket from "ws";
import { createLogger } from "@nexus/core";
import {
  GatewayOp,
  GatewayIntent,
  type GatewayPayload,
  type HelloData,
  type ReadyData,
  type DiscordMessage,
} from "./types.js";

const log = createLogger("discord:gateway");

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const RECONNECT_DELAY_MS = 5_000;
const JITTER_MS = 1_000;

export type MessageCreateHandler = (msg: DiscordMessage) => void;

export class DiscordGateway {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatAcked = true;
  private seq: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;
  private botUserId: string | null = null;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly messageHandlers: MessageCreateHandler[] = [];

  constructor(private readonly token: string) {}

  // ── Public API ──────────────────────────────────────────────────────

  onMessageCreate(handler: MessageCreateHandler): void {
    this.messageHandlers.push(handler);
  }

  getBotUserId(): string | null {
    return this.botUserId;
  }

  connect(url = GATEWAY_URL): void {
    this.stopped = false;
    this.openSocket(url);
  }

  disconnect(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }
  }

  // ── Socket lifecycle ────────────────────────────────────────────────

  private openSocket(url: string): void {
    log.info({ url }, "Opening gateway socket");
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on("open", () => log.debug("Gateway socket open"));

    ws.on("message", (data) => {
      let payload: GatewayPayload;
      try {
        payload = JSON.parse(data.toString()) as GatewayPayload;
      } catch (err) {
        log.error({ err }, "Failed to parse gateway payload");
        return;
      }
      this.handlePayload(payload);
    });

    ws.on("close", (code, reason) => {
      log.warn({ code, reason: reason.toString() }, "Gateway socket closed");
      this.clearTimers();
      this.ws = null;
      if (!this.stopped) {
        this.scheduleReconnect();
      }
    });

    ws.on("error", (err) => {
      log.error({ err: err.message }, "Gateway socket error");
    });
  }

  // ── Payload dispatch ────────────────────────────────────────────────

  private handlePayload(payload: GatewayPayload): void {
    if (payload.s !== null) {
      this.seq = payload.s;
    }

    switch (payload.op) {
      case GatewayOp.Hello:
        this.onHello(payload.d as HelloData);
        break;
      case GatewayOp.HeartbeatAck:
        this.heartbeatAcked = true;
        log.debug("Heartbeat ack received");
        break;
      case GatewayOp.Heartbeat:
        this.sendHeartbeat();
        break;
      case GatewayOp.Reconnect:
        log.info("Gateway requested reconnect");
        this.reconnect();
        break;
      case GatewayOp.InvalidSession:
        log.warn("Invalid session, re-identifying");
        this.sessionId = null;
        this.seq = null;
        setTimeout(() => this.sendIdentify(), 1000 + Math.random() * JITTER_MS);
        break;
      case GatewayOp.Dispatch:
        this.onDispatch(payload.t, payload.d);
        break;
    }
  }

  // ── Gateway events ──────────────────────────────────────────────────

  private onHello(data: HelloData): void {
    log.info({ interval: data.heartbeat_interval }, "Received HELLO");
    this.startHeartbeat(data.heartbeat_interval);

    if (this.sessionId && this.seq !== null) {
      this.sendResume();
    } else {
      this.sendIdentify();
    }
  }

  private onDispatch(event: string | null, data: unknown): void {
    if (event === "READY") {
      const ready = data as ReadyData;
      this.botUserId = ready.user.id;
      this.sessionId = ready.session_id;
      this.resumeUrl = ready.resume_gateway_url;
      log.info({ userId: this.botUserId, sessionId: this.sessionId }, "Gateway READY");
    } else if (event === "MESSAGE_CREATE") {
      const msg = data as DiscordMessage;
      for (const handler of this.messageHandlers) {
        handler(msg);
      }
    }
  }

  // ── Outbound payloads ───────────────────────────────────────────────

  private sendIdentify(): void {
    const intents =
      GatewayIntent.Guilds |
      GatewayIntent.GuildMessages |
      GatewayIntent.DirectMessages |
      GatewayIntent.MessageContent;

    this.send({
      op: GatewayOp.Identify,
      d: {
        token: this.token,
        intents,
        properties: { os: "linux", browser: "nexus", device: "nexus" },
      },
    });
    log.debug({ intents }, "Sent Identify");
  }

  private sendResume(): void {
    this.send({
      op: GatewayOp.Resume,
      d: { token: this.token, session_id: this.sessionId, seq: this.seq },
    });
    log.debug({ sessionId: this.sessionId, seq: this.seq }, "Sent Resume");
  }

  private sendHeartbeat(): void {
    if (!this.heartbeatAcked) {
      log.warn("Heartbeat not acked, reconnecting (zombie connection)");
      this.reconnect();
      return;
    }
    this.heartbeatAcked = false;
    this.send({ op: GatewayOp.Heartbeat, d: this.seq });
    log.debug({ seq: this.seq }, "Sent heartbeat");
  }

  // ── Heartbeat loop ──────────────────────────────────────────────────

  private startHeartbeat(intervalMs: number): void {
    this.clearHeartbeat();
    // Jitter the first beat using the heartbeatTimer slot so that clearTimers()
    // does not inadvertently cancel a reconnect that is already scheduled, and
    // so that clearHeartbeat() correctly cancels both the initial timeout and
    // the subsequent interval.
    const firstBeat = Math.random() * intervalMs;
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null;
      this.sendHeartbeat();
      this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), intervalMs);
    }, firstBeat) as unknown as ReturnType<typeof setInterval>;
  }

  // ── Reconnect / resume logic ────────────────────────────────────────

  private reconnect(): void {
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
    if (!this.stopped) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    const delay = RECONNECT_DELAY_MS + Math.random() * JITTER_MS;
    log.info({ delay }, "Scheduling reconnect");
    this.reconnectTimer = setTimeout(() => {
      const url = this.resumeUrl ?? GATEWAY_URL;
      this.openSocket(url);
    }, delay);
  }

  // ── Low-level send ──────────────────────────────────────────────────

  private send(payload: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.warn("Attempted to send on closed socket, dropping");
      return;
    }
    this.ws.send(JSON.stringify(payload));
  }

  // ── Cleanup ─────────────────────────────────────────────────────────

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
