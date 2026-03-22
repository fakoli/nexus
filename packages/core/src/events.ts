import mitt from "mitt";

export type NexusEvents = {
  "gateway:started": { port: number };
  "gateway:stopped": undefined;
  "session:created": { sessionId: string; agentId: string };
  "session:message": { sessionId: string; role: string; content: string };
  "config:changed": { key: string; value: unknown };
  "auth:attempt": { method: string; success: boolean; clientId?: string };
  "audit:entry": { eventType: string; actor?: string };
};

export const events = mitt<NexusEvents>();
export type EventBus = typeof events;
