# R2 Offline Directory Index Design

## Goal

Directory listing requests should not scan R2. R2 remains the source of truth for file bodies, but directory metadata is materialized offline into D1 and read by the ingress Worker.

This design makes request-time directory listing complexity proportional to the number of direct children in the requested directory, not the number of descendant objects under that prefix.

```text
R2 bucket
  -> R2 event notification
  -> Cloudflare Queue
  -> indexer Worker
  -> D1 canonical index
  -> ingress Worker reads D1
```

## Storage decisions

| Data | Storage | Role |
| --- | --- | --- |
| File bodies | R2 | Source of truth |
| File metadata index | D1 | Canonical indexed metadata |
| Folder aggregate index | D1 | Canonical folder size/count/time metadata |
| R2 event stream | Cloudflare Queue | Async indexing and retries |
| Short-lived listing/miss cache | Existing `R2_INDEX_CACHE` KV | Optional cache only, not source of truth |

D1 is the canonical index store. KV must not be used as the canonical index because folder aggregates require transactional updates, indexed prefix queries, and recomputation after deletes.

## Cloudflare resources

Create one shared D1 database:

```sh
wrangler d1 create r2-index-kai-index
```

Create indexing queues:

```sh
wrangler queues create r2-index-kai-events
wrangler queues create r2-index-kai-events-dlq
```

Configure R2 event notifications for both buckets:

```sh
wrangler r2 bucket notification create poi-db --event-type object-create --event-type object-delete --queue r2-index-kai-events
wrangler r2 bucket notification create poi-nightlies --event-type object-create --event-type object-delete --queue r2-index-kai-events
```

## Wrangler configuration

### Ingress Worker

The existing `wrangler.jsonc` should keep current R2 and KV bindings and add the shared D1 binding:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "r2-index-kai",
  "compatibility_date": "2025-04-04",
  "main": "./workers/app.ts",
  "r2_buckets": [
    { "binding": "BUCKET_POI_DB", "bucket_name": "poi-db" },
    { "binding": "BUCKET_POI_NIGHTLIES", "bucket_name": "poi-nightlies" }
  ],
  "kv_namespaces": [
    {
      "binding": "R2_INDEX_CACHE",
      "id": "4caf510805554a53968fe664289e0b98"
    }
  ],
  "d1_databases": [
    {
      "binding": "R2_INDEX_DB",
      "database_name": "r2-index-kai-index",
      "database_id": "<created-by-wrangler>"
    }
  ],
  "routes": [
    { "pattern": "db.poi.moe/*", "zone_name": "poi.moe" },
    { "pattern": "nightlies.poi.moe/*", "zone_name": "poi.moe" },
    { "pattern": "nightly.poi.moe/*", "zone_name": "poi.moe" }
  ]
}
```

### Indexer Worker

Add `wrangler.indexer.jsonc`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "r2-index-kai-indexer",
  "compatibility_date": "2025-04-04",
  "main": "./workers/indexer.ts",
  "workers_dev": true,
  "r2_buckets": [
    { "binding": "BUCKET_POI_DB", "bucket_name": "poi-db" },
    { "binding": "BUCKET_POI_NIGHTLIES", "bucket_name": "poi-nightlies" }
  ],
  "d1_databases": [
    {
      "binding": "R2_INDEX_DB",
      "database_name": "r2-index-kai-index",
      "database_id": "<same-database-id-as-ingress>"
    }
  ],
  "queues": {
    "producers": [
      { "binding": "R2_INDEX_QUEUE", "queue": "r2-index-kai-events" }
    ],
    "consumers": [
      {
        "queue": "r2-index-kai-events",
        "max_batch_size": 50,
        "max_batch_timeout": 10,
        "max_retries": 5,
        "dead_letter_queue": "r2-index-kai-events-dlq"
      }
    ]
  },
  "triggers": {
    "crons": ["17 */6 * * *"]
  }
}
```

## Site mapping

Update `app/lib/sites.ts` so every site exposes a stable bucket name in addition to the R2 binding:

```ts
interface Site {
  title: string
  bucketName: 'poi-db' | 'poi-nightlies'
  bucket: R2Bucket
  description: string
}
```

Example:

```ts
'db.poi.moe': {
  title: 'poi-db monthly dumps',
  bucketName: 'poi-db',
  bucket: env.BUCKET_POI_DB,
  description: 'poi-db monthly dumps',
}
```

The ingress Worker uses `bucketName` for D1 queries and `bucket` only for direct file serving or an explicitly enabled fallback path.

## D1 schema

Add `migrations/0001_index.sql`:

