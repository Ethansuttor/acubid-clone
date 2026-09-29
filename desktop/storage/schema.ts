/**
 * Logical schema of the desktop SQLite store (track S2).
 *
 * Two artifacts live here and are deliberately kept separate:
 *
 * 1. `TABLE_SPECS` — the column/kind map the codec uses to validate and
 *    translate rows. It is derived from `src/lib/types.ts`, every Postgres
 *    migration in `supabase/migrations/`, and the columns the browser client
 *    adds itself (`id`, `created_at`, `updated_at` on every inserted row).
 * 2. `MIGRATIONS` — literal, versioned SQL. A shipped migration is frozen: it
 *    is never regenerated from the spec, so editing the spec can never silently
 *    change what "version 1" means on a user's disk. `verifySchema` (store
 *    open) fails closed if the spec and the live tables disagree.
 *
 * Mapping rules (see `codec.ts`):
 * - text / timestamp / enum  -> TEXT (timestamps stay ISO-8601 strings)
 * - number / integer         -> ANY with a numeric typeof CHECK. ANY keeps the
 *                               IEEE-754 double bit-for-bit (including -0),
 *                               which REAL affinity does not.
 * - boolean                  -> INTEGER 0/1
 * - json                     -> TEXT holding JSON (json_valid CHECK)
 * - absent (undefined) known columns are recorded in `_absent` so a row read
 *   back has exactly the keys it was written with; unknown fields are kept
 *   verbatim in `_extra` rather than dropped.
 * - `_seq` is an INTEGER PRIMARY KEY alias of rowid: insertion order survives
 *   VACUUM, and selects return rows in the same order as the browser store.
 *
 * Deliberate differences from the Postgres schema, recorded for review:
 * - Presence is not enforced (only `id` is required). Rows written before a
 *   column existed must migrate unchanged; readiness checks belong to preflight.
 * - `layers.item_id` / `layers.assembly_id` are NOT foreign keys. The browser
 *   keeps a dangling link after a catalog delete, which `extendEstimate`
 *   reports as missing-item / missing-assembly. Postgres' ON DELETE SET NULL
 *   would turn that into "unlinked"; the browser behavior is preserved.
 * - `user_id` has no users table locally and is plain text.
 */

export const DOMAIN_TABLES = [
  "projects",
  "documents",
  "sheets",
  "layers",
  "takeoffs",
  "items",
  "assemblies",
  "assembly_items",
  "direct_costs",
  "proposal_entries",
  "bid_snapshots",
] as const;

export type DomainTable = (typeof DOMAIN_TABLES)[number];

/** Parent-before-child order used when a whole workspace is written at once. */
export const INSERT_ORDER: readonly DomainTable[] = [
  "projects",
  "documents",
  "sheets",
  "layers",
  "items",
  "assemblies",
  "assembly_items",
  "takeoffs",
  "direct_costs",
  "proposal_entries",
  "bid_snapshots",
];

export type ColumnKind = "text" | "number" | "integer" | "boolean" | "timestamp" | "json" | "enum";

export interface NumberRule {
  readonly describe: string;
  readonly test: (value: number) => boolean;
}

export interface ColumnSpec {
  readonly name: string;
  readonly kind: ColumnKind;
  /** Allowed values for an enum column. */
  readonly values?: readonly string[];
  /** Range rule for a number/integer column (mirrored by a SQL CHECK). */
  readonly rule?: NumberRule;
  /** A json column that must hold an object when it is not null. */
  readonly object?: boolean;
  /** ON DELETE CASCADE foreign key to `<parent>.id`. */
  readonly parent?: DomainTable;
}

export interface TableSpec {
  readonly name: DomainTable;
  /** Every known column except `id` and the internal `_seq/_absent/_extra`. */
  readonly columns: readonly ColumnSpec[];
}

