import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

function makeTmpDir() {
  return mkdtempSync(path.join(tmpdir(), 'nexus-rl-test-'));
}

async function freshDb(dir: string) {
  process.env.NEXUS_DATA_DIR = dir;
  const db = await import('../db.js');
  db.closeDb();
  db.runMigrations();
  return db;
}

describe('rate-limit: checkRateLimit', () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    vi.useRealTimers();
    const db = await import('../db.js');
    db.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('allows first request within limit', async () => {
    const { checkRateLimit } = await import('../rate-limit.js');
    expect(checkRateLimit('key-1', 5, 60)).toBe(true);
  });

  it('allows requests up to the limit', async () => {
    const { checkRateLimit } = await import('../rate-limit.js');
    const limit = 3;
    for (let i = 0; i < limit; i++) {
      expect(checkRateLimit('key-limit', limit, 60)).toBe(true);
    }
  });

  it('blocks request when limit is reached', async () => {
    const { checkRateLimit } = await import('../rate-limit.js');
    const limit = 3;
    for (let i = 0; i < limit; i++) {
      checkRateLimit('key-block', limit, 60);
    }
    // The (limit+1)th request should be blocked
    expect(checkRateLimit('key-block', limit, 60)).toBe(false);
  });

  it('allows a limit of 1', async () => {
    const { checkRateLimit } = await import('../rate-limit.js');
    expect(checkRateLimit('key-one', 1, 60)).toBe(true);
    expect(checkRateLimit('key-one', 1, 60)).toBe(false);
  });

  it('different keys are tracked independently', async () => {
    const { checkRateLimit } = await import('../rate-limit.js');
    checkRateLimit('key-a', 1, 60);
    checkRateLimit('key-a', 1, 60); // key-a now at limit+1, blocked

    // key-b is unaffected
    expect(checkRateLimit('key-b', 1, 60)).toBe(true);
  });

  it('resets count after window expires', async () => {
    vi.useFakeTimers();
    const { checkRateLimit } = await import('../rate-limit.js');

    // Fill up the window
    const limit = 2;
    checkRateLimit('key-window', limit, 10);
    checkRateLimit('key-window', limit, 10);
    expect(checkRateLimit('key-window', limit, 10)).toBe(false);

    // Advance time past the window
    vi.advanceTimersByTime(11_000);

    // Should reset and allow again
    expect(checkRateLimit('key-window', limit, 10)).toBe(true);
  });
});

describe('rate-limit: resetRateLimit', () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    vi.useRealTimers();
    const db = await import('../db.js');
    db.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('allows requests again after reset', async () => {
    const { checkRateLimit, resetRateLimit } = await import('../rate-limit.js');
    const limit = 2;
    checkRateLimit('reset-key', limit, 60);
    checkRateLimit('reset-key', limit, 60);
    expect(checkRateLimit('reset-key', limit, 60)).toBe(false);

    resetRateLimit('reset-key');
    expect(checkRateLimit('reset-key', limit, 60)).toBe(true);
  });

  it('is safe to reset a non-existent key', async () => {
    const { resetRateLimit } = await import('../rate-limit.js');
    expect(() => resetRateLimit('no-such-key')).not.toThrow();
  });

  it('reset only affects the specified key', async () => {
    const { checkRateLimit, resetRateLimit } = await import('../rate-limit.js');
    checkRateLimit('key-x', 1, 60);
    checkRateLimit('key-x', 1, 60); // exhausted

    checkRateLimit('key-y', 1, 60);
    checkRateLimit('key-y', 1, 60); // exhausted

    resetRateLimit('key-x');

    expect(checkRateLimit('key-x', 1, 60)).toBe(true); // reset
    expect(checkRateLimit('key-y', 1, 60)).toBe(false); // still exhausted
  });
});
