import type { Agent } from "./types.js";
export declare function createAgent(id: string, config?: Record<string, unknown>): Agent;
export declare function getAgent(id: string): Agent | null;
export declare function getOrCreateAgent(id: string, config?: Record<string, unknown>): Agent;
export declare function listAgents(): Agent[];
export declare function updateAgent(id: string, config: Record<string, unknown>): void;
//# sourceMappingURL=agents.d.ts.map