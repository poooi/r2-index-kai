import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const indexBuckets = sqliteTable('index_buckets', {
  bucket: text('bucket').primaryKey(),
  status: text('status').notNull().default('pending'),
  generation: integer('generation').notNull().default(0),
  lastScanStartedAt: integer('last_scan_started_at'),
  lastScanFinishedAt: integer('last_scan_finished_at'),
  lastEventAt: integer('last_event_at'),
  updatedAt: integer('updated_at').notNull(),
})

export const objects = sqliteTable(
  'objects',
  {
    bucket: text('bucket').notNull(),
    key: text('key').notNull(),
    parentPrefix: text('parent_prefix').notNull(),
    name: text('name').notNull(),
    size: integer('size').notNull(),
    uploadedAt: integer('uploaded_at').notNull(),
    etag: text('etag'),
    seenGeneration: integer('seen_generation').notNull().default(0),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.bucket, table.key] }),
    index('objects_by_parent').on(table.bucket, table.parentPrefix, table.name),
    index('objects_by_generation').on(
      table.bucket,
      table.seenGeneration,
      table.updatedAt,
      table.key,
    ),
  ],
)

export const folders = sqliteTable(
  'folders',
  {
    bucket: text('bucket').notNull(),
    prefix: text('prefix').notNull(),
    parentPrefix: text('parent_prefix'),
    name: text('name').notNull(),
    explicitMarker: integer('explicit_marker').notNull().default(0),
    markerSeenGeneration: integer('marker_seen_generation').notNull().default(0),
    size: integer('size').notNull().default(0),
    totalFileCount: integer('total_file_count').notNull().default(0),
    createdAt: integer('created_at'),
    modifiedAt: integer('modified_at'),
    needsRecompute: integer('needs_recompute').notNull().default(0),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.bucket, table.prefix] }),
    index('folders_by_parent').on(table.bucket, table.parentPrefix, table.name),
    index('folders_needing_recompute').on(table.bucket, table.needsRecompute),
  ],
)

export const indexRuns = sqliteTable(
  'index_runs',
  {
    id: text('id').primaryKey(),
    bucket: text('bucket').notNull(),
    kind: text('kind').notNull(),
    generation: integer('generation').notNull(),
    cursor: text('cursor'),
    status: text('status').notNull(),
    leaseExpiresAt: integer('lease_expires_at'),
    startedAt: integer('started_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (table) => [
    index('index_runs_by_bucket_status').on(
      table.bucket,
      table.status,
      table.leaseExpiresAt,
    ),
    index('index_runs_by_bucket_generation_kind').on(
      table.bucket,
      table.generation,
      table.kind,
    ),
  ],
)