const text = (name: string, extra: Partial<ColumnSpec> = {}): ColumnSpec => ({ name, kind: "text", ...extra });
const num = (name: string, rule?: NumberRule): ColumnSpec => ({ name, kind: "number", rule });
const int = (name: string, rule?: NumberRule): ColumnSpec => ({ name, kind: "integer", rule });
const bool = (name: string): ColumnSpec => ({ name, kind: "boolean" });
const ts = (name: string): ColumnSpec => ({ name, kind: "timestamp" });
const json = (name: string): ColumnSpec => ({ name, kind: "json", object: true });
const oneOf = (name: string, values: readonly string[]): ColumnSpec => ({ name, kind: "enum", values });
const fk = (name: string, parent: DomainTable): ColumnSpec => ({ name, kind: "text", parent });

const positive: NumberRule = { describe: "greater than zero", test: (v) => v > 0 };
const nonNegative: NumberRule = { describe: "zero or more", test: (v) => v >= 0 };
const bondRange: NumberRule = { describe: "at least 0 and below 100", test: (v) => v >= 0 && v < 100 };

const TOOL = ["count", "linear", "area"] as const;
const stamps = [ts("created_at"), ts("updated_at")];

export const TABLE_SPECS: Readonly<Record<DomainTable, TableSpec>> = {
  projects: {
    name: "projects",
    columns: [
      text("user_id"),
      text("name"),
      num("labor_rate"),
      num("overhead_pct"),
      num("profit_pct"),
      num("waste_pct"),
      num("tax_pct"),
      num("labor_factor_pct"),
      num("labor_burden_pct"),
      num("small_tools_pct"),
      num("contingency_pct"),
      num("escalation_pct"),
      num("bond_pct", bondRange),
      ...stamps,
      ts("archived_at"),
    ],
  },
  documents: {
    name: "documents",
    columns: [
      fk("project_id", "projects"),
      text("user_id"),
      text("filename"),
      text("storage_path"),
      int("page_count"),
      ...stamps,
    ],
  },
  sheets: {
    name: "sheets",
    columns: [
      fk("document_id", "documents"),
      fk("project_id", "projects"),
      text("user_id"),
      int("page_number"),
      text("name"),
      num("scale_ft_per_unit"),
      json("calibration"),
      ...stamps,
    ],
  },
  layers: {
    name: "layers",
    columns: [
      fk("project_id", "projects"),
      text("user_id"),
      text("name"),
      text("color"),
      oneOf("tool", TOOL),
      text("item_id"),
      text("assembly_id"),
      num("rise_drop_ft"),
      num("typical_multiplier", positive),
      text("area"),
      text("system"),
      text("phase"),
      int("sort_order"),
      ...stamps,
    ],
  },
  takeoffs: {
    name: "takeoffs",
    columns: [
      fk("layer_id", "layers"),
      fk("sheet_id", "sheets"),
      fk("project_id", "projects"),
      text("user_id"),
      oneOf("kind", TOOL),
      json("geometry"),
      oneOf("source", ["manual", "ai"]),
      oneOf("status", ["confirmed", "pending", "rejected"]),
      num("ai_confidence"),
      oneOf("detection_review", ["local", "match", "no-match", "unresolved"]),
      ...stamps,
    ],
  },
  items: {
    name: "items",
    columns: [
      text("user_id"),
      text("code"),
      text("description"),
      text("unit"),
      num("material_cost"),
      num("labor_hours"),
      ...stamps,
    ],
  },
  assemblies: {
    name: "assemblies",
    columns: [text("user_id"), text("code"), text("name"), text("description"), ...stamps],
  },
  assembly_items: {
    name: "assembly_items",
    columns: [
      fk("assembly_id", "assemblies"),
      fk("item_id", "items"),
      text("user_id"),
      num("quantity"),
      ...stamps,
    ],
  },
  direct_costs: {
    name: "direct_costs",
    columns: [
      fk("project_id", "projects"),
      text("user_id"),
      text("description"),
      oneOf("category", ["quote", "subcontractor", "equipment", "permit", "bond", "other"]),
      num("amount"),
      bool("ohp_applies"),
      bool("taxable"),
      int("sort_order"),
      ...stamps,
    ],
  },
  proposal_entries: {
    name: "proposal_entries",
    columns: [
      fk("project_id", "projects"),
      text("user_id"),
      oneOf("kind", ["inclusion", "exclusion", "allowance", "alternate"]),
      text("description"),
      num("amount"),
      text("pricing_note"),
      int("sort_order"),
      ...stamps,
    ],
  },
  bid_snapshots: {
    name: "bid_snapshots",
    columns: [
      fk("project_id", "projects"),
      text("user_id"),
      int("revision", positive),
      text("label"),
      ...stamps,
      num("bid_price"),
      num("material_total"),
      num("labor_hours_total"),
      num("labor_cost"),
      int("warning_count", nonNegative),
      json("payload"),
    ],
  },
};

