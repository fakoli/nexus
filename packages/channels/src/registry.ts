/**
 * Channel registry — manages adapter lifecycle (register, start, stop).
 *
 * Intentionally a plain module-level singleton so adapters can be imported
 * and registered from anywhere without dependency injection ceremony.
 */

import { createLogger } from "@nexus/core";
import type { ChannelAdapter, ChannelContext } from "./adapter.js";
import { routeInbound } from "./router.js";

const log = createLogger("channels:registry");

const adapters = new Map<string, ChannelAdapter>();
const runningAdapters = new Set<string>();

/**
 * Register an adapter so it can be started later.
 * Throws if an adapter with the same id is already registered.
 */
export function registerAdapter(adapter: ChannelAdapter): void {
  if (adapters.has(adapter.id)) {
    throw new Error(`Channel adapter '${adapter.id}' is already registered`);
  }
  adapters.set(adapter.id, adapter);
  log.info({ channelId: adapter.id, name: adapter.name }, "Adapter registered");
}

/**
 * Start a registered adapter by id.
 * Builds the ChannelContext and wires inbound messages to the router.
 */
export async function startAdapter(channelId: string): Promise<void> {
  const adapter = adapters.get(channelId);
  if (!adapter) {
    throw new Error(`No adapter registered with id '${channelId}'`);
  }
  if (runningAdapters.has(channelId)) {
    log.warn({ channelId }, "Adapter is already running — ignoring start");
    return;
  }

  const ctx: ChannelContext = {
    channelId,
    onInbound: (senderId, message, metadata) =>
      routeInbound(channelId, senderId, message, metadata),
  };

  await adapter.start(ctx);
  runningAdapters.add(channelId);
  log.info({ channelId }, "Adapter started");
}

/**
 * Stop a running adapter by id.
 */
export async function stopAdapter(channelId: string): Promise<void> {
  const adapter = adapters.get(channelId);
  if (!adapter) {
    throw new Error(`No adapter registered with id '${channelId}'`);
  }
  if (!runningAdapters.has(channelId)) {
    log.warn({ channelId }, "Adapter is not running — ignoring stop");
    return;
  }

  await adapter.stop();
  runningAdapters.delete(channelId);
  log.info({ channelId }, "Adapter stopped");
}

/**
 * Stop all running adapters (graceful shutdown).
 */
export async function stopAllAdapters(): Promise<void> {
  const ids = [...runningAdapters];
  await Promise.allSettled(ids.map((id) => stopAdapter(id)));
}

/** Retrieve a registered adapter by id (or undefined). */
export function getAdapter(channelId: string): ChannelAdapter | undefined {
  return adapters.get(channelId);
}

/** List all registered adapter ids. */
export function listAdapters(): string[] {
  return [...adapters.keys()];
}

/** Return whether an adapter is currently running. */
export function isAdapterRunning(channelId: string): boolean {
  return runningAdapters.has(channelId);
}

/** Unregister an adapter (must be stopped first). */
export function unregisterAdapter(channelId: string): void {
  if (runningAdapters.has(channelId)) {
    throw new Error(`Cannot unregister running adapter '${channelId}' — stop it first`);
  }
  adapters.delete(channelId);
  log.info({ channelId }, "Adapter unregistered");
}

/**
 * Reset registry state — intended for use in tests only.
 */
export function _resetRegistry(): void {
  adapters.clear();
  runningAdapters.clear();
}
