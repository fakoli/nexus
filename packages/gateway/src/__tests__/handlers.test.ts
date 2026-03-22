import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

function makeTmpDir() {
  return mkdtempSync(path.join(tmpdir(), 'nexus-handlers-test-'));
}

async function freshDb(dir: string) {
  process.env.NEXUS_DATA_DIR = dir;
  const dbMod = await import('../../../core/src/db.js');
  dbMod.closeDb();
  dbMod.runMigrations();
  // Seed a default agent
  const { createAgent } = await import('@nexus/core');
  try { createAgent('default'); } catch { /* already exists */ }
  return dbMod;
}

// ── chat.send ──────────────────────────────────────────────────────────────

describe('handlers: handleChatSend', () => {
  let dir: string;
  let sessionId: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
    // Create a session to append messages to
    const { createSession } = await import('@nexus/core');
    sessionId = 'chat-sess-' + Math.random().toString(36).slice(2);
    createSession(sessionId, 'default');
  });

  afterEach(async () => {
    const dbMod = await import('../../../core/src/db.js');
    dbMod.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns ok:true with messageId on valid params', async () => {
    const { handleChatSend } = await import('../handlers/chat.js');
    const result = handleChatSend({ sessionId, content: 'Hello!' });
    expect(result.ok).toBe(true);
    expect((result.payload as { messageId: number }).messageId).toBeGreaterThan(0);
  });

  it('defaults role to "user"', async () => {
    const { handleChatSend } = await import('../handlers/chat.js');
    const result = handleChatSend({ sessionId, content: 'No role specified' });
    expect(result.ok).toBe(true);
  });

  it('accepts explicit role "assistant"', async () => {
    const { handleChatSend } = await import('../handlers/chat.js');
    const result = handleChatSend({ sessionId, content: 'Response', role: 'assistant' });
    expect(result.ok).toBe(true);
  });

  it('fails with SESSION_NOT_FOUND for unknown sessionId', async () => {
    const { handleChatSend } = await import('../handlers/chat.js');
    const result = handleChatSend({ sessionId: 'ghost-session', content: 'Hello' });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('SESSION_NOT_FOUND');
  });

  it('fails with INVALID_PARAMS when content is empty', async () => {
    const { handleChatSend } = await import('../handlers/chat.js');
    const result = handleChatSend({ sessionId, content: '' });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAMS');
  });

  it('fails with INVALID_PARAMS when sessionId is missing', async () => {
    const { handleChatSend } = await import('../handlers/chat.js');
    const result = handleChatSend({ content: 'Hello' });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAMS');
  });

  it('fails with INVALID_PARAMS for invalid role', async () => {
    const { handleChatSend } = await import('../handlers/chat.js');
    const result = handleChatSend({ sessionId, content: 'Hi', role: 'admin' });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAMS');
  });
});

// ── chat.history ──────────────────────────────────────────────────────────

describe('handlers: handleChatHistory', () => {
  let dir: string;
  let sessionId: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
    const { createSession, appendMessage } = await import('@nexus/core');
    sessionId = 'hist-sess-' + Math.random().toString(36).slice(2);
    createSession(sessionId, 'default');
    for (let i = 0; i < 5; i++) {
      appendMessage(sessionId, 'user', `message ${i}`);
    }
  });

  afterEach(async () => {
    const dbMod = await import('../../../core/src/db.js');
    dbMod.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns ok:true with messages and total', async () => {
    const { handleChatHistory } = await import('../handlers/chat.js');
    const result = handleChatHistory({ sessionId });
    expect(result.ok).toBe(true);
    const payload = result.payload as { messages: unknown[]; total: number };
    expect(payload.messages.length).toBe(5);
    expect(payload.total).toBe(5);
  });

  it('respects limit parameter', async () => {
    const { handleChatHistory } = await import('../handlers/chat.js');
    const result = handleChatHistory({ sessionId, limit: 2 });
    expect(result.ok).toBe(true);
    const payload = result.payload as { messages: unknown[]; total: number };
    expect(payload.messages.length).toBe(2);
    expect(payload.total).toBe(5);
  });

  it('respects offset parameter', async () => {
    const { handleChatHistory } = await import('../handlers/chat.js');
    const result = handleChatHistory({ sessionId, limit: 2, offset: 3 });
    const payload = result.payload as { messages: unknown[]; total: number };
    expect(payload.messages.length).toBe(2);
  });

  it('returns SESSION_NOT_FOUND for unknown session', async () => {
    const { handleChatHistory } = await import('../handlers/chat.js');
    const result = handleChatHistory({ sessionId: 'no-such' });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('SESSION_NOT_FOUND');
  });

  it('returns INVALID_PARAMS for missing sessionId', async () => {
    const { handleChatHistory } = await import('../handlers/chat.js');
    const result = handleChatHistory({});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAMS');
  });

  it('rejects limit above 500', async () => {
    const { handleChatHistory } = await import('../handlers/chat.js');
    const result = handleChatHistory({ sessionId, limit: 501 });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAMS');
  });
});

// ── sessions.list ─────────────────────────────────────────────────────────

