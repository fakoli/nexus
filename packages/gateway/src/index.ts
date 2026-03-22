/**
 * @nexus/gateway — barrel export.
 */
export { startGateway } from "./server.js";
export type { GatewayHandle } from "./server.js";
export { ConnectParams, HelloOk, RequestFrame, ResponseFrame, EventFrame } from "./protocol/frames.js";
export { authenticate } from "./middleware/auth.js";
export type { AuthResult } from "./middleware/auth.js";
