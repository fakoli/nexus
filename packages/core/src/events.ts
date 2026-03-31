import mitt from "mitt";

export type NexusEvents = {
  "gateway:started": { port: number };
  "gateway:stopped": undefined;
  "session:created": { sessionId: string; agentId: string };
  "session:message": { sessionId: string; role: string; content: string };
  "config:changed": { key: string; value: unknown };
  "auth:attempt": { method: string; success: boolean; clientId?: string };
  "audit:entry": { eventType: string; actor?: string };
  "speech:tts": { sessionId: string; textLength: number; voice: string };
  "speech:stt": { sessionId: string; audioSize: number; language?: string };
  "federation:peer:connected": { gatewayId: string; gatewayName: string; direction: string };
  "federation:peer:disconnected": { gatewayId: string; reason?: string };
  "federation:message:received": { originGateway: string; sessionId: string };
  "federation:message:forwarded": { targetGateway: string; sessionId: string };
  "container:started": { containerId: string; image: string };
  "container:stopped": { containerId: string; exitCode: number | null };
  "container:failed": { containerId: string; error: string };
  "container:unhealthy": { containerId: string; consecutiveFailures: number };
  "container:restarted": { containerId: string; restartCount: number };
};

export const events = mitt<NexusEvents>();
export type EventBus = typeof events;
