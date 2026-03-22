import { Command } from "commander";
import crypto from "node:crypto";
import {
  runMigrations,
  getDb,
  storeCredential,
  decrypt,
  encrypt,
  initMasterKey,
  getDataDir,
} from "@nexus/core";
import fs from "node:fs";
import path from "node:path";

export const secretsCommand = new Command("secrets").description(
  "Manage encrypted API credentials",
);

secretsCommand
  .command("set <provider> <key>")
  .description("Store an encrypted API key for a provider")
  .action((provider: string, key: string) => {
    runMigrations();
    storeCredential(`${provider}_api_key`, provider, key);
    console.log(`Credential for "${provider}" stored successfully.`);
  });

secretsCommand
  .command("list")
  .description("List providers with stored credentials")
  .action(() => {
    runMigrations();
    const db = getDb();
    const rows = db
      .prepare("SELECT id, provider, updated_at FROM credentials ORDER BY provider")
      .all() as { id: string; provider: string; updated_at: number }[];

    if (rows.length === 0) {
      console.log("No credentials stored.");
      return;
    }

    const idWidth = Math.max(2, ...rows.map((r) => r.id.length));
    const providerWidth = Math.max(8, ...rows.map((r) => r.provider.length));
    const header = `${"ID".padEnd(idWidth)}  ${"PROVIDER".padEnd(providerWidth)}  UPDATED AT`;
    console.log(header);
    console.log("-".repeat(header.length));
    for (const row of rows) {
      const date = new Date(row.updated_at * 1000).toISOString().replace("T", " ").slice(0, 19);
      console.log(`${row.id.padEnd(idWidth)}  ${row.provider.padEnd(providerWidth)}  ${date}`);
    }
  });

secretsCommand
  .command("delete <provider>")
  .description("Remove a stored credential by provider id")
  .action((provider: string) => {
    runMigrations();
    const db = getDb();
    const id = `${provider}_api_key`;
    const info = db.prepare("DELETE FROM credentials WHERE id = ?").run(id);
    if (info.changes === 0) {
      console.error(`No credential found for provider "${provider}" (id: ${id}).`);
      process.exit(1);
    }
    console.log(`Credential for "${provider}" deleted.`);
  });

secretsCommand
  .command("rotate")
  .description("Re-encrypt all credentials with a new master key")
  .action(() => {
    runMigrations();
    const db = getDb();

    // Read all credentials while the old key is still active.
    const rows = db
      .prepare("SELECT id, provider, encrypted_value, iv, tag FROM credentials")
      .all() as {
      id: string;
      provider: string;
      encrypted_value: Buffer;
      iv: Buffer;
      tag: Buffer;
    }[];

    if (rows.length === 0) {
      console.log("No credentials to rotate.");
    }

    // Decrypt everything with the current (old) key.
    const plaintexts: { id: string; provider: string; value: string }[] = rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      value: decrypt(r.encrypted_value, r.iv, r.tag),
    }));

    // Generate and persist the new master key.
    const newKey = crypto.randomBytes(32);
    const keyPath = path.join(getDataDir(), "master.key");
    fs.writeFileSync(keyPath, newKey.toString("hex"), { mode: 0o600 });

    // Re-initialize with the new key.
    initMasterKey();

    // Re-encrypt and update each credential.
    const upsert = db.prepare(
      `INSERT INTO credentials (id, provider, encrypted_value, iv, tag, updated_at)
       VALUES (?, ?, ?, ?, ?, unixepoch())
       ON CONFLICT(id) DO UPDATE SET
         encrypted_value = excluded.encrypted_value,
         iv = excluded.iv,
         tag = excluded.tag,
         updated_at = excluded.updated_at`,
    );

    db.transaction(() => {
      for (const { id, provider, value } of plaintexts) {
        const { encrypted, iv, tag } = encrypt(value);
        upsert.run(id, provider, encrypted, iv, tag);
      }
    })();

    console.log(
      `Rotated master key and re-encrypted ${plaintexts.length} credential(s).`,
    );
    console.log(`New key written to: ${keyPath}`);
  });