```sql
CREATE TABLE index_buckets (
  bucket TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  generation INTEGER NOT NULL DEFAULT 0,
  last_scan_started_at INTEGER,
  last_scan_finished_at INTEGER,
  last_event_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE objects (
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

CREATE INDEX objects_by_parent
  ON objects(bucket, parent_prefix, name);

CREATE INDEX objects_by_generation
  ON objects(bucket, seen_generation);

CREATE TABLE folders (
  bucket TEXT NOT NULL,
  prefix TEXT NOT NULL,
  parent_prefix TEXT,
  name TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  total_file_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER,
  modified_at INTEGER,
  needs_recompute INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (bucket, prefix)
);

CREATE INDEX folders_by_parent
  ON folders(bucket, parent_prefix, name);

CREATE INDEX folders_needing_recompute
  ON folders(bucket, needs_recompute);

CREATE TABLE object_ancestors (
  bucket TEXT NOT NULL,
  key TEXT NOT NULL,
  prefix TEXT NOT NULL,
  PRIMARY KEY (bucket, key, prefix)
);

CREATE INDEX object_ancestors_by_prefix
  ON object_ancestors(bucket, prefix);

CREATE TABLE index_runs (
  id TEXT PRIMARY KEY,
  bucket TEXT NOT NULL,
  kind TEXT NOT NULL,
  generation INTEGER NOT NULL,
  cursor TEXT,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);
```

Root folder is represented by `prefix = ''` and `parent_prefix = NULL`.

## Prefix rules

Use these helpers consistently:

```ts
const getParentPrefix = (key: string) => {
  const index = key.lastIndexOf('/')
  return index === -1 ? '' : key.slice(0, index + 1)
}

const getName = (key: string) => {
  const index = key.lastIndexOf('/')
  return index === -1 ? key : key.slice(index + 1)
}

const getAncestorPrefixes = (key: string) => {
  const prefixes = ['']
  let slash = key.indexOf('/')
  while (slash !== -1) {
    prefixes.push(key.slice(0, slash + 1))
    slash = key.indexOf('/', slash + 1)
  }
  return prefixes
}
```

For `a/b/file.zip`:

```text
parent_prefix = "a/b/"
name = "file.zip"
ancestors = ["", "a/", "a/b/"]
```

Folder metadata definitions:

```text
folder.size = SUM(size of descendant files)
folder.total_file_count = COUNT(descendant files)
folder.created_at = MIN(uploaded_at of descendant files)
folder.modified_at = MAX(uploaded_at of descendant files)
```

R2 has no real folders, so `created_at` is inferred as the earliest descendant upload time.

## Ingress listing query

For a directory prefix:

```sql
SELECT
  'folder' AS type,
  prefix AS key,
  name,
  size,
  created_at AS created,
  modified_at AS modified
FROM folders
WHERE bucket = ? AND parent_prefix = ?

UNION ALL

SELECT
  'file' AS type,
  key,
  name,
  size,
  uploaded_at AS created,
  uploaded_at AS modified
FROM objects
WHERE bucket = ? AND parent_prefix = ?

ORDER BY type DESC, name COLLATE NOCASE;
```

Request-time complexity:

```text
O(number of direct children in the requested directory)
```

The route should return 404 when:

```text
no matching object rows
and no matching folder rows
and prefix is not root
```

The route should not call `bucket.list()` for normal directory listings.

## Indexer job types

Use one Queue for all indexing jobs:

```ts
type IndexJob =
  | {
      kind: 'r2-event'
      bucket: 'poi-db' | 'poi-nightlies'
      eventType: 'object-create' | 'object-delete'
      key: string
      eventTime: number
    }
  | {
      kind: 'full-scan-page'
      bucket: 'poi-db' | 'poi-nightlies'
      generation: number
      cursor?: string
    }
  | {
      kind: 'finish-full-scan'
      bucket: 'poi-db' | 'poi-nightlies'
      generation: number
    }
```

## Full scan flow

Scheduled handler runs every six hours.

For each configured bucket:

```text
1. If a scan is already running for the bucket, skip.
2. Set generation = Date.now().
3. Upsert index_buckets row with status = 'scanning'.
4. Enqueue full-scan-page with no cursor.
```

`full-scan-page` handler:

```text
1. Resolve bucket name to R2 binding.
2. List R2 with limit 1000, no delimiter, and the job cursor.
3. For each object:
   - compute parent_prefix, name, ancestors
   - upsert objects row
   - set seen_generation = job.generation
   - ensure folders rows for each ancestor
   - upsert object_ancestors rows
   - mark affected folders needs_recompute = 1
4. If R2 returned a cursor, enqueue the next full-scan-page.
5. If no cursor, enqueue finish-full-scan.
```

`finish-full-scan` handler:

```text
1. Find stale objects where seen_generation < generation.
2. For each stale object:
   - mark old ancestors needs_recompute = 1
   - delete object row
   - delete object_ancestors rows
3. Recompute all folders where needs_recompute = 1.
4. Delete empty folder rows except the root folder.
5. Mark index_buckets status = 'ready'.
```

