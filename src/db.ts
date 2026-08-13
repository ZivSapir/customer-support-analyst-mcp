import duckdb from "duckdb";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

export const DATA_DIR = path.join(REPO_ROOT, "data");
export const DB_PATH = path.join(DATA_DIR, "tickets.duckdb");
export const CSV_PATH = path.join(DATA_DIR, "tickets.csv");

type CreateDatabaseOptions = {
  readOnly?: boolean;
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

export function createDatabase(
  options: CreateDatabaseOptions = {},
): duckdb.Database {
  if (options.readOnly) {
    return new duckdb.Database(DB_PATH, duckdb.OPEN_READONLY);
  }

  return new duckdb.Database(DB_PATH);
}

export async function withReadOnlyConnection<T>(
  fn: (conn: duckdb.Connection) => Promise<T>,
): Promise<T> {
  await assertDatabaseExists();
  const db = createDatabase({ readOnly: true });
  const conn = connect(db);

  try {
    return await fn(conn);
  } finally {
    conn.close();
    db.close();
  }
}

export function connect(db: duckdb.Database): duckdb.Connection {
  return db.connect();
}

export function run(conn: duckdb.Connection, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.run(sql, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export function all<T extends Record<string, unknown>>(
  conn: duckdb.Connection,
  sql: string,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    conn.all(sql, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }

      resolve((rows ?? []) as T[]);
    });
  });
}
