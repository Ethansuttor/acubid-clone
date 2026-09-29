/**
 * Desktop storage (track S2): the SQLite + plan-file implementation of the C1
 * `WorkspaceStoragePort`, for the Electron main process. Wiring it into IPC
 * and the renderer is the integration step (I1), not this module.
 */

export {
  DATABASE_FILE,
  DEFAULT_BUSY_TIMEOUT_MS,
  LOCK_FILE,
  openSqliteWorkspaceStore,
  PLANS_DIR,
  SQLITE_STORAGE_CAPABILITIES,
  SqliteWorkspaceStore,
  type DatabaseBackupResult,
  type EditingLease,
  type IntegrityReport,
  type PlanFileInventory,
  type PlanObjectReference,
  type SqliteDiagnostics,
  type SqliteStoreHooks,
  type SqliteStoreOptions,
} from "./sqlite-store";
export { APPLICATION_ID, DOMAIN_TABLES, MIGRATIONS, SCHEMA_VERSION, TABLE_SPECS } from "./schema";
export { StorageValidationError } from "./codec";
