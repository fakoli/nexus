/**
 * LanceDB integration layer.
 *
 * Provides VectorStore and VectorTable classes for persisting and
 * searching dense vector embeddings. Default store path: ~/.nexus/vectordb/
 */

import os from "node:os";
import path from "node:path";
import { createLogger } from "@nexus/core";

const log = createLogger("rag:vector-store");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VectorRecord {
  id: string;
  vector: number[];
  content: string;
  metadata: Record<string, unknown>;
}

export interface SearchResult extends VectorRecord {
  distance: number;
}

export interface SearchOptions {
  filter?: string;
  limit?: number;
  distanceType?: string;
}

// ── Default DB path ───────────────────────────────────────────────────────────

function defaultDbPath(): string {
  return path.join(os.homedir(), ".nexus", "vectordb");
}

// ── LanceDB type shims (loaded dynamically) ───────────────────────────────────

interface LanceConnection {
  openTable(name: string): Promise<LanceTable>;
  createTable(
    name: string,
    data: LanceRow[],
    options?: { mode?: string },
  ): Promise<LanceTable>;
  tableNames(): Promise<string[]>;
  close?(): void;
}

interface LanceQuery {
  limit(n: number): LanceQuery;
  where(filter: string): LanceQuery;
  distanceType(type: string): LanceQuery;
  toArray(): Promise<LanceRow[]>;
}

interface LanceTable {
  add(data: LanceRow[]): Promise<void>;
  mergeInsert(key: string): LanceMergeInsert;
  search(vector: number[]): LanceQuery;
  delete(filter: string): Promise<void>;
}

interface LanceMergeInsert {
  whenMatchedUpdateAll(): LanceMergeInsert;
  whenNotMatchedInsertAll(): LanceMergeInsert;
  execute(data: LanceRow[]): Promise<void>;
}

interface LanceRow {
  id: string;
  vector: number[];
  content: string;
  metadata: string; // JSON-encoded
  [key: string]: unknown;
}

// ── VectorTable ───────────────────────────────────────────────────────────────

export class VectorTable {
  private constructor(private readonly table: LanceTable) {}

  static _fromRaw(raw: LanceTable): VectorTable {
    return new VectorTable(raw);
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return;
    const rows = records.map(toRow);
    log.info({ count: records.length }, "Upserting records");

    // mergeInsert: update on id match, insert otherwise
    await this.table
      .mergeInsert("id")
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute(rows);
  }

  async search(vector: number[], options?: SearchOptions): Promise<SearchResult[]> {
    const limit = options?.limit ?? 10;
    log.info({ limit }, "Searching vectors");

    let query = this.table.search(vector).limit(limit);

    if (options?.filter) {
      query = query.where(options.filter);
    }
    if (options?.distanceType) {
      query = query.distanceType(options.distanceType);
    }

    const rows = await query.toArray();
    return rows.map(fromRow);
  }

  async delete(filter: string): Promise<void> {
    log.info({ filter }, "Deleting records");
    await this.table.delete(filter);
  }
}

// ── VectorStore ───────────────────────────────────────────────────────────────

export class VectorStore {
  private constructor(private readonly conn: LanceConnection) {}

  static async connect(dbPath?: string): Promise<VectorStore> {
    const resolvedPath = dbPath ?? defaultDbPath();
    log.info({ path: resolvedPath }, "Connecting to LanceDB");

    // Dynamic import so the module can be tested with mocks
    const lancedb = await import("@lancedb/lancedb");
    const conn = (await lancedb.connect(resolvedPath)) as LanceConnection;
    return new VectorStore(conn);
  }

  async getOrCreateTable(name: string, dimensions = 768): Promise<VectorTable> {
    const existingNames = await this.conn.tableNames();

    if (existingNames.includes(name)) {
      log.info({ table: name }, "Opening existing table");
      const raw = await this.conn.openTable(name);
      return VectorTable._fromRaw(raw);
    }

    log.info({ table: name, dimensions }, "Creating new table");
    // Seed with one placeholder row so LanceDB can infer the schema,
    // then immediately delete it.
    const placeholder: LanceRow = {
      id: "__placeholder__",
      vector: Array(dimensions).fill(0),
      content: "",
      metadata: "{}",
    };
    const raw = await this.conn.createTable(name, [placeholder], { mode: "create" });
    const vt = VectorTable._fromRaw(raw);
    await vt.delete("id = '__placeholder__'");
    return vt;
  }

  async close(): Promise<void> {
    log.info("Closing LanceDB connection");
    if (typeof this.conn.close === "function") {
      this.conn.close();
    }
  }
}

// ── Row conversion helpers ────────────────────────────────────────────────────

function toRow(r: VectorRecord): LanceRow {
  return {
    id: r.id,
    vector: r.vector,
    content: r.content,
    metadata: JSON.stringify(r.metadata),
  };
}

function fromRow(row: LanceRow): SearchResult {
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.metadata);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      metadata = parsed as Record<string, unknown>;
    }
  } catch {
    // malformed metadata → leave as empty object
  }
  return {
    id: row.id,
    vector: Array.isArray(row.vector) ? (row.vector as number[]) : [],
    content: row.content,
    metadata,
    distance: typeof row._distance === "number" ? row._distance : 0,
  };
}
