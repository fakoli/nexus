import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { createLogger } from "./logger.js";

const log = createLogger("core:db");

let db: Database.Database | null = null;

export function getDataDir(): string {
  const dir = process.env.NEXUS_DATA_DIR ?? path.join(process.env.HOME ?? "~", ".nexus");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = path.join(getDataDir(), "nexus.db");
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    fs.chmodSync(dbPath, 0o600);
    log.info({ path: dbPath }, "Database opened");
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    log.info("Database closed");
  }
}

export function runMigrations(): void {
  const database = getDb();
  const currentVersion = database.pragma("user_version", { simple: true }) as number;

  const migrations = getMigrations();
  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      log.info({ version: migration.version, name: migration.name }, "Running migration");
      database.transaction(() => {
        migration.up(database);
        // migration.version is a numeric literal from a closed list — safe to interpolate
        const version = Math.trunc(migration.version);
        database.pragma(`user_version = ${version}`);
      })();
    }
  }
}

interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

function getMigrations(): Migration[] {
  return [
    {
      version: 1,
      name: "initial-schema",
      up: (db) => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
          );

          CREATE TABLE IF NOT EXISTS agents (
            id TEXT PRIMARY KEY,
            config TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
          );

          CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL REFERENCES agents(id),
            channel TEXT,
            peer_id TEXT,
            state TEXT NOT NULL DEFAULT 'active',
            metadata TEXT,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
          );

          CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL REFERENCES sessions(id),
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            metadata TEXT,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
          );
          CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);

          CREATE TABLE IF NOT EXISTS credentials (
            id TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            encrypted_value BLOB NOT NULL,
            iv BLOB NOT NULL,
            tag BLOB NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
          );

          CREATE TABLE IF NOT EXISTS allowlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            channel TEXT,
            pattern TEXT NOT NULL,
            policy TEXT NOT NULL DEFAULT 'allow',
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
          );

          CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            actor TEXT,
            details TEXT,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
          );
          CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_log(event_type, created_at);

          CREATE TABLE IF NOT EXISTS paired_devices (
            id TEXT PRIMARY KEY,
            name TEXT,
            platform TEXT,
            public_key TEXT,
            token_hash TEXT NOT NULL,
            capabilities TEXT,
            paired_at INTEGER NOT NULL DEFAULT (unixepoch()),
            last_seen_at INTEGER
          );

          CREATE TABLE IF NOT EXISTS cron_jobs (
            id TEXT PRIMARY KEY,
            schedule TEXT NOT NULL,
            agent_id TEXT NOT NULL REFERENCES agents(id),
            message TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            last_run_at INTEGER,
            next_run_at INTEGER
          );

          CREATE TABLE IF NOT EXISTS memory_notes (
            id TEXT PRIMARY KEY,
            scope TEXT NOT NULL DEFAULT 'global',
            content TEXT NOT NULL,
            embedding BLOB,
            tags TEXT,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
          );

          CREATE TABLE IF NOT EXISTS auth_profiles (
            id TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            profile_data TEXT NOT NULL,
            priority INTEGER NOT NULL DEFAULT 0,
            cooldown_until INTEGER,
            last_used_at INTEGER,
            failure_count INTEGER NOT NULL DEFAULT 0
          );

          CREATE TABLE IF NOT EXISTS rate_limits (
            key TEXT PRIMARY KEY,
            count INTEGER NOT NULL DEFAULT 0,
            window_start INTEGER NOT NULL,
            window_seconds INTEGER NOT NULL
          );
        `);
      },
    },
    {
      version: 2,
      name: "installed-plugins",
      up: (db) => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS installed_plugins (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            version TEXT NOT NULL,
            registry_url TEXT NOT NULL,
            install_path TEXT NOT NULL,
            installed_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
          );
          CREATE INDEX IF NOT EXISTS idx_installed_plugins_registry ON installed_plugins(registry_url);
        `);
      },
    },
    {
      version: 3,
      name: "cron-run-history",
      up: (db) => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS cron_run_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL REFERENCES cron_jobs(id),
            status TEXT NOT NULL DEFAULT 'pending',
            started_at INTEGER NOT NULL DEFAULT (unixepoch()),
            finished_at INTEGER,
            result_summary TEXT,
            tokens_used INTEGER DEFAULT 0,
            error TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_cron_history_job ON cron_run_history(job_id, started_at);
        `);
      },
    },
    {
      version: 4,
      name: "credential-expiry",
      up: (db) => {
        db.exec(`
          ALTER TABLE credentials ADD COLUMN expires_at INTEGER;
          CREATE INDEX IF NOT EXISTS idx_credentials_expires ON credentials(expires_at)
            WHERE expires_at IS NOT NULL;
        `);
      },
    },
  ];
}
