import {
  DuckDBConnection,
  DuckDBInstance,
  type DuckDBValue,
} from "@duckdb/node-api";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

export const DATA_DIR = path.join(REPO_ROOT, "data");
export const DB_PATH = path.join(DATA_DIR, "tickets.duckdb");
export const DB_TMP_PATH = path.join(DATA_DIR, "tickets.duckdb.tmp");
export const CSV_PATH = path.join(DATA_DIR, "tickets.csv");
export const CSV_TMP_PATH = path.join(DATA_DIR, "tickets.csv.tmp");
export const INGEST_MANIFEST_PATH = path.join(DATA_DIR, "ingest-manifest.json");

export type { DuckDBConnection, DuckDBInstance, DuckDBValue };

type CreateDatabaseOptions = {
  readOnly?: boolean;
  /** When false (default for read-only tools that run host SQL), block FS/network table functions. */
  enableExternalAccess?: boolean;
  /** Override path (used for atomic ingest into a temp file). */
  path?: string;
};

type ReadOnlyConnectionOptions = {
  enableExternalAccess?: boolean;
};

let sharedInstance: DuckDBInstance | null = null;
let sharedConn: DuckDBConnection | null = null;

export async function assertDatabaseExists(): Promise<void> {
  try {
    await fs.access(DB_PATH);
  } catch {
    throw new Error(
      `DuckDB file not found at ${DB_PATH}. Run \`npm run ingest\` first.`,
    );
  }
}

export async function createDatabase(
  options: CreateDatabaseOptions = {},
): Promise<DuckDBInstance> {
  const dbPath = options.path ?? DB_PATH;

  if (options.readOnly) {
    // READ_ONLY: do not mutate the .duckdb file.
    // enable_external_access=false: block read_csv/etc. against the host FS.
    // Startup LOAD fts needs a brief window with external access enabled.
    const enableExternalAccess = options.enableExternalAccess === true;

    return DuckDBInstance.create(dbPath, {
      access_mode: "READ_ONLY",
      enable_external_access: enableExternalAccess ? "true" : "false",
    });
  }

  return DuckDBInstance.create(dbPath);
}

/**
 * Open one read-only connection for the MCP server lifetime:
 * LOAD fts once, then disable external filesystem access.
 */
export async function openSharedReadOnlyDatabase(): Promise<void> {
  if (sharedConn !== null) {
    return;
  }

  await assertDatabaseExists();
  sharedInstance = await createDatabase({
    readOnly: true,
    enableExternalAccess: true,
  });
  sharedConn = await sharedInstance.connect();
  await sharedConn.run("LOAD fts;");
  await sharedConn.run("SET enable_external_access = false;");
}

export function closeSharedReadOnlyDatabase(): void {
  if (sharedConn !== null) {
    sharedConn.closeSync();
    sharedConn = null;
  }
  if (sharedInstance !== null) {
    sharedInstance.closeSync();
    sharedInstance = null;
  }
}

export function isSharedDatabaseOpen(): boolean {
  return sharedConn !== null;
}

export async function withReadOnlyConnection<T>(
  fn: (conn: DuckDBConnection) => Promise<T>,
  options: ReadOnlyConnectionOptions = {},
): Promise<T> {
  if (sharedConn !== null) {
    return fn(sharedConn);
  }

  await assertDatabaseExists();
  const instance = await createDatabase({
    readOnly: true,
    enableExternalAccess: options.enableExternalAccess,
  });
  const conn = await instance.connect();

  try {
    return await fn(conn);
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

export async function connect(
  instance: DuckDBInstance,
): Promise<DuckDBConnection> {
  return instance.connect();
}

export async function run(
  conn: DuckDBConnection,
  sql: string,
  values?: DuckDBValue[] | Record<string, DuckDBValue>,
): Promise<void> {
  if (values === undefined) {
    await conn.run(sql);
    return;
  }

  await conn.run(sql, values);
}

export async function all<T extends Record<string, unknown>>(
  conn: DuckDBConnection,
  sql: string,
  values?: DuckDBValue[] | Record<string, DuckDBValue>,
): Promise<T[]> {
  const reader =
    values === undefined
      ? await conn.runAndReadAll(sql)
      : await conn.runAndReadAll(sql, values);
  return reader.getRowObjectsJson() as T[];
}