describe('handlers: handleSessionsList', () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    const dbMod = await import('../../../core/src/db.js');
    dbMod.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns ok:true with empty sessions array initially', async () => {
    const { handleSessionsList } = await import('../handlers/sessions.js');
    const result = handleSessionsList({});
    expect(result.ok).toBe(true);
    const payload = result.payload as { sessions: unknown[] };
    expect(Array.isArray(payload.sessions)).toBe(true);
  });

  it('lists created sessions', async () => {
    const { handleSessionsList } = await import('../handlers/sessions.js');
    const { createSession } = await import('@nexus/core');
    createSession('list-sess-1', 'default');
    createSession('list-sess-2', 'default');
    const result = handleSessionsList({});
    const payload = result.payload as { sessions: unknown[] };
    expect(payload.sessions.length).toBeGreaterThanOrEqual(2);
  });

  it('filters by agentId', async () => {
    const { handleSessionsList } = await import('../handlers/sessions.js');
    const result = handleSessionsList({ agentId: 'default' });
    expect(result.ok).toBe(true);
  });

  it('filters by state', async () => {
    const { handleSessionsList } = await import('../handlers/sessions.js');
    const result = handleSessionsList({ state: 'active' });
    expect(result.ok).toBe(true);
  });

  it('rejects invalid state value', async () => {
    const { handleSessionsList } = await import('../handlers/sessions.js');
    const result = handleSessionsList({ state: 'invalid-state' });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAMS');
  });
});

// ── sessions.create ───────────────────────────────────────────────────────

describe('handlers: handleSessionsCreate', () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    const dbMod = await import('../../../core/src/db.js');
    dbMod.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a session with auto-generated id', async () => {
    const { handleSessionsCreate } = await import('../handlers/sessions.js');
    const result = handleSessionsCreate({});
    expect(result.ok).toBe(true);
    const payload = result.payload as { session: { id: string } };
    expect(typeof payload.session.id).toBe('string');
    expect(payload.session.id.length).toBeGreaterThan(0);
  });

  it('creates a session with specified id', async () => {
    const { handleSessionsCreate } = await import('../handlers/sessions.js');
    const result = handleSessionsCreate({ sessionId: 'my-custom-id' });
    expect(result.ok).toBe(true);
    const payload = result.payload as { session: { id: string } };
    expect(payload.session.id).toBe('my-custom-id');
  });

  it('uses default agentId when not specified', async () => {
    const { handleSessionsCreate } = await import('../handlers/sessions.js');
    const result = handleSessionsCreate({});
    const payload = result.payload as { session: { agentId: string } };
    expect(payload.session.agentId).toBe('default');
  });
});

// ── config.get ────────────────────────────────────────────────────────────

describe('handlers: handleConfigGet', () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    const dbMod = await import('../../../core/src/db.js');
    dbMod.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns full config when no section specified', async () => {
    const { handleConfigGet } = await import('../handlers/config.js');
    const result = handleConfigGet({});
    expect(result.ok).toBe(true);
    const payload = result.payload as { config: unknown };
    expect(payload.config).toBeDefined();
  });

  it('returns a specific section', async () => {
    const { handleConfigGet } = await import('../handlers/config.js');
    const result = handleConfigGet({ section: 'gateway' });
    expect(result.ok).toBe(true);
    const payload = result.payload as { section: string; value: { port: number } };
    expect(payload.section).toBe('gateway');
    expect(payload.value.port).toBe(18789);
  });

  it('returns ok:true for all valid sections', async () => {
    const { handleConfigGet } = await import('../handlers/config.js');
    for (const section of ['gateway', 'agent', 'security']) {
      const result = handleConfigGet({ section });
      expect(result.ok).toBe(true);
    }
  });

  it('returns INVALID_PARAMS for unknown section', async () => {
    const { handleConfigGet } = await import('../handlers/config.js');
    const result = handleConfigGet({ section: 'unknown-section' });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAMS');
  });
});

// ── config.set ────────────────────────────────────────────────────────────

describe('handlers: handleConfigSet', () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    const dbMod = await import('../../../core/src/db.js');
    dbMod.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('sets a gateway config section', async () => {
    const { handleConfigSet } = await import('../handlers/config.js');
    const result = handleConfigSet({ section: 'gateway', value: { port: 9999 } });
    expect(result.ok).toBe(true);
    const payload = result.payload as { section: string; value: { port: number } };
    expect(payload.value.port).toBe(9999);
  });

  it('sets a security config section', async () => {
    const { handleConfigSet } = await import('../handlers/config.js');
    const result = handleConfigSet({
      section: 'security',
      value: { gatewayToken: 'new-tok' },
    });
    expect(result.ok).toBe(true);
  });

  it('returns INVALID_PARAMS for missing section', async () => {
    const { handleConfigSet } = await import('../handlers/config.js');
    const result = handleConfigSet({ value: { port: 1234 } });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAMS');
  });

  it('returns INVALID_PARAMS for unknown section', async () => {
    const { handleConfigSet } = await import('../handlers/config.js');
    const result = handleConfigSet({ section: 'nope', value: {} });
    expect(result.ok).toBe(false);
  });

  it('returns INVALID_CONFIG for invalid schema value', async () => {
    const { handleConfigSet } = await import('../handlers/config.js');
    // port must be a number; sending a string should fail schema validation
    const result = handleConfigSet({ section: 'gateway', value: { port: 'not-a-number' } });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INVALID_CONFIG');
  });

  it('returns INVALID_PARAMS for missing value field', async () => {
    const { handleConfigSet } = await import('../handlers/config.js');
    const result = handleConfigSet({ section: 'gateway' });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAMS');
  });
});
