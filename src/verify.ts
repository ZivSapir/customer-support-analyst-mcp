import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_CSV_SHA256,
  EXPECTED_ROW_COUNT,
  SOURCE_DATASET,
  SOURCE_REVISION,
} from "./dataset.js";
import { INGEST_MANIFEST_PATH } from "./db.js";
import { executeReadOnlyQuery, MAX_SQL_ROWS } from "./query.js";
import { getTicketSchema } from "./schema.js";
import { searchMetrics, searchTickets } from "./search.js";
import { validateReadOnlySql, wrapWithRowLimit } from "./sql-guard.js";

/** Pinned aggregates for the Hugging Face revision used by `npm run ingest`. */
const EXPECTED = {
  rowCount: EXPECTED_ROW_COUNT,
  highPriority: 11178,
  languageDe: 12249,
  languageEn: 16338,
  refundMatchCount: 20,
  columns: 17,
} as const;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_QUESTIONS_PATH = path.join(__dirname, "..", "eval", "questions.json");

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function queryScalarN(sql: string): Promise<number> {
  const guard = validateReadOnlySql(sql);
  if (!guard.ok) {
    throw new Error(guard.error);
  }

  const result = await executeReadOnlyQuery(
    wrapWithRowLimit(guard.sql, MAX_SQL_ROWS),
  );
  return Number(result.rows[0]?.n);
}

async function assertEvalQuestionsFile(): Promise<void> {
  const raw = await readFile(EVAL_QUESTIONS_PATH, "utf8");
  const parsed: unknown = JSON.parse(raw);
  assert(Array.isArray(parsed), "eval/questions.json must be an array");
  const entries = parsed as unknown[];
  assert(entries.length > 0, "eval/questions.json must not be empty");

  for (const [index, entry] of entries.entries()) {
    assert(
      typeof entry === "object" && entry !== null,
      `eval/questions.json[${index}] must be an object`,
    );
    const row = entry as Record<string, unknown>;
    assert(
      typeof row.question === "string" && row.question.length > 0,
      `eval/questions.json[${index}].question required`,
    );
    assert(
      typeof row.expected_tool === "string" && row.expected_tool.length > 0,
      `eval/questions.json[${index}].expected_tool required`,
    );
  }

  console.log(`eval/questions.json: ${entries.length} example routes (metadata only)`);
}

