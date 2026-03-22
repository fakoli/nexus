import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

function makeTmpDir() {
  return mkdtempSync(path.join(tmpdir(), 'nexus-sessions-test-'));
}

async function freshDb(dir: string) {
  process.env.NEXUS_DATA_DIR = dir;
  const db = await import('../db.js');
  db.closeDb();
  db.runMigrations();
  // Create a default agent that sessions can reference
  const { createAgent } = await import('../agents.js');
  try { createAgent('agent-1'); } catch { /* already exists */ }
  return db;
}

describe('sessions: createSession', () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    const db = await import('../db.js');
    db.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a session and returns it', async () => {
    const { createSession } = await import('../sessions.js');
    const session = createSession('sess-1', 'agent-1');
    expect(session.id).toBe('sess-1');
    expect(session.agentId).toBe('agent-1');
    expect(session.state).toBe('active');
  });

  it('stores channel and peerId', async () => {
    const { createSession } = await import('../sessions.js');
    const session = createSession('sess-2', 'agent-1', 'ch-1', 'peer-123');
    expect(session.channel).toBe('ch-1');
    expect(session.peerId).toBe('peer-123');
  });

  it('session without channel has undefined channel', async () => {
    const { createSession } = await import('../sessions.js');
    const session = createSession('sess-3', 'agent-1');
    expect(session.channel).toBeUndefined();
    expect(session.peerId).toBeUndefined();
  });

  it('throws on duplicate session id', async () => {
    const { createSession } = await import('../sessions.js');
    createSession('sess-dup', 'agent-1');
    expect(() => createSession('sess-dup', 'agent-1')).toThrow();
  });

  it('createdAt and updatedAt are set to positive integers', async () => {
    const { createSession } = await import('../sessions.js');
    const session = createSession('sess-ts', 'agent-1');
    expect(session.createdAt).toBeGreaterThan(0);
    expect(session.updatedAt).toBeGreaterThan(0);
  });
});

describe('sessions: getSession', () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    const db = await import('../db.js');
    db.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null for a non-existent session', async () => {
    const { getSession } = await import('../sessions.js');
    expect(getSession('nope')).toBeNull();
  });

  it('retrieves a created session by id', async () => {
    const { createSession, getSession } = await import('../sessions.js');
    createSession('sess-get', 'agent-1', 'chan', 'peer');
    const s = getSession('sess-get');
    expect(s).not.toBeNull();
    expect(s!.agentId).toBe('agent-1');
  });
});

describe('sessions: getOrCreateSession', () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    const db = await import('../db.js');
    db.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a new session when it does not exist', async () => {
    const { getOrCreateSession } = await import('../sessions.js');
    const s = getOrCreateSession('new-sess', 'agent-1');
    expect(s.id).toBe('new-sess');
  });

  it('returns the existing session on second call', async () => {
    const { getOrCreateSession } = await import('../sessions.js');
    const a = getOrCreateSession('existing', 'agent-1');
    const b = getOrCreateSession('existing', 'agent-1');
    expect(a.id).toBe(b.id);
    expect(a.createdAt).toBe(b.createdAt);
  });
});

describe('sessions: listSessions', () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
    const { createAgent } = await import('../agents.js');
    try { createAgent('agent-2'); } catch { /* exists */ }
  });

  afterEach(async () => {
    const db = await import('../db.js');
    db.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns an empty array when no sessions exist', async () => {
    const { listSessions } = await import('../sessions.js');
    expect(listSessions()).toEqual([]);
  });

  it('lists all sessions', async () => {
    const { createSession, listSessions } = await import('../sessions.js');
    createSession('ls-1', 'agent-1');
    createSession('ls-2', 'agent-2');
    const all = listSessions();
    expect(all.length).toBe(2);
  });

  it('filters by agentId', async () => {
    const { createSession, listSessions } = await import('../sessions.js');
    createSession('ls-3', 'agent-1');
    createSession('ls-4', 'agent-2');
    const filtered = listSessions('agent-1');
    expect(filtered.every((s) => s.agentId === 'agent-1')).toBe(true);
  });

  it('filters by state', async () => {
    const { createSession, listSessions } = await import('../sessions.js');
    createSession('ls-5', 'agent-1');
    const active = listSessions(undefined, 'active');
    expect(active.every((s) => s.state === 'active')).toBe(true);
  });
});

describe('sessions: appendMessage / getMessages / getMessageCount', () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
    const { createSession } = await import('../sessions.js');
    createSession('sess-msg', 'agent-1');
  });

  afterEach(async () => {
    const db = await import('../db.js');
    db.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends a message and returns a positive rowid', async () => {
    const { appendMessage } = await import('../sessions.js');
    const id = appendMessage('sess-msg', 'user', 'Hello!');
    expect(id).toBeGreaterThan(0);
  });

  it('getMessages returns messages in order', async () => {
    const { appendMessage, getMessages } = await import('../sessions.js');
    appendMessage('sess-msg', 'user', 'First');
    appendMessage('sess-msg', 'assistant', 'Second');
    const msgs = getMessages('sess-msg');
    expect(msgs.length).toBe(2);
    expect(msgs[0].content).toBe('First');
    expect(msgs[1].content).toBe('Second');
  });

  it('getMessages respects limit and offset', async () => {
    const { appendMessage, getMessages } = await import('../sessions.js');
    for (let i = 0; i < 5; i++) appendMessage('sess-msg', 'user', `msg-${i}`);
    const page = getMessages('sess-msg', 2, 2);
    expect(page.length).toBe(2);
    expect(page[0].content).toBe('msg-2');
  });

  it('getMessageCount returns correct count', async () => {
    const { appendMessage, getMessageCount } = await import('../sessions.js');
    appendMessage('sess-msg', 'user', 'a');
    appendMessage('sess-msg', 'user', 'b');
    expect(getMessageCount('sess-msg')).toBe(2);
  });

  it('getMessageCount returns 0 for empty session', async () => {
    const { getMessageCount } = await import('../sessions.js');
    expect(getMessageCount('sess-msg')).toBe(0);
  });

  it('appends message with metadata', async () => {
    const { appendMessage, getMessages } = await import('../sessions.js');
    appendMessage('sess-msg', 'user', 'with meta', { source: 'test' });
    const msgs = getMessages('sess-msg');
    // metadata is stored as JSON in the db column; getMessages returns the raw string
    expect(msgs[0].metadata).toBeDefined();
  });

  it('message role is preserved', async () => {
    const { appendMessage, getMessages } = await import('../sessions.js');
    appendMessage('sess-msg', 'assistant', 'assistant reply');
    const msgs = getMessages('sess-msg');
    expect(msgs[0].role).toBe('assistant');
  });
});
