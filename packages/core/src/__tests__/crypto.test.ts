import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

function makeTmpDir() {
  return mkdtempSync(path.join(tmpdir(), 'nexus-crypto-test-'));
}

async function freshSetup(dir: string) {
  process.env.NEXUS_DATA_DIR = dir;
  const db = await import('../db.js');
  db.closeDb();
  db.runMigrations();
}

describe('crypto: encrypt / decrypt', () => {
  it('encrypts to a non-empty buffer', async () => {
    const { encrypt, initMasterKey } = await import('../crypto.js');
    initMasterKey('test-passphrase');
    const { encrypted, iv, tag } = encrypt('hello world');
    expect(encrypted).toBeInstanceOf(Buffer);
    expect(encrypted.length).toBeGreaterThan(0);
    expect(iv.length).toBe(12);
    expect(tag.length).toBeGreaterThan(0);
  });

  it('decrypts back to original plaintext', async () => {
    const { encrypt, decrypt, initMasterKey } = await import('../crypto.js');
    initMasterKey('test-passphrase');
    const plaintext = 'super secret value';
    const { encrypted, iv, tag } = encrypt(plaintext);
    const result = decrypt(encrypted, iv, tag);
    expect(result).toBe(plaintext);
  });

  it('different encryptions of the same value produce different ciphertexts (random IV)', async () => {
    const { encrypt, initMasterKey } = await import('../crypto.js');
    initMasterKey('test-passphrase');
    const { encrypted: e1 } = encrypt('same input');
    const { encrypted: e2 } = encrypt('same input');
    // With random IVs, ciphertexts will differ
    expect(e1.toString('hex')).not.toBe(e2.toString('hex'));
  });

  it('decryption fails when tag is tampered', async () => {
    const { encrypt, decrypt, initMasterKey } = await import('../crypto.js');
    initMasterKey('test-passphrase');
    const { encrypted, iv, tag } = encrypt('tamper me');
    const badTag = Buffer.from(tag);
    badTag[0] ^= 0xff; // flip a byte
    expect(() => decrypt(encrypted, iv, badTag)).toThrow();
  });

  it('decryption fails when ciphertext is tampered', async () => {
    const { encrypt, decrypt, initMasterKey } = await import('../crypto.js');
    initMasterKey('test-passphrase');
    const { encrypted, iv, tag } = encrypt('tamper ciphertext');
    if (encrypted.length > 0) {
      const bad = Buffer.from(encrypted);
      bad[0] ^= 0xff;
      expect(() => decrypt(bad, iv, tag)).toThrow();
    }
  });

  it('encrypts and decrypts an empty string', async () => {
    const { encrypt, decrypt, initMasterKey } = await import('../crypto.js');
    initMasterKey('test-passphrase');
    const { encrypted, iv, tag } = encrypt('');
    const result = decrypt(encrypted, iv, tag);
    expect(result).toBe('');
  });

  it('encrypts and decrypts unicode content', async () => {
    const { encrypt, decrypt, initMasterKey } = await import('../crypto.js');
    initMasterKey('test-passphrase');
    const text = '日本語テスト 🔐 العربية';
    const { encrypted, iv, tag } = encrypt(text);
    const result = decrypt(encrypted, iv, tag);
    expect(result).toBe(text);
  });
});

describe('crypto: storeCredential / retrieveCredential', () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshSetup(dir);
    const { initMasterKey } = await import('../crypto.js');
    initMasterKey('test-passphrase');
  });

  afterEach(async () => {
    const db = await import('../db.js');
    db.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores and retrieves a credential', async () => {
    const { storeCredential, retrieveCredential } = await import('../crypto.js');
    storeCredential('cred1', 'anthropic', 'sk-ant-abc123');
    const val = retrieveCredential('cred1');
    expect(val).toBe('sk-ant-abc123');
  });

  it('returns null for a non-existent credential', async () => {
    const { retrieveCredential } = await import('../crypto.js');
    const val = retrieveCredential('does-not-exist');
    expect(val).toBeNull();
  });

  it('overwrites an existing credential on re-store', async () => {
    const { storeCredential, retrieveCredential } = await import('../crypto.js');
    storeCredential('cred2', 'openai', 'first-value');
    storeCredential('cred2', 'openai', 'second-value');
    const val = retrieveCredential('cred2');
    expect(val).toBe('second-value');
  });

  it('stores multiple different credentials independently', async () => {
    const { storeCredential, retrieveCredential } = await import('../crypto.js');
    storeCredential('a', 'p1', 'val-a');
    storeCredential('b', 'p2', 'val-b');
    expect(retrieveCredential('a')).toBe('val-a');
    expect(retrieveCredential('b')).toBe('val-b');
  });
});

describe('crypto: timingSafeEqual', () => {
  it('returns true for equal strings', async () => {
    const { timingSafeEqual } = await import('../crypto.js');
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
  });

  it('returns false for unequal strings', async () => {
    const { timingSafeEqual } = await import('../crypto.js');
    expect(timingSafeEqual('abc', 'xyz')).toBe(false);
  });

  it('returns false when lengths differ', async () => {
    const { timingSafeEqual } = await import('../crypto.js');
    expect(timingSafeEqual('short', 'longer string')).toBe(false);
  });

  it('returns true for empty strings', async () => {
    const { timingSafeEqual } = await import('../crypto.js');
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('is case-sensitive', async () => {
    const { timingSafeEqual } = await import('../crypto.js');
    expect(timingSafeEqual('Secret', 'secret')).toBe(false);
  });
});
