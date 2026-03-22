import { z } from "zod";
export declare const GatewayConfigSchema: z.ZodObject<{
    port: z.ZodDefault<z.ZodNumber>;
    bind: z.ZodDefault<z.ZodEnum<["loopback", "lan", "all"]>>;
    verbose: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    port: number;
    bind: "loopback" | "lan" | "all";
    verbose: boolean;
}, {
    port?: number | undefined;
    bind?: "loopback" | "lan" | "all" | undefined;
    verbose?: boolean | undefined;
}>;
export declare const AgentConfigSchema: z.ZodObject<{
    defaultProvider: z.ZodDefault<z.ZodString>;
    defaultModel: z.ZodDefault<z.ZodString>;
    workspace: z.ZodOptional<z.ZodString>;
    thinkLevel: z.ZodDefault<z.ZodEnum<["off", "low", "medium", "high"]>>;
}, "strip", z.ZodTypeAny, {
    defaultProvider: string;
    defaultModel: string;
    thinkLevel: "off" | "low" | "medium" | "high";
    workspace?: string | undefined;
}, {
    defaultProvider?: string | undefined;
    defaultModel?: string | undefined;
    workspace?: string | undefined;
    thinkLevel?: "off" | "low" | "medium" | "high" | undefined;
}>;
export declare const SecurityConfigSchema: z.ZodObject<{
    gatewayToken: z.ZodOptional<z.ZodString>;
    gatewayPassword: z.ZodOptional<z.ZodString>;
    dmPolicy: z.ZodDefault<z.ZodEnum<["pairing", "open", "deny"]>>;
    promptGuard: z.ZodDefault<z.ZodEnum<["enforce", "warn", "off"]>>;
}, "strip", z.ZodTypeAny, {
    dmPolicy: "pairing" | "open" | "deny";
    promptGuard: "warn" | "off" | "enforce";
    gatewayToken?: string | undefined;
    gatewayPassword?: string | undefined;
}, {
    gatewayToken?: string | undefined;
    gatewayPassword?: string | undefined;
    dmPolicy?: "pairing" | "open" | "deny" | undefined;
    promptGuard?: "warn" | "off" | "enforce" | undefined;
}>;
export declare const NexusConfigSchema: z.ZodObject<{
    gateway: z.ZodDefault<z.ZodObject<{
        port: z.ZodDefault<z.ZodNumber>;
        bind: z.ZodDefault<z.ZodEnum<["loopback", "lan", "all"]>>;
        verbose: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        port: number;
        bind: "loopback" | "lan" | "all";
        verbose: boolean;
    }, {
        port?: number | undefined;
        bind?: "loopback" | "lan" | "all" | undefined;
        verbose?: boolean | undefined;
    }>>;
    agent: z.ZodDefault<z.ZodObject<{
        defaultProvider: z.ZodDefault<z.ZodString>;
        defaultModel: z.ZodDefault<z.ZodString>;
        workspace: z.ZodOptional<z.ZodString>;
        thinkLevel: z.ZodDefault<z.ZodEnum<["off", "low", "medium", "high"]>>;
    }, "strip", z.ZodTypeAny, {
        defaultProvider: string;
        defaultModel: string;
        thinkLevel: "off" | "low" | "medium" | "high";
        workspace?: string | undefined;
    }, {
        defaultProvider?: string | undefined;
        defaultModel?: string | undefined;
        workspace?: string | undefined;
        thinkLevel?: "off" | "low" | "medium" | "high" | undefined;
    }>>;
    security: z.ZodDefault<z.ZodObject<{
        gatewayToken: z.ZodOptional<z.ZodString>;
        gatewayPassword: z.ZodOptional<z.ZodString>;
        dmPolicy: z.ZodDefault<z.ZodEnum<["pairing", "open", "deny"]>>;
        promptGuard: z.ZodDefault<z.ZodEnum<["enforce", "warn", "off"]>>;
    }, "strip", z.ZodTypeAny, {
        dmPolicy: "pairing" | "open" | "deny";
        promptGuard: "warn" | "off" | "enforce";
        gatewayToken?: string | undefined;
        gatewayPassword?: string | undefined;
    }, {
        gatewayToken?: string | undefined;
        gatewayPassword?: string | undefined;
        dmPolicy?: "pairing" | "open" | "deny" | undefined;
        promptGuard?: "warn" | "off" | "enforce" | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    gateway: {
        port: number;
        bind: "loopback" | "lan" | "all";
        verbose: boolean;
    };
    agent: {
        defaultProvider: string;
        defaultModel: string;
        thinkLevel: "off" | "low" | "medium" | "high";
        workspace?: string | undefined;
    };
    security: {
        dmPolicy: "pairing" | "open" | "deny";
        promptGuard: "warn" | "off" | "enforce";
        gatewayToken?: string | undefined;
        gatewayPassword?: string | undefined;
    };
}, {
    gateway?: {
        port?: number | undefined;
        bind?: "loopback" | "lan" | "all" | undefined;
        verbose?: boolean | undefined;
    } | undefined;
    agent?: {
        defaultProvider?: string | undefined;
        defaultModel?: string | undefined;
        workspace?: string | undefined;
        thinkLevel?: "off" | "low" | "medium" | "high" | undefined;
    } | undefined;
    security?: {
        gatewayToken?: string | undefined;
        gatewayPassword?: string | undefined;
        dmPolicy?: "pairing" | "open" | "deny" | undefined;
        promptGuard?: "warn" | "off" | "enforce" | undefined;
    } | undefined;
}>;
export type NexusConfig = z.infer<typeof NexusConfigSchema>;
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;
export declare function getConfig(key: string): unknown;
export declare function setConfig(key: string, value: unknown): void;
export declare function getAllConfig(): NexusConfig;
export declare function setConfigSection(section: string, value: unknown): void;
//# sourceMappingURL=config.d.ts.map