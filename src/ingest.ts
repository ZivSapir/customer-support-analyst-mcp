import fs from "node:fs/promises";
import { all, connect, createDatabase, CSV_PATH, DATA_DIR, DB_PATH, run } from "./db.js";

const DATASET_URL =
  "https://huggingface.co/datasets/Tobi-Bueck/customer-support-tickets/resolve/main/aa_dataset-tickets-multi-lang-5-2-50-version.csv";

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function downloadCsv(): Promise<void> {
  console.log("Downloading dataset CSV from Hugging Face...");
  const response = await fetch(DATASET_URL);

  if (!response.ok) {
    throw new Error(
      `Dataset download failed: ${response.status} ${response.statusText}`,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(CSV_PATH, buffer);
  console.log(`Saved CSV at ${CSV_PATH}`);
}

async function rebuildDatabase(): Promise<void> {
  try {
    await fs.unlink(DB_PATH);
  } catch {
    // No existing database file yet.
  }

  const db = await createDatabase();
  const conn = await connect(db);

  try {
    const escapedCsvPath = CSV_PATH.replace(/'/g, "''");

    await run(
      conn,
      `
      CREATE TABLE tickets AS
      SELECT
        row_number() OVER () AS ticket_id,
        subject,
        body,
        answer,
        type,
        queue,
        lower(trim(priority)) AS priority,
        lower(trim(language)) AS language,
        version,
        tag_1,
        tag_2,
        tag_3,
        tag_4,
        tag_5,
        tag_6,
        tag_7,
        tag_8
      FROM read_csv(
        '${escapedCsvPath}',
        header = true,
        auto_detect = true,
        ignore_errors = true
      );
      `,
    );

    console.log("Building full-text index on subject and body...");
    await run(conn, "INSTALL fts;");
    await run(conn, "LOAD fts;");
    await run(
      conn,
      "PRAGMA create_fts_index('tickets', 'ticket_id', 'subject', 'body');",
    );

    const stats = await all<{ total: number }>(
      conn,
      "SELECT COUNT(*)::INTEGER AS total FROM tickets;",
    );
    console.log(`Created DuckDB at ${DB_PATH} with ${stats[0]?.total ?? 0} rows`);
  } finally {
    conn.closeSync();
    db.closeSync();
  }
}

async function main(): Promise<void> {
  await ensureDataDir();

  const csvExists = await fs
    .access(CSV_PATH)
    .then(() => true)
    .catch(() => false);

  if (!csvExists) {
    await downloadCsv();
  } else {
    console.log(`Using existing CSV at ${CSV_PATH}`);
  }

  await rebuildDatabase();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
