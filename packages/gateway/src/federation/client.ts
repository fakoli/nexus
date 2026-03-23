/**
 * Federation client — outbound connection to a remote Nexus gateway.
 *
 * Maintains a persistent WebSocket connection with auto-reconnect,
 * heartbeat pings, and a message queue for offline buffering.
 */
import { WebSocket } from "ws";
import { createLogger } from "@nexus/core";
import type {
  FederationFrame,
  FederatedMessage,
  FederatedStream,
  FederatedSession,
  FederationAck,
} from "./protocol.js";
import { FederationFrameSchema } from "./protocol.js";

const log = createLogger("federation:client");

const INITIAL_RECONNECT_DELAY = 1000;
const RECONNECT_MULTIPLIER = 2;

export type MessageHandler = (msg: FederatedMessage) => void;
export type StreamHandler = (stream: FederatedStream) => void;
export type SessionHandler = (session: FederatedSession) => void;
export type ConnectHandler = (ack: FederationAck) => void;
export type DisconnectHandler = (reason: string) => void;

export interface FederationClientOptions {
  localGatewayId: string;
  localGatewayName: string;
  version: string;
  heartbeatInterval: number;
  reconnectMaxDelay: number;
  messageQueueSize: number;
}

export class FederationClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly token: string;
  private readonly opts: FederationClientOptions;

  private _connected = false;
  private _remoteGatewayId = "";
  private _remoteGatewayName = "";
  private _shouldReconnect = true;
  private _reconnectDelay = INITIAL_RECONNECT_DELAY;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private _queue: string[] = [];

  private _onMessage: MessageHandler | null = null;
  private _onStream: StreamHandler | null = null;
  private _onSession: SessionHandler | null = null;
  private _onConnect: ConnectHandler | null = null;
  private _onDisconnect: DisconnectHandler | null = null;

  constructor(url: string, token: string, opts: FederationClientOptions) {
    this.url = url;
    this.token = token;
    this.opts = opts;
  }

  // ── Public API ──────────────────────────────────────────────────────

  connect(): void {
    this._shouldReconnect = true;
    this._doConnect();
  }

  disconnect(): void {
    this._shouldReconnect = false;
    this._clearTimers();
    if (this.ws) {
      this.ws.close(1000, "Federation client disconnecting");
      this.ws = null;
    }
    this._connected = false;
  }

  isConnected(): boolean {
    return this._connected;
  }

  get remoteGatewayId(): string {
    return this._remoteGatewayId;
  }

  get remoteGatewayName(): string {
    return this._remoteGatewayName;
  }

  forwardMessage(sessionId: string, message: FederatedMessage["message"]): void {
    const frame: FederatedMessage = {
      type: "federation:message",
      originGateway: this.opts.localGatewayId,
      sessionId,
      message,
      timestamp: Date.now(),
    };
    this._send(JSON.stringify(frame));
  }

  forwardStream(sessionId: string, delta: FederatedStream["delta"]): void {
    const frame: FederatedStream = {
      type: "federation:stream",
      originGateway: this.opts.localGatewayId,
      sessionId,
      delta,
    };
    this._send(JSON.stringify(frame));
  }

  syncSession(
    session: FederatedSession["session"],
    action: FederatedSession["action"],
  ): void {
    const frame: FederatedSession = {
      type: "federation:session",
      action,
      originGateway: this.opts.localGatewayId,
      session,
    };
    this._send(JSON.stringify(frame));
  }

  onMessage(handler: MessageHandler): void {
    this._onMessage = handler;
  }

  onStream(handler: StreamHandler): void {
    this._onStream = handler;
  }

  onSession(handler: SessionHandler): void {
    this._onSession = handler;
  }

  onConnect(handler: ConnectHandler): void {
    this._onConnect = handler;
  }

  onDisconnect(handler: DisconnectHandler): void {
    this._onDisconnect = handler;
  }

  // ── Internal ────────────────────────────────────────────────────────

  private _doConnect(): void {
    const wsUrl = this.url.replace(/^http/, "ws");
    const fullUrl = `${wsUrl}/ws/federation`;

    log.info({ url: fullUrl }, "Connecting to federation peer");
    this.ws = new WebSocket(fullUrl);

    this.ws.on("open", () => {
      this._sendHandshake();
    });

    this.ws.on("message", (data) => {
      this._handleRaw(data.toString());
    });

    this.ws.on("close", (code, reason) => {
      const reasonStr = reason.toString() || `code=${code}`;
      this._handleClose(reasonStr);
    });

    this.ws.on("error", (err) => {
      log.error({ url: this.url, err: err.message }, "Federation WS error");
    });
  }

  private _sendHandshake(): void {
    const handshake = JSON.stringify({
      type: "federation:hello",
      gatewayId: this.opts.localGatewayId,
      gatewayName: this.opts.localGatewayName,
      version: this.opts.version,
      capabilities: [],
      token: this.token,
    });
    this.ws?.send(handshake);
  }

  private _handleRaw(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      log.warn("Received non-JSON from federation peer");
      return;
    }

    const result = FederationFrameSchema.safeParse(parsed);
    if (!result.success) {
      log.warn({ err: result.error.message }, "Invalid federation frame");
      return;
    }

    const frame = result.data;
    this._dispatchFrame(frame);
  }

  private _dispatchFrame(frame: FederationFrame): void {
    switch (frame.type) {
      case "federation:ack":
        this._handleAck(frame);
        break;
      case "federation:message":
        this._onMessage?.(frame);
        break;
      case "federation:stream":
        this._onStream?.(frame);
        break;
      case "federation:session":
        this._onSession?.(frame);
        break;
      case "federation:hello":
        // Unexpected on client side; ignore
        break;
    }
  }

  private _handleAck(ack: FederationAck): void {
    if (!ack.accepted) {
      log.warn({ reason: ack.reason }, "Federation handshake rejected");
      this._shouldReconnect = false;
      this.ws?.close(4403, "Rejected");
      return;
    }

    this._connected = true;
    this._remoteGatewayId = ack.gatewayId;
    this._remoteGatewayName = ack.gatewayName;
    this._reconnectDelay = INITIAL_RECONNECT_DELAY;

    log.info(
      { remoteId: ack.gatewayId, remoteName: ack.gatewayName },
      "Federation peer connected",
    );

    this._startHeartbeat();
    this._flushQueue();
    this._onConnect?.(ack);
  }

  private _handleClose(reason: string): void {
    const wasConnected = this._connected;
    this._connected = false;
    this._clearTimers();

    if (wasConnected) {
      this._onDisconnect?.(reason);
    }

    if (this._shouldReconnect) {
      log.info(
        { delay: this._reconnectDelay, url: this.url },
        "Scheduling federation reconnect",
      );
      this._reconnectTimer = setTimeout(() => {
        this._reconnectDelay = Math.min(
          this._reconnectDelay * RECONNECT_MULTIPLIER,
          this.opts.reconnectMaxDelay,
        );
        this._doConnect();
      }, this._reconnectDelay);
    }
  }

  private _send(data: string): void {
    if (this._connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      if (this._queue.length < this.opts.messageQueueSize) {
        this._queue.push(data);
      } else {
        log.warn("Federation message queue full, dropping message");
      }
    }
  }

  private _flushQueue(): void {
    while (this._queue.length > 0) {
      const msg = this._queue.shift();
      if (msg && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(msg);
      }
    }
  }

  private _startHeartbeat(): void {
    this._heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, this.opts.heartbeatInterval);
  }

  private _clearTimers(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }
}
