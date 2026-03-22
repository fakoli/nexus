import { z } from "zod";
export declare const ChannelId: z.ZodBranded<z.ZodString, "ChannelId">;
export type ChannelId = z.infer<typeof ChannelId>;
export declare const SessionId: z.ZodBranded<z.ZodString, "SessionId">;
export type SessionId = z.infer<typeof SessionId>;
export declare const AgentId: z.ZodBranded<z.ZodString, "AgentId">;
export type AgentId = z.infer<typeof AgentId>;
export declare const PeerId: z.ZodBranded<z.ZodString, "PeerId">;
export type PeerId = z.infer<typeof PeerId>;
export declare const DeviceId: z.ZodBranded<z.ZodString, "DeviceId">;
export type DeviceId = z.infer<typeof DeviceId>;
export type MessageRole = "user" | "assistant" | "tool_use" | "tool_result" | "system";
export interface Message {
    id: number;
    sessionId: string;
    role: MessageRole;
    content: string;
    metadata?: Record<string, unknown>;
    createdAt: number;
}
export interface Session {
    id: string;
    agentId: string;
    channel?: string;
    peerId?: string;
    state: "active" | "archived" | "deleted";
    metadata?: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
}
export interface Agent {
    id: string;
    config: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
}
export interface AuditEntry {
    id: number;
    eventType: string;
    actor?: string;
    details?: Record<string, unknown>;
    createdAt: number;
}
export interface PairedDevice {
    id: string;
    name?: string;
    platform?: string;
    publicKey?: string;
    tokenHash: string;
    capabilities?: string[];
    pairedAt: number;
    lastSeenAt?: number;
}
export interface CronJob {
    id: string;
    schedule: string;
    agentId: string;
    message: string;
    enabled: boolean;
    lastRunAt?: number;
    nextRunAt?: number;
}
//# sourceMappingURL=types.d.ts.map