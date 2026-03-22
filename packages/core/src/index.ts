export { getDb, closeDb, runMigrations, getDataDir } from "./db.js";
export {
  getConfig,
  setConfig,
  getAllConfig,
  NexusConfigSchema,
  GatewayConfigSchema,
  AgentConfigSchema,
  SecurityConfigSchema,
  ChannelsConfigSchema,
} from "./config.js";
export type { NexusConfig, GatewayConfig, AgentConfig, SecurityConfig, ChannelsConfig } from "./config.js";
export { createLogger } from "./logger.js";
export type { Logger } from "./logger.js";
export { events } from "./events.js";
export type { NexusEvents, EventBus } from "./events.js";
export {
  encrypt,
  decrypt,
  storeCredential,
  retrieveCredential,
  timingSafeEqual,
  initMasterKey,
} from "./crypto.js";
export { recordAudit, queryAudit } from "./audit.js";
export { checkRateLimit, resetRateLimit } from "./rate-limit.js";
export {
  createSession,
  getSession,
  getOrCreateSession,
  listSessions,
  appendMessage,
  getMessages,
  getMessageCount,
} from "./sessions.js";
export { createAgent, getAgent, getOrCreateAgent, listAgents, updateAgent } from "./agents.js";
export type {
  Message,
  Session,
  Agent,
  AuditEntry,
  PairedDevice,
  CronJob,
  MessageRole,
} from "./types.js";