export function isDomainTable(name: unknown): name is DomainTable {
  return typeof name === "string" && (DOMAIN_TABLES as readonly string[]).includes(name);
}

/** Identifies a Voltline workspace database ("Volt"); a foreign file is refused. */
export const APPLICATION_ID = 0x566f6c74;

export interface Migration {
  readonly version: number;
  readonly description: string;
  readonly sql: string;
}

// ---------------------------------------------------------------------------
// Version 1 — FROZEN. Never edit after release; add version 2 instead.
// ---------------------------------------------------------------------------

const NUM = (c: string) => `${c} ANY CHECK (typeof(${c}) IN ('integer','real','null'))`;
const NUM_WHERE = (c: string, cond: string) =>
  `${c} ANY CHECK (typeof(${c}) IN ('integer','real','null') AND (${c} IS NULL OR (${cond})))`;
const INT = (c: string) =>
  `${c} ANY CHECK (typeof(${c}) IN ('integer','real','null') AND (${c} IS NULL OR ${c} = round(${c})))`;
const INT_WHERE = (c: string, cond: string) =>
  `${c} ANY CHECK (typeof(${c}) IN ('integer','real','null') AND (${c} IS NULL OR (${c} = round(${c}) AND ${cond})))`;
const BOOL = (c: string) => `${c} INTEGER CHECK (${c} IN (0, 1))`;
const JSONCOL = (c: string) => `${c} TEXT CHECK (${c} IS NULL OR json_valid(${c}))`;
const ENUM = (c: string, values: readonly string[]) =>
  `${c} TEXT CHECK (${c} IN (${values.map((v) => `'${v}'`).join(", ")}))`;
const FK = (c: string, parent: string) => `${c} TEXT REFERENCES ${parent}(id) ON DELETE CASCADE`;
const HEAD = `_seq INTEGER PRIMARY KEY,\n  id TEXT NOT NULL UNIQUE CHECK (length(id) > 0)`;
const TAIL = `created_at TEXT,\n  updated_at TEXT,\n  _absent TEXT CHECK (_absent IS NULL OR json_valid(_absent)),\n  _extra TEXT CHECK (_extra IS NULL OR json_valid(_extra))`;

