export const INDEX_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS index_buckets (
  bucket TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  generation INTEGER NOT NULL DEFAULT 0,
  last_scan_started_at INTEGER,
  last_scan_finished_at INTEGER,
  last_event_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS objects (
  bucket TEXT NOT NULL,
  key TEXT NOT NULL,
  parent_prefix TEXT NOT NULL,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_at INTEGER NOT NULL,
  etag TEXT,
  seen_generation INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (bucket, key)
);

CREATE INDEX IF NOT EXISTS objects_by_parent
  ON objects(bucket, parent_prefix, name);

CREATE INDEX IF NOT EXISTS objects_by_generation
  ON objects(bucket, seen_generation, updated_at, key);

CREATE TABLE IF NOT EXISTS folders (
  bucket TEXT NOT NULL,
  prefix TEXT NOT NULL,
  parent_prefix TEXT,
  name TEXT NOT NULL,
  explicit_marker INTEGER NOT NULL DEFAULT 0,
  marker_seen_generation INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  total_file_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER,
  modified_at INTEGER,
  needs_recompute INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (bucket, prefix)
);

CREATE INDEX IF NOT EXISTS folders_by_parent
  ON folders(bucket, parent_prefix, name);

CREATE INDEX IF NOT EXISTS folders_needing_recompute
  ON folders(bucket, needs_recompute);

CREATE TABLE IF NOT EXISTS index_runs (
  id TEXT PRIMARY KEY,
  bucket TEXT NOT NULL,
  kind TEXT NOT NULL,
  generation INTEGER NOT NULL,
  cursor TEXT,
  status TEXT NOT NULL,
  lease_expires_at INTEGER,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS index_runs_by_bucket_status
  ON index_runs(bucket, status, lease_expires_at);

CREATE INDEX IF NOT EXISTS index_runs_by_bucket_generation_kind
  ON index_runs(bucket, generation, kind);
`
