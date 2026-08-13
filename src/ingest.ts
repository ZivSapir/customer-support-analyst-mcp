import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import {
  DATASET_URL,
  EXPECTED_CSV_SHA256,
  EXPECTED_ROW_COUNT,
  EXPECTED_TAG_ROW_COUNT,
  SOURCE_DATASET,
  SOURCE_FILENAME,
  SOURCE_REVISION,
} from "./dataset.js";
import {
  all,
  connect,
  createDatabase,
  CSV_PATH,
  CSV_TMP_PATH,
  DATA_DIR,
  DB_PATH,
  DB_TMP_PATH,
  INGEST_MANIFEST_PATH,
  run,
} from "./db.js";

export type IngestManifest = {
  source_dataset: string;
  source_revision: string;
  source_filename: string;
  source_url: string;
  csv_sha256: string;
  row_count: number;
  tag_row_count: number;
  ingested_at: string;
};

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function sha256File(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function removeIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // Missing is fine.
  }
}

async function downloadCsvToTemp(): Promise<void> {
  console.log(`Downloading pinned dataset (${SOURCE_REVISION.slice(0, 12)}…)…`);
  const response = await fetch(DATASET_URL);

  if (!response.ok) {
    throw new Error(
      `Dataset download failed: ${response.status} ${response.statusText}`,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await removeIfExists(CSV_TMP_PATH);
  await fs.writeFile(CSV_TMP_PATH, buffer);

  const digest = createHash("sha256").update(buffer).digest("hex");
  if (digest !== EXPECTED_CSV_SHA256) {
    await removeIfExists(CSV_TMP_PATH);
    throw new Error(
      `Downloaded CSV sha256 mismatch.\nExpected: ${EXPECTED_CSV_SHA256}\nActual:   ${digest}`,
    );
  }

  await fs.rename(CSV_TMP_PATH, CSV_PATH);
  console.log(`Saved CSV at ${CSV_PATH} (sha256 ${digest.slice(0, 12)}…)`);
}

async function ensurePinnedCsv(): Promise<string> {
  const csvExists = await fs
    .access(CSV_PATH)
    .then(() => true)
    .catch(() => false);

  if (csvExists) {
    const digest = await sha256File(CSV_PATH);
    if (digest === EXPECTED_CSV_SHA256) {
      console.log(`Using existing CSV at ${CSV_PATH} (checksum OK)`);
      return digest;
    }

    console.warn(
      `Existing CSV checksum mismatch (got ${digest.slice(0, 12)}…). Re-downloading.`,
    );
  }

  await downloadCsvToTemp();
  return EXPECTED_CSV_SHA256;
}

async function writeManifest(manifest: IngestManifest): Promise<void> {
  await fs.writeFile(
    INGEST_MANIFEST_PATH,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  console.log(`Wrote ingest manifest at ${INGEST_MANIFEST_PATH}`);
}

async function rebuildDatabase(csvSha256: string): Promise<number> {
  await removeIfExists(DB_TMP_PATH);
  await removeIfExists(`${DB_TMP_PATH}.wal`);

  const db = await createDatabase({ path: DB_TMP_PATH });
  const conn = await connect(db);

  let rowCount = 0;
  let tagRowCount = 0;

  try {
    const escapedCsvPath = CSV_PATH.replace(/'/g, "''");

    // Fail loudly on malformed rows (no ignore_errors).
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
        auto_detect = true
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
    rowCount = Number(stats[0]?.total ?? 0);

    if (rowCount !== EXPECTED_ROW_COUNT) {
      throw new Error(
        `Ingest row_count ${rowCount} !== expected ${EXPECTED_ROW_COUNT}. Refusing to replace the database.`,
      );
    }

    console.log("Normalizing tags into ticket_tags...");
    await run(
      conn,
      `
      CREATE TABLE ticket_tags AS
      SELECT ticket_id, tag
      FROM (
        SELECT ticket_id, tag_1 AS tag FROM tickets WHERE tag_1 IS NOT NULL AND trim(tag_1) <> ''
        UNION ALL
        SELECT ticket_id, tag_2 AS tag FROM tickets WHERE tag_2 IS NOT NULL AND trim(tag_2) <> ''
        UNION ALL
        SELECT ticket_id, tag_3 AS tag FROM tickets WHERE tag_3 IS NOT NULL AND trim(tag_3) <> ''
        UNION ALL
        SELECT ticket_id, tag_4 AS tag FROM tickets WHERE tag_4 IS NOT NULL AND trim(tag_4) <> ''
        UNION ALL
        SELECT ticket_id, tag_5 AS tag FROM tickets WHERE tag_5 IS NOT NULL AND trim(tag_5) <> ''
        UNION ALL
        SELECT ticket_id, tag_6 AS tag FROM tickets WHERE tag_6 IS NOT NULL AND trim(tag_6) <> ''
        UNION ALL
        SELECT ticket_id, tag_7 AS tag FROM tickets WHERE tag_7 IS NOT NULL AND trim(tag_7) <> ''
        UNION ALL
        SELECT ticket_id, tag_8 AS tag FROM tickets WHERE tag_8 IS NOT NULL AND trim(tag_8) <> ''
      ) exploded;
      `,
    );

    const tagStats = await all<{ total: number }>(
      conn,
      "SELECT COUNT(*)::INTEGER AS total FROM ticket_tags;",
    );
    tagRowCount = Number(tagStats[0]?.total ?? 0);
    if (tagRowCount !== EXPECTED_TAG_ROW_COUNT) {
      throw new Error(
        `ticket_tags row_count ${tagRowCount} !== expected ${EXPECTED_TAG_ROW_COUNT}. Refusing to replace the database.`,
      );
    }
  } finally {
    conn.closeSync();
    db.closeSync();
  }

  // Atomic swap: previous tickets.duckdb remains until this rename succeeds.
  await fs.rename(DB_TMP_PATH, DB_PATH);
  await removeIfExists(`${DB_TMP_PATH}.wal`);

  await writeManifest({
    source_dataset: SOURCE_DATASET,
    source_revision: SOURCE_REVISION,
    source_filename: SOURCE_FILENAME,
    source_url: DATASET_URL,
    csv_sha256: csvSha256,
    row_count: rowCount,
    tag_row_count: tagRowCount,
    ingested_at: new Date().toISOString(),
  });

  console.log(
    `Created DuckDB at ${DB_PATH} with ${rowCount} ticket rows and ${tagRowCount} tag rows`,
  );
  return rowCount;
}

async function main(): Promise<void> {
  await ensureDataDir();
  const csvSha256 = await ensurePinnedCsv();
  await rebuildDatabase(csvSha256);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
