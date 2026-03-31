import { createSignal } from "solid-js";
import { DEFAULT_GATEWAY_URL } from "../constants";
import { parseHelloOk, parseResponseFrame, parseEventFrame } from "./validation";
import type {
  ConnectParams,
  EventFrame,
  EventName,
  RequestFrame,
  RequestMethod,
  ResponseFrame,
} from "./types";

const GATEWAY_URL = DEFAULT_GATEWAY_URL;
const CLIENT_INFO = { name: "nexus-ui", version: "0.1.0" } as const;

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 15_000;

type EventCallback = (payload: EventFrame["payload"]) => void;
type PendingRequest = {
  resolve: (payload: ResponseFrame["payload"]) => void;
  reject: (err: Error) => void;
};

function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);
}

function generateId(): string {
  return crypto.randomUUID();
}

export interface GatewayClient {
  connect(newUrl?: string, newToken?: string): Promise<void>;
  disconnect(): void;
  request(method: RequestMethod, params?: Record<string, unknown>): Promise<ResponseFrame["payload"]>;
  onEvent(name: EventName, callback: EventCallback): () => void;
  connected: () => boolean;
}

export function createGatewayClient(
  initialUrl: string = GATEWAY_URL,
  initialToken: string = "",
  password: string = "",
): GatewayClient {
  let url = initialUrl;
  let token = initialToken;
  let ws: WebSocket | null = null;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let intentionalClose = false;

  const [connected, setConnected] = createSignal(false);
  const pending = new Map<string, PendingRequest>();
  const listeners = new Map<EventName, Set<EventCallback>>();

  function emit(name: EventName, payload: EventFrame["payload"]): void {
    listeners.get(name)?.forEach((cb) => cb(payload));
  }

  function send(data: unknown): void {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  function rejectAll(reason: string): void {
    const err = new Error(reason);
    pending.forEach(({ reject }) => reject(err));
    pending.clear();
  }

  function scheduleReconnect(): void {
    if (intentionalClose) return;
    const delay = backoffMs(attempt++);
    reconnectTimer = setTimeout(() => open(), delay);
  }

  function open(): void {
    if (ws) {
      ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
      ws.close();
    }

    ws = new WebSocket(url);

    ws.onopen = () => {
      const params: ConnectParams = {
        token,
        password,
        client: CLIENT_INFO,
      };
      send(params);
    };

    ws.onmessage = (ev: MessageEvent) => {
      let msg: unknown;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }

      if (!msg || typeof msg !== "object") return;
      const obj = msg as Record<string, unknown>;

      // HelloOk — first message after open (has proto + session fields)
      if ("proto" in obj && "session" in obj) {
        const hello = parseHelloOk(obj);
        if (!hello) return;
        attempt = 0;
        setConnected(true);
        emit("session:created", {
          id: hello.session.id,
          agentId: hello.session.agentId,
          server: hello.server,
        });
        return;
      }

      // ResponseFrame — matches a pending request
      if ("id" in obj && "ok" in obj) {
        const frame = parseResponseFrame(obj);
        if (!frame) return;
        const pending_req = pending.get(frame.id);
        if (pending_req) {
          pending.delete(frame.id);
          if (frame.ok) {
            pending_req.resolve(frame.payload);
          } else {
            pending_req.reject(
              new Error(frame.error?.message ?? "request failed"),
            );
          }
        }
        return;
      }

      // EventFrame — server push
      if ("event" in obj && "seq" in obj) {
        const frame = parseEventFrame(obj);
        if (!frame) return;
        emit(frame.event, frame.payload);
        return;
      }
    };

    ws.onerror = () => {
      // onclose will fire next and trigger reconnect
    };

    ws.onclose = () => {
      setConnected(false);
      rejectAll("WebSocket closed");
      scheduleReconnect();
    };
  }

  return {
    connect(newUrl?: string, newToken?: string): Promise<void> {
      if (newUrl) url = newUrl;
      if (newToken) token = newToken;
      intentionalClose = false;
      attempt = 0;
      return new Promise<void>((resolve, reject) => {
        const unsub = this.onEvent("session:created", () => {
          clearTimeout(timer);
          unsub();
          resolve();
        });
        const timer = setTimeout(() => {
          unsub();
          reject(new Error("Connection timeout"));
        }, 10_000);
        open();
      });
    },

    disconnect(): void {
      intentionalClose = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      rejectAll("Client disconnected");
      ws?.close();
      ws = null;
      setConnected(false);
    },

    request(
      method: RequestMethod,
      params: Record<string, unknown> = {},
    ): Promise<ResponseFrame["payload"]> {
      return new Promise((resolve, reject) => {
        if (!connected()) {
          reject(new Error("Not connected"));
          return;
        }
        const frame: RequestFrame = { id: generateId(), method, params };
        pending.set(frame.id, { resolve, reject });
        send(frame);
      });
    },

    onEvent(name: EventName, callback: EventCallback): () => void {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(callback);
      return () => listeners.get(name)?.delete(callback);
    },

    connected,
  };
}