The full scan never loads the whole bucket into memory.

## Event update flow

### Create or overwrite

```text
1. Resolve bucket to R2 binding.
2. Run bucket.head(key).
3. If head returns null, process as delete.
4. Read old objects row.
5. Upsert the objects row with current size/uploaded/etag.
6. Delete and recreate object_ancestors rows for this key.
7. Ensure folder rows exist for all ancestors.
8. Mark all old and new ancestors needs_recompute = 1.
9. Recompute those folders.
10. Update index_buckets.last_event_at.
```

Always recompute affected ancestors after event updates. This is slightly more expensive than arithmetic deltas but avoids timestamp edge cases and out-of-order overwrite bugs.

### Delete

```text
1. Resolve bucket to R2 binding.
2. Run bucket.head(key).
3. If object still exists, ignore the delete event as stale/out-of-order.
4. Read old objects row.
5. If missing, no-op.
6. Mark old ancestors needs_recompute = 1.
7. Delete object row.
8. Delete object_ancestors rows.
9. Recompute old ancestors.
10. Delete empty folder rows except the root folder.
11. Update index_buckets.last_event_at.
```

Duplicate events are safe because all operations are idempotent.

## Folder recomputation

For each dirty folder prefix:

```sql
SELECT
  COALESCE(SUM(o.size), 0) AS size,
  COUNT(*) AS total_file_count,
  MIN(o.uploaded_at) AS created_at,
  MAX(o.uploaded_at) AS modified_at
FROM objects o
JOIN object_ancestors a
  ON a.bucket = o.bucket
 AND a.key = o.key
WHERE a.bucket = ?
  AND a.prefix = ?;
```

Then update the folder:

```sql
UPDATE folders
SET
  size = ?,
  total_file_count = ?,
  created_at = ?,
  modified_at = ?,
  needs_recompute = 0,
  updated_at = ?
WHERE bucket = ?
  AND prefix = ?;
```

## Worker code layout

Recommended files:

```text
app/lib/sites.ts
app/lib/index-db.ts
app/routes/catch-all.tsx
workers/app.ts
workers/indexer.ts
workers/indexer/jobs.ts
workers/indexer/r2-events.ts
workers/indexer/folders.ts
workers/indexer/full-scan.ts
workers/indexer/buckets.ts
```

`app/lib/index-db.ts` should contain ingress-side read queries only.

`workers/indexer/*` should contain all write/recompute logic.

## Ingress fallback policy

Use a configuration flag:

```ts
INDEX_LIVE_FALLBACK = false
```

Production target behavior:

```text
manifest/index ready -> read D1 and render
index missing/stale -> return 503 "index not ready" or 404 when prefix is known absent
```

During migration only:

```text
if INDEX_LIVE_FALLBACK is true:
  live-scan R2
  return listing
  enqueue scan/recompute
```

Fallback should be disabled once both buckets are fully indexed.

## Complexity

| Operation | Complexity |
| --- | --- |
| Directory request | O(direct children) |
| Full scan | O(total objects * path depth), offline |
| Create/overwrite event | O(path depth + affected descendant query cost for ancestors) |
| Delete event | O(path depth + affected descendant query cost for ancestors) |
| Folder recompute | O(descendant files of dirty folder), offline |

The important constraint is that expensive descendant work happens in the indexer, not in the ingress request path.

## Deployment sequence

1. Create D1 database and Queues.
2. Add D1 binding to `wrangler.jsonc`.
3. Add `wrangler.indexer.jsonc`.
4. Add D1 migration and apply it:

   ```sh
   wrangler d1 migrations apply r2-index-kai-index --remote
   ```

5. Deploy indexer Worker.
6. Configure R2 event notifications for both buckets.
7. Trigger or wait for a full scan for `poi-db` and `poi-nightlies`.
8. Confirm `index_buckets.status = 'ready'` for both buckets.
9. Change ingress directory listing route to read from D1.
10. Deploy ingress Worker.
11. Disable live R2 listing fallback in production.

## Operational checks

Useful D1 checks:

```sql
SELECT bucket, status, generation, last_scan_finished_at, last_event_at
FROM index_buckets;
```

```sql
SELECT bucket, COUNT(*) AS object_count
FROM objects
GROUP BY bucket;
```

```sql
SELECT bucket, COUNT(*) AS dirty_folders
FROM folders
WHERE needs_recompute = 1
GROUP BY bucket;
```

The indexer should log:

```text
bucket
job kind
generation
cursor presence
objects processed
folders recomputed
queue batch size
error details
```

Avoid swallowing indexing errors; failed Queue messages should retry and eventually land in the dead-letter queue.
