import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

export const DATA_DIR = path.join(REPO_ROOT, "data");
export const DB_PATH = path.join(DATA_DIR, "tickets.duckdb");
export const CSV_PATH = path.join(DATA_DIR, "tickets.csv");

export type { DuckDBConnection, DuckDBInstance };

type CreateDatabaseOptions = {
  readOnly?: boolean;
  /** When false (default for read-only tools that run host SQL), block FS/network table functions. */
  enableExternalAccess?: boolean;
};

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
  if (options.readOnly) {
    // READ_ONLY: do not mutate the .duckdb file.
    // enable_external_access=false: block read_csv/etc. against the host FS.
    // Search needs FTS LOAD, so that path opts back into external access.
    const enableExternalAccess = options.enableExternalAccess === true;

    return DuckDBInstance.create(DB_PATH, {
      access_mode: "READ_ONLY",
      enable_external_access: enableExternalAccess ? "true" : "false",
    });
  }

  return DuckDBInstance.create(DB_PATH);
}

type ReadOnlyConnectionOptions = {
  enableExternalAccess?: boolean;
};

export async function withReadOnlyConnection<T>(
  fn: (conn: DuckDBConnection) => Promise<T>,
  options: ReadOnlyConnectionOptions = {},
): Promise<T> {
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
): Promise<void> {
  await conn.run(sql);
}

export async function all<T extends Record<string, unknown>>(
  conn: DuckDBConnection,
  sql: string,
): Promise<T[]> {
  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjectsJson() as T[];
}
