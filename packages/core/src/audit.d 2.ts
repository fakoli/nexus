import type { AuditEntry } from "./types.js";
export declare function recordAudit(eventType: string, actor?: string, details?: Record<string, unknown>): number;
export declare function queryAudit(eventType?: string, limit?: number, offset?: number): AuditEntry[];
//# sourceMappingURL=audit.d.ts.map