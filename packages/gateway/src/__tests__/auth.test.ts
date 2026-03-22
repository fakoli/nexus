import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

function makeTmpDir() {
  return mkdtempSync(path.join(tmpdir(), 'nexus-auth-test-'));
}

async function freshDb(dir: string) {
  process.env.NEXUS_DATA_DIR = dir;
  const db = await import('@nexus/core');
  // Access the internal db module
  const dbMod = await import('../../../core/src/db.js');
  dbMod.closeDb();
  dbMod.runMigrations();
  return dbMod;
}

describe('auth: authenticate — no auth configured (anonymous)', () => {
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

  it('allows anonymous access when no auth is configured', async () => {
    const { authenticate } = await import('../middleware/auth.js');
    const result = authenticate({}, 'client-1');
    expect(result.ok).toBe(true);
    expect(result.method).toBe('none');
  });

  it('allows device token when no token/password configured', async () => {
    const { authenticate } = await import('../middleware/auth.js');
    const result = authenticate({ deviceToken: 'device-xyz' }, 'client-2');
    expect(result.ok).toBe(true);
    expect(result.method).toBe('device_token');
  });
});

describe('auth: authenticate — token auth', () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    const dbMod = await freshDb(dir);
    // Configure a gateway token
    const { setConfig } = await import('@nexus/core');
    setConfig('security', { gatewayToken: 'valid-token-123' });
  });

  afterEach(async () => {
    const dbMod = await import('../../../core/src/db.js');
    dbMod.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('succeeds with correct token', async () => {
    const { authenticate } = await import('../middleware/auth.js');
    const result = authenticate({ token: 'valid-token-123' }, 'client-tok');
    expect(result.ok).toBe(true);
    expect(result.method).toBe('token');
  });

  it('fails with wrong token', async () => {
    const { authenticate } = await import('../middleware/auth.js');
    const result = authenticate({ token: 'wrong-token' }, 'client-bad');
    expect(result.ok).toBe(false);
    expect(result.method).toBe('token');
    expect(result.error).toBeDefined();
  });

  it('fails when no credentials are provided but auth is configured', async () => {
    const { authenticate } = await import('../middleware/auth.js');
    const result = authenticate({}, 'client-none');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Authentication required/i);
  });

  it('fails device token when token auth is configured', async () => {
    const { authenticate } = await import('../middleware/auth.js');
    const result = authenticate({ deviceToken: 'device-abc' }, 'client-dev');
    expect(result.ok).toBe(false);
  });
});

describe('auth: authenticate — password auth', () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
    const { setConfig } = await import('@nexus/core');
    setConfig('security', { gatewayPassword: 'p@ssw0rd!' });
  });

  afterEach(async () => {
    const dbMod = await import('../../../core/src/db.js');
    dbMod.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('succeeds with correct password', async () => {
    const { authenticate } = await import('../middleware/auth.js');
    const result = authenticate({ password: 'p@ssw0rd!' }, 'client-pw');
    expect(result.ok).toBe(true);
    expect(result.method).toBe('password');
  });

  it('fails with wrong password', async () => {
    const { authenticate } = await import('../middleware/auth.js');
    const result = authenticate({ password: 'wrongpass' }, 'client-pw-bad');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid password/i);
  });

  it('token auth fails when only password is configured and no token set', async () => {
    const { authenticate } = await import('../middleware/auth.js');
    const result = authenticate({ token: 'some-token' }, 'client-notoken');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no token configured/i);
  });
});

describe('auth: rate limiting', () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
    // Configure a token so auth doesn't auto-succeed
    const { setConfig } = await import('@nexus/core');
    setConfig('security', { gatewayToken: 'secret' });
  });

  afterEach(async () => {
    const dbMod = await import('../../../core/src/db.js');
    dbMod.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('rate-limits a client after 10 attempts', async () => {
    const { authenticate } = await import('../middleware/auth.js');
    const clientId = 'rate-limited-client';
    // Make 10 failed attempts (the rate limit)
    for (let i = 0; i < 10; i++) {
      authenticate({ token: 'bad-token' }, clientId);
    }
    // The 11th attempt should be rate-limited
    const result = authenticate({ token: 'bad-token' }, clientId);
    expect(result.ok).toBe(false);
    expect(result.method).toBe('rate_limit');
    expect(result.error).toMatch(/Too many/i);
  });

  it('different clients have independent rate limit buckets', async () => {
    const { authenticate } = await import('../middleware/auth.js');
    for (let i = 0; i < 10; i++) {
      authenticate({ token: 'bad' }, 'client-rl-a');
    }
    // client-rl-b has not hit the limit
    const result = authenticate({ token: 'bad' }, 'client-rl-b');
    expect(result.method).not.toBe('rate_limit');
  });
});