async function main(): Promise<void> {
  const schema = await getTicketSchema();
  assert(schema.table === "tickets", "schema.table should be tickets");
  assert(
    schema.row_count === EXPECTED.rowCount,
    `schema.row_count should be ${EXPECTED.rowCount} (got ${schema.row_count}) — partial ingest?`,
  );
  assert(
    schema.columns.length === EXPECTED.columns,
    `expected ${EXPECTED.columns} columns`,
  );
  console.log(`schema: ${schema.row_count} rows, ${schema.columns.length} columns`);

  const counted = await queryScalarN(
    "SELECT COUNT(*)::INTEGER AS n FROM tickets",
  );
  assert(
    counted === EXPECTED.rowCount,
    `COUNT(*) should be ${EXPECTED.rowCount} (got ${counted})`,
  );
  console.log(`query_tickets COUNT(*): ${counted}`);

  const high = await queryScalarN(
    "SELECT COUNT(*)::INTEGER AS n FROM tickets WHERE priority = 'high'",
  );
  assert(
    high === EXPECTED.highPriority,
    `high-priority count should be ${EXPECTED.highPriority} (got ${high})`,
  );
  console.log(`high-priority count: ${high}`);

  const de = await queryScalarN(
    "SELECT COUNT(*)::INTEGER AS n FROM tickets WHERE language = 'de'",
  );
  const en = await queryScalarN(
    "SELECT COUNT(*)::INTEGER AS n FROM tickets WHERE language = 'en'",
  );
  assert(de === EXPECTED.languageDe, `language=de should be ${EXPECTED.languageDe}`);
  assert(en === EXPECTED.languageEn, `language=en should be ${EXPECTED.languageEn}`);
  assert(de + en === EXPECTED.rowCount, "en+de should equal total rows");
  console.log(`language counts: en=${en} de=${de}`);

  const drop = validateReadOnlySql("DROP TABLE tickets");
  assert(!drop.ok, "DROP should be rejected by the SQL guard");

  const multi = validateReadOnlySql("SELECT 1; DROP TABLE tickets");
  assert(!multi.ok, "multi-statement SQL should be rejected");

  // Known heuristic gap (Issue 2): comment/string tokenization can approve this.
  // Real teeth are READ_ONLY + enable_external_access=false — exercised above via read_csv.
  const stringComment = validateReadOnlySql("SELECT '--'; DROP TABLE tickets");
  console.log(
    `sql-guard string/comment case: ${stringComment.ok ? "approved (known heuristic gap)" : "rejected"}`,
  );
  console.log("sql-guard: DROP/multi rejected");

  const fsSql = "SELECT * FROM read_csv('/etc/passwd') LIMIT 1";
  const fsGuard = validateReadOnlySql(fsSql);
  if (!fsGuard.ok) {
    throw new Error(
      "read_csv SELECT should pass the keyword guard (blocked by DuckDB config)",
    );
  }
  let fsBlocked = false;
  try {
    await executeReadOnlyQuery(wrapWithRowLimit(fsGuard.sql, MAX_SQL_ROWS));
  } catch {
    fsBlocked = true;
  }
  assert(fsBlocked, "host SQL path should reject external read_csv");
  console.log("external read_csv blocked on query path");

  const uncappedGuard = validateReadOnlySql("SELECT ticket_id FROM tickets");
  if (!uncappedGuard.ok) {
    throw new Error(uncappedGuard.error);
  }
  const capped = await executeReadOnlyQuery(
    wrapWithRowLimit(uncappedGuard.sql, MAX_SQL_ROWS),
  );
  assert(capped.rowCount === MAX_SQL_ROWS, `row cap should be ${MAX_SQL_ROWS}`);
  assert(capped.truncated, "wide SELECT should set truncated=true");
  console.log(`row cap: ${capped.rowCount} truncated=${capped.truncated}`);

  const hits = await searchTickets({ query: "refund", k: 3 });
  assert(hits.length > 0, "search_tickets('refund') should return hits");
  console.log(`search_tickets refund hits: ${hits.length} (top id ${hits[0]?.ticket_id})`);

  const filtered = await searchTickets({
    query: "refund",
    k: 5,
    priority: "high",
  });
  assert(filtered.length > 0, "search_tickets refund+high should return hits");
  assert(
    filtered.every((hit) => hit.priority === "high"),
    "search_tickets priority filter should only return high",
  );
  console.log(`search_tickets refund+high hits: ${filtered.length}`);

  const deHits = await searchTickets({
    query: "account",
    k: 3,
    language: "de",
  });
  assert(
    deHits.every((hit) => hit.language === "de"),
    "language=de filter should only return German rows",
  );
  console.log(`search_tickets language=de hits: ${deHits.length} (FTS English-optimized)`);

  const metrics = await searchMetrics({ query: "refund" });
  assert(
    metrics.match_count === EXPECTED.refundMatchCount,
    `search_metrics('refund') should be ${EXPECTED.refundMatchCount} (got ${metrics.match_count})`,
  );
  console.log(`search_metrics refund match_count: ${metrics.match_count}`);

  const byQueue = await searchMetrics({
    query: "refund",
    group_by: "queue",
  });
  assert(byQueue.groups.length > 0, "search_metrics group_by queue should return groups");
  assert(
    byQueue.match_count === EXPECTED.refundMatchCount,
    "grouped match_count should match ungrouped refund total",
  );
  console.log(
    `search_metrics refund by queue: ${byQueue.groups.length} groups (total ${byQueue.match_count})`,
  );

  await assertEvalQuestionsFile();

  const manifestRaw = await readFile(INGEST_MANIFEST_PATH, "utf8");
  const manifest = JSON.parse(manifestRaw) as {
    source_dataset?: string;
    source_revision?: string;
    csv_sha256?: string;
    row_count?: number;
  };
  assert(
    manifest.source_dataset === SOURCE_DATASET,
    "ingest-manifest source_dataset mismatch",
  );
  assert(
    manifest.source_revision === SOURCE_REVISION,
    "ingest-manifest source_revision mismatch",
  );
  assert(
    manifest.csv_sha256 === EXPECTED_CSV_SHA256,
    "ingest-manifest csv_sha256 mismatch",
  );
  assert(
    manifest.row_count === EXPECTED.rowCount,
    "ingest-manifest row_count mismatch",
  );
  console.log(
    `ingest-manifest: ${manifest.source_dataset}@${String(manifest.source_revision).slice(0, 12)}… rows=${manifest.row_count}`,
  );

  console.log("verify ok");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
