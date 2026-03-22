import type { Session, Message } from "./types.js";
export declare function createSession(id: string, agentId: string, channel?: string, peerId?: string): Session;
export declare function getSession(id: string): Session | null;
export declare function getOrCreateSession(id: string, agentId: string, channel?: string, peerId?: string): Session;
export declare function listSessions(agentId?: string, state?: string): Session[];
export declare function appendMessage(sessionId: string, role: string, content: string, metadata?: Record<string, unknown>): number;
export declare function getMessages(sessionId: string, limit?: number, offset?: number): Message[];
export declare function getMessageCount(sessionId: string): number;
//# sourceMappingURL=sessions.d.ts.map