import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

function makeTmpDir() {
  return mkdtempSync(path.join(tmpdir(), 'nexus-config-test-'));
}

async function freshDb(dir: string) {
  process.env.NEXUS_DATA_DIR = dir;
  const db = await import('../db.js');
  db.closeDb();
  db.runMigrations();
  return db;
}

describe('config: getConfig / setConfig', () => {
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

  it('returns undefined for a missing key', async () => {
    const { getConfig } = await import('../config.js');
    expect(getConfig('nonexistent')).toBeUndefined();
  });

  it('stores and retrieves a string value', async () => {
    const { getConfig, setConfig } = await import('../config.js');
    setConfig('test.key', 'hello');
    expect(getConfig('test.key')).toBe('hello');
  });

  it('stores and retrieves a number value', async () => {
    const { getConfig, setConfig } = await import('../config.js');
    setConfig('num', 42);
    expect(getConfig('num')).toBe(42);
  });

  it('stores and retrieves an object value', async () => {
    const { getConfig, setConfig } = await import('../config.js');
    const obj = { port: 9000, bind: 'loopback' };
    setConfig('gateway', obj);
    expect(getConfig('gateway')).toEqual(obj);
  });

  it('overwrites an existing key', async () => {
    const { getConfig, setConfig } = await import('../config.js');
    setConfig('x', 'first');
    setConfig('x', 'second');
    expect(getConfig('x')).toBe('second');
  });

  it('stores a boolean false', async () => {
    const { getConfig, setConfig } = await import('../config.js');
    setConfig('flag', false);
    expect(getConfig('flag')).toBe(false);
  });

  it('stores null correctly', async () => {
    const { getConfig, setConfig } = await import('../config.js');
    setConfig('empty', null);
    expect(getConfig('empty')).toBeNull();
  });
});

describe('config: getAllConfig', () => {
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

  it('returns default config when nothing is set', async () => {
    const { getAllConfig } = await import('../config.js');
    const cfg = getAllConfig();
    expect(cfg.gateway.port).toBe(19200);
    expect(cfg.gateway.bind).toBe('loopback');
    expect(cfg.agent.defaultProvider).toBe('anthropic');
    expect(cfg.agent.thinkLevel).toBe('low');
    expect(cfg.security.dmPolicy).toBe('pairing');
    expect(cfg.security.promptGuard).toBe('enforce');
  });

  it('merges stored values with defaults', async () => {
    const { getAllConfig, setConfig } = await import('../config.js');
    setConfig('gateway', { port: 9999 });
    const cfg = getAllConfig();
    expect(cfg.gateway.port).toBe(9999);
    // defaults still present
    expect(cfg.gateway.bind).toBe('loopback');
  });

  it('security section returns stored token', async () => {
    const { getAllConfig, setConfig } = await import('../config.js');
    setConfig('security', { gatewayToken: 'secret123' });
    const cfg = getAllConfig();
    expect(cfg.security.gatewayToken).toBe('secret123');
  });
});

describe('config: setConfig (section storage)', () => {
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

  it('stores a config section and retrieves it', async () => {
    const { setConfig, getConfig } = await import('../config.js');
    setConfig('agent', { defaultModel: 'claude-opus-3' });
    const val = getConfig('agent') as { defaultModel: string };
    expect(val.defaultModel).toBe('claude-opus-3');
  });
});

describe('config: schema validation', () => {
  it('GatewayConfigSchema rejects invalid bind value', async () => {
    const { GatewayConfigSchema } = await import('../config.js');
    const result = GatewayConfigSchema.safeParse({ bind: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('GatewayConfigSchema accepts valid bind values', async () => {
    const { GatewayConfigSchema } = await import('../config.js');
    for (const bind of ['loopback', 'lan', 'all']) {
      const r = GatewayConfigSchema.safeParse({ bind });
      expect(r.success).toBe(true);
    }
  });

  it('AgentConfigSchema rejects invalid thinkLevel', async () => {
    const { AgentConfigSchema } = await import('../config.js');
    const result = AgentConfigSchema.safeParse({ thinkLevel: 'extreme' });
    expect(result.success).toBe(false);
  });

  it('SecurityConfigSchema accepts optional token', async () => {
    const { SecurityConfigSchema } = await import('../config.js');
    const result = SecurityConfigSchema.safeParse({ gatewayToken: 'tok' });
    expect(result.success).toBe(true);
  });

  it('NexusConfigSchema applies all defaults on empty input', async () => {
    const { NexusConfigSchema } = await import('../config.js');
    const result = NexusConfigSchema.parse({});
    expect(result.gateway.port).toBe(19200);
    expect(result.agent.defaultProvider).toBe('anthropic');
    expect(result.security.dmPolicy).toBe('pairing');
  });
});