const V1 = `
CREATE TABLE projects (
  ${HEAD},
  user_id TEXT,
  name TEXT,
  ${NUM("labor_rate")},
  ${NUM("overhead_pct")},
  ${NUM("profit_pct")},
  ${NUM("waste_pct")},
  ${NUM("tax_pct")},
  ${NUM("labor_factor_pct")},
  ${NUM("labor_burden_pct")},
  ${NUM("small_tools_pct")},
  ${NUM("contingency_pct")},
  ${NUM("escalation_pct")},
  ${NUM_WHERE("bond_pct", "bond_pct >= 0 AND bond_pct < 100")},
  archived_at TEXT,
  ${TAIL}
) STRICT;

CREATE TABLE documents (
  ${HEAD},
  ${FK("project_id", "projects")},
  user_id TEXT,
  filename TEXT,
  storage_path TEXT,
  ${INT("page_count")},
  ${TAIL}
) STRICT;
CREATE INDEX documents_project ON documents(project_id);
CREATE INDEX documents_storage_path ON documents(storage_path);

CREATE TABLE sheets (
  ${HEAD},
  ${FK("document_id", "documents")},
  ${FK("project_id", "projects")},
  user_id TEXT,
  ${INT("page_number")},
  name TEXT,
  ${NUM("scale_ft_per_unit")},
  ${JSONCOL("calibration")},
  ${TAIL},
  UNIQUE (document_id, page_number)
) STRICT;
CREATE INDEX sheets_project ON sheets(project_id);

CREATE TABLE layers (
  ${HEAD},
  ${FK("project_id", "projects")},
  user_id TEXT,
  name TEXT,
  color TEXT,
  ${ENUM("tool", ["count", "linear", "area"])},
  item_id TEXT,
  assembly_id TEXT,
  ${NUM("rise_drop_ft")},
  ${NUM_WHERE("typical_multiplier", "typical_multiplier > 0")},
  area TEXT,
  system TEXT,
  phase TEXT,
  ${INT("sort_order")},
  ${TAIL}
) STRICT;
CREATE INDEX layers_project ON layers(project_id);

CREATE TABLE items (
  ${HEAD},
  user_id TEXT,
  code TEXT,
  description TEXT,
  unit TEXT,
  ${NUM("material_cost")},
  ${NUM("labor_hours")},
  ${TAIL}
) STRICT;

CREATE TABLE assemblies (
  ${HEAD},
  user_id TEXT,
  code TEXT,
  name TEXT,
  description TEXT,
  ${TAIL}
) STRICT;

CREATE TABLE assembly_items (
  ${HEAD},
  ${FK("assembly_id", "assemblies")},
  ${FK("item_id", "items")},
  user_id TEXT,
  ${NUM("quantity")},
  ${TAIL}
) STRICT;
CREATE INDEX assembly_items_assembly ON assembly_items(assembly_id);
CREATE INDEX assembly_items_item ON assembly_items(item_id);

CREATE TABLE takeoffs (
  ${HEAD},
  ${FK("layer_id", "layers")},
  ${FK("sheet_id", "sheets")},
  ${FK("project_id", "projects")},
  user_id TEXT,
  ${ENUM("kind", ["count", "linear", "area"])},
  ${JSONCOL("geometry")},
  ${ENUM("source", ["manual", "ai"])},
  ${ENUM("status", ["confirmed", "pending", "rejected"])},
  ${NUM("ai_confidence")},
  ${ENUM("detection_review", ["local", "match", "no-match", "unresolved"])},
  ${TAIL}
) STRICT;
CREATE INDEX takeoffs_project ON takeoffs(project_id);
CREATE INDEX takeoffs_sheet ON takeoffs(sheet_id);
CREATE INDEX takeoffs_layer ON takeoffs(layer_id);

CREATE TABLE direct_costs (
  ${HEAD},
  ${FK("project_id", "projects")},
  user_id TEXT,
  description TEXT,
  ${ENUM("category", ["quote", "subcontractor", "equipment", "permit", "bond", "other"])},
  ${NUM("amount")},
  ${BOOL("ohp_applies")},
  ${BOOL("taxable")},
  ${INT("sort_order")},
  ${TAIL}
) STRICT;
CREATE INDEX direct_costs_project ON direct_costs(project_id);

CREATE TABLE proposal_entries (
  ${HEAD},
  ${FK("project_id", "projects")},
  user_id TEXT,
  ${ENUM("kind", ["inclusion", "exclusion", "allowance", "alternate"])},
  description TEXT,
  ${NUM("amount")},
  pricing_note TEXT,
  ${INT("sort_order")},
  ${TAIL}
) STRICT;
CREATE INDEX proposal_entries_project ON proposal_entries(project_id);

CREATE TABLE bid_snapshots (
  ${HEAD},
  ${FK("project_id", "projects")},
  user_id TEXT,
  ${INT_WHERE("revision", "revision > 0")},
  label TEXT,
  ${NUM("bid_price")},
  ${NUM("material_total")},
  ${NUM("labor_hours_total")},
  ${NUM("labor_cost")},
  ${INT_WHERE("warning_count", "warning_count >= 0")},
  ${JSONCOL("payload")},
  ${TAIL},
  UNIQUE (project_id, revision)
) STRICT;

-- Issued revisions are frozen. Deleting a project still removes them, exactly
-- as the browser store and Postgres cascade do.
CREATE TRIGGER bid_snapshots_frozen BEFORE UPDATE ON bid_snapshots
BEGIN SELECT RAISE(ABORT, 'voltline:snapshot-frozen'); END;

-- Append-only local outbox. Every mutation writes exactly one row here inside
-- the same transaction as the change itself. AUTOINCREMENT keeps the sequence
-- monotonic (never reused), which a future sync protocol can rely on.
CREATE TABLE outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  synced_at TEXT
) STRICT;

-- Logical plan path -> immutable content. Bytes live on disk under
-- plans/objects/<first two hex>/<sha256>. A removed path keeps its row with
-- removed_at set, so historical references (frozen snapshots) still resolve to
-- the exact bytes and a path can never be rebound to different content.
CREATE TABLE plan_files (
  storage_path TEXT PRIMARY KEY NOT NULL CHECK (length(storage_path) > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  size INTEGER NOT NULL CHECK (size >= 0),
  content_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  removed_at TEXT
) STRICT;
CREATE INDEX plan_files_sha256 ON plan_files(sha256);

CREATE TRIGGER plan_files_immutable BEFORE UPDATE OF sha256 ON plan_files
WHEN NEW.sha256 <> OLD.sha256
BEGIN SELECT RAISE(ABORT, 'voltline:plan-file-immutable'); END;

CREATE TRIGGER plan_files_in_use BEFORE UPDATE OF removed_at ON plan_files
WHEN NEW.removed_at IS NOT NULL AND OLD.removed_at IS NULL
  AND EXISTS (SELECT 1 FROM documents WHERE storage_path = NEW.storage_path)
BEGIN SELECT RAISE(ABORT, 'voltline:plan-file-in-use'); END;

CREATE TRIGGER plan_files_delete_in_use BEFORE DELETE ON plan_files
WHEN EXISTS (SELECT 1 FROM documents WHERE storage_path = OLD.storage_path)
BEGIN SELECT RAISE(ABORT, 'voltline:plan-file-in-use'); END;

-- A committed document may only reference plan bytes that were already
-- published and recorded. The file is written first, the reference second.
CREATE TRIGGER documents_require_plan_file BEFORE INSERT ON documents
WHEN NEW.storage_path IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM plan_files WHERE storage_path = NEW.storage_path AND removed_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'voltline:missing-plan-file'); END;

CREATE TRIGGER documents_require_plan_file_update BEFORE UPDATE OF storage_path ON documents
WHEN NEW.storage_path IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM plan_files WHERE storage_path = NEW.storage_path AND removed_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'voltline:missing-plan-file'); END;

-- Deleting a document (directly or by project cascade) removes its logical
-- plan path, as the browser store does. The bytes are retained on disk.
CREATE TRIGGER documents_release_plan_file AFTER DELETE ON documents
BEGIN
  UPDATE plan_files SET removed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE storage_path = OLD.storage_path AND removed_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM documents WHERE storage_path = OLD.storage_path);
END;

PRAGMA application_id = ${APPLICATION_ID};
`;

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, description: "Logical Voltline schema, outbox, plan file map", sql: V1 },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Internal columns every domain table carries besides its spec columns. */
export const INTERNAL_COLUMNS = ["_seq", "id", "_absent", "_extra"] as const;
