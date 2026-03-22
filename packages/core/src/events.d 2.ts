export type NexusEvents = {
    "gateway:started": {
        port: number;
    };
    "gateway:stopped": undefined;
    "session:created": {
        sessionId: string;
        agentId: string;
    };
    "session:message": {
        sessionId: string;
        role: string;
        content: string;
    };
    "config:changed": {
        key: string;
        value: unknown;
    };
    "auth:attempt": {
        method: string;
        success: boolean;
        clientId?: string;
    };
    "audit:entry": {
        eventType: string;
        actor?: string;
    };
};
export declare const events: import("mitt").Emitter<NexusEvents>;
export type EventBus = typeof events;
//# sourceMappingURL=events.d.ts.map