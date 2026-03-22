import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

function makeTmpDir() {
  return mkdtempSync(path.join(tmpdir(), 'nexus-audit-test-'));
}

async function freshDb(dir: string) {
  process.env.NEXUS_DATA_DIR = dir;
  const db = await import('../db.js');
  db.closeDb();
  db.runMigrations();
  return db;
}

describe('audit: recordAudit', () => {
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

  it('records an audit entry and returns a positive id', async () => {
    const { recordAudit } = await import('../audit.js');
    const id = recordAudit('test:event');
    expect(id).toBeGreaterThan(0);
  });

  it('records with actor and details', async () => {
    const { recordAudit, queryAudit } = await import('../audit.js');
    recordAudit('auth:success', 'user-123', { method: 'token' });
    const entries = queryAudit('auth:success');
    expect(entries.length).toBe(1);
    expect(entries[0].actor).toBe('user-123');
  });

  it('records entry without actor or details', async () => {
    const { recordAudit, queryAudit } = await import('../audit.js');
    recordAudit('system:boot');
    const entries = queryAudit('system:boot');
    expect(entries.length).toBe(1);
    expect(entries[0].actor).toBeNull();
  });

  it('increments ids monotonically', async () => {
    const { recordAudit } = await import('../audit.js');
    const id1 = recordAudit('ev:a');
    const id2 = recordAudit('ev:a');
    expect(id2).toBeGreaterThan(id1);
  });

  it('multiple entries for the same event type are all stored', async () => {
    const { recordAudit, queryAudit } = await import('../audit.js');
    recordAudit('repeated:event', 'actor1');
    recordAudit('repeated:event', 'actor2');
    recordAudit('repeated:event', 'actor3');
    const entries = queryAudit('repeated:event');
    expect(entries.length).toBe(3);
  });
});

describe('audit: queryAudit', () => {
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

  it('returns empty array when no entries exist', async () => {
    const { queryAudit } = await import('../audit.js');
    expect(queryAudit()).toEqual([]);
  });

  it('returns all entries when no filter is provided', async () => {
    const { recordAudit, queryAudit } = await import('../audit.js');
    recordAudit('type:a');
    recordAudit('type:b');
    const all = queryAudit();
    expect(all.length).toBe(2);
  });

  it('filters entries by eventType', async () => {
    const { recordAudit, queryAudit } = await import('../audit.js');
    recordAudit('type:x');
    recordAudit('type:y');
    const filtered = queryAudit('type:x');
    expect(filtered.length).toBe(1);
    expect(filtered[0].eventType).toBe('type:x');
  });

  it('respects limit parameter', async () => {
    const { recordAudit, queryAudit } = await import('../audit.js');
    for (let i = 0; i < 10; i++) recordAudit('bulk:event');
    const limited = queryAudit('bulk:event', 3);
    expect(limited.length).toBe(3);
  });

  it('respects offset parameter', async () => {
    const { recordAudit, queryAudit } = await import('../audit.js');
    for (let i = 0; i < 5; i++) recordAudit('paged:event', `actor-${i}`);
    const page1 = queryAudit('paged:event', 5, 0);
    const page2 = queryAudit('paged:event', 5, 3);
    expect(page1.length).toBe(5);
    expect(page2.length).toBe(2);
  });

  it('returns entries in descending order (most recent first)', async () => {
    const { recordAudit, queryAudit } = await import('../audit.js');
    const id1 = recordAudit('order:ev');
    const id2 = recordAudit('order:ev');
    const entries = queryAudit('order:ev');
    // DESC order means id2 (higher) comes first
    expect(entries[0].id).toBe(id2);
    expect(entries[1].id).toBe(id1);
  });

  it('each entry has the expected shape', async () => {
    const { recordAudit, queryAudit } = await import('../audit.js');
    recordAudit('shape:test', 'actor', { foo: 'bar' });
    const entries = queryAudit('shape:test');
    const e = entries[0];
    expect(typeof e.id).toBe('number');
    expect(typeof e.eventType).toBe('string');
    expect(typeof e.createdAt).toBe('number');
    expect(e.createdAt).toBeGreaterThan(0);
  });
});
