/** Pinned Hugging Face dataset revision (not floating `main`). */
export const SOURCE_DATASET = "Tobi-Bueck/customer-support-tickets";
export const SOURCE_REVISION = "ddf1c81a5475992c4fa6752bf1e8b4e31f07bbeb";
export const SOURCE_FILENAME =
  "aa_dataset-tickets-multi-lang-5-2-50-version.csv";

/** SHA-256 of the pinned CSV bytes (matches HF x-linked-etag for this revision). */
export const EXPECTED_CSV_SHA256 =
  "f187c090e59581c2bbf3aa1377c8db4dd647464ecf2ae51bf8966e42e0ed6bc0";

/** Must match `npm run verify` after a clean ingest of the pinned CSV. */
export const EXPECTED_ROW_COUNT = 28587;

/** Rows in normalized `ticket_tags` (non-null tag_1..tag_8 exploded). */
export const EXPECTED_TAG_ROW_COUNT = 134165;

export const DATASET_URL = `https://huggingface.co/datasets/${SOURCE_DATASET}/resolve/${SOURCE_REVISION}/${SOURCE_FILENAME}`;
