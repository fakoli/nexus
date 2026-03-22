import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// Each test block sets its own NEXUS_DATA_DIR and resets the module cache
// by importing the live modules after setting the env var.

function makeTmpDir() {
  return mkdtempSync(path.join(tmpdir(), 'nexus-db-test-'));
}

describe('db: getDataDir', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
    process.env.NEXUS_DATA_DIR = dir;
  });

  afterEach(() => {
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the directory set via NEXUS_DATA_DIR', async () => {
    const { getDataDir } = await import('../db.js');
    const result = getDataDir();
    expect(result).toBe(dir);
  });

  it('creates the directory when it does not exist', async () => {
    const sub = path.join(dir, 'nested', 'deep');
    process.env.NEXUS_DATA_DIR = sub;
    const { getDataDir } = await import('../db.js');
    const result = getDataDir();
    expect(result).toBe(sub);
    // Directory should now exist
    const { existsSync } = await import('fs');
    expect(existsSync(sub)).toBe(true);
  });
});

describe('db: getDb / closeDb / runMigrations', () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    process.env.NEXUS_DATA_DIR = dir;
    // Force module re-evaluation so the singleton `db` starts as null
    const mod = await import('../db.js');
    mod.closeDb();
  });

  afterEach(async () => {
    const mod = await import('../db.js');
    mod.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns a Database instance', async () => {
    const { getDb } = await import('../db.js');
    const db = getDb();
    expect(db).toBeDefined();
    expect(typeof db.prepare).toBe('function');
  });

  it('returns the same instance on repeated calls (singleton)', async () => {
    const { getDb } = await import('../db.js');
    const a = getDb();
    const b = getDb();
    expect(a).toBe(b);
  });

  it('closes and reopens the database', async () => {
    const { getDb, closeDb } = await import('../db.js');
    const first = getDb();
    closeDb();
    const second = getDb();
    // After close, a new instance is created
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  it('runMigrations creates all expected tables', async () => {
    const { getDb, runMigrations } = await import('../db.js');
    runMigrations();
    const db = getDb();
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
        name: string;
      }[]
    ).map((r) => r.name);

    const expected = [
      'agents',
      'allowlist',
      'audit_log',
      'auth_profiles',
      'config',
      'credentials',
      'cron_jobs',
      'installed_plugins',
      'memory_notes',
      'messages',
      'paired_devices',
      'rate_limits',
      'sessions',
    ];
    for (const t of expected) {
      expect(tables).toContain(t);
    }
  });

  it('runMigrations sets user_version to the latest migration version', async () => {
    const { getDb, runMigrations } = await import('../db.js');
    runMigrations();
    const db = getDb();
    const version = db.pragma('user_version', { simple: true }) as number;
    expect(version).toBeGreaterThanOrEqual(2);
  });

  it('runMigrations is idempotent', async () => {
    const { getDb, runMigrations } = await import('../db.js');
    runMigrations();
    const versionAfterFirst = (getDb().pragma('user_version', { simple: true }) as number);
    runMigrations(); // second call should be a no-op
    const db = getDb();
    const version = db.pragma('user_version', { simple: true }) as number;
    expect(version).toBe(versionAfterFirst);
  });

  it('WAL journal mode is enabled', async () => {
    const { getDb } = await import('../db.js');
    const db = getDb();
    const mode = db.pragma('journal_mode', { simple: true }) as string;
    expect(mode).toBe('wal');
  });

  it('foreign_keys pragma is ON', async () => {
    const { getDb } = await import('../db.js');
    const db = getDb();
    const fk = db.pragma('foreign_keys', { simple: true }) as number;
    expect(fk).toBe(1);
  });

  it('closeDb is safe to call when already closed', async () => {
    const { closeDb } = await import('../db.js');
    closeDb(); // already closed in beforeEach
    expect(() => closeDb()).not.toThrow();
  });
});
