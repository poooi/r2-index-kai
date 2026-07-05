import type { BucketName } from '../../shared/buckets'
import type { IndexerEnv } from '../../shared/env'
import {
  getAncestorPrefixes,
  getFolderMarkerPrefix,
  getName,
  getParentPrefix,
  getPrefixUpperBound,
} from '../../shared/prefix'
import type { FolderStatsRow, IndexedObject } from '../../shared/db/types'

const MAX_PREFIX_BINDINGS = 80

const getFolderRowParts = (prefix: string) => {
  if (prefix === '') {
    return {
      parentPrefix: null,
      name: '',
    }
  }

  const normalized = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix
  return {
    parentPrefix: getParentPrefix(normalized),
    name: getName(normalized),
  }
}

export const ensureFolder = async (
  db: D1Database,
  bucket: BucketName,
  prefix: string,
  now: number,
  explicitMarker = 0,
  markerSeenGeneration = 0,
) => {
  const { parentPrefix, name } = getFolderRowParts(prefix)

  await db
    .prepare(
      `
INSERT INTO folders (
  bucket, prefix, parent_prefix, name, explicit_marker, marker_seen_generation, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(bucket, prefix) DO NOTHING
`,
    )
    .bind(bucket, prefix, parentPrefix, name, explicitMarker, markerSeenGeneration, now)
    .run()
}

export const ensureAncestorFolders = async (
  db: D1Database,
  bucket: BucketName,
  key: string,
  now: number,
) => {
  for (const prefix of getAncestorPrefixes(key)) {
    await ensureFolder(db, bucket, prefix, now)
  }
}

export const setFolderMarker = async (
  db: D1Database,
  bucket: BucketName,
  key: string,
  explicitMarker: 0 | 1,
  now: number,
  generation = 0,
) => {
  const prefix = getFolderMarkerPrefix(key)
  await ensureAncestorFolders(db, bucket, key, now)
  await ensureFolder(db, bucket, prefix, now, explicitMarker, generation)
  await db
    .prepare(
      `
UPDATE folders
SET explicit_marker = ?, marker_seen_generation = ?, updated_at = ?
WHERE bucket = ? AND prefix = ?
`,
    )
    .bind(explicitMarker, explicitMarker ? generation : 0, now, bucket, prefix)
    .run()
  await deleteEmptyFolder(db, bucket, prefix)
}

export const getIndexedObject = (db: D1Database, bucket: BucketName, key: string) =>
  db
    .prepare(
      `
SELECT bucket, key, parent_prefix, name, size, uploaded_at, etag, seen_generation, updated_at
FROM objects
WHERE bucket = ? AND key = ?
`,
    )
    .bind(bucket, key)
    .first<IndexedObject>()

export const upsertObject = async (
  db: D1Database,
  bucket: BucketName,
  object: R2Object,
  generation: number,
  now: number,
) => {
  await ensureAncestorFolders(db, bucket, object.key, now)
  await db
    .prepare(
      `
INSERT INTO objects (
  bucket, key, parent_prefix, name, size, uploaded_at, etag, seen_generation, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(bucket, key) DO UPDATE SET
  parent_prefix = excluded.parent_prefix,
  name = excluded.name,
  size = excluded.size,
  uploaded_at = excluded.uploaded_at,
  etag = excluded.etag,
  seen_generation = excluded.seen_generation,
  updated_at = excluded.updated_at
`,
    )
    .bind(
      bucket,
      object.key,
      getParentPrefix(object.key),
      getName(object.key),
      object.size,
      object.uploaded.getTime(),
      object.etag,
      generation,
      now,
    )
    .run()
}

const chunkPrefixes = (prefixes: string[]) => {
  const unique = [...new Set(prefixes)]
  const chunks: string[][] = []
  for (let index = 0; index < unique.length; index += MAX_PREFIX_BINDINGS) {
    chunks.push(unique.slice(index, index + MAX_PREFIX_BINDINGS))
  }
  return chunks
}

const getBoundaryAffectedPrefixes = async (
  db: D1Database,
  bucket: BucketName,
  prefixes: string[],
  timestamp: number,
) => {
  const affected: string[] = []

  for (const chunk of chunkPrefixes(prefixes)) {
    if (chunk.length === 0) {
      continue
    }

    const placeholders = chunk.map(() => '?').join(', ')
    const rows = await db
      .prepare(
        `
SELECT prefix, created_at, modified_at
FROM folders
WHERE bucket = ? AND prefix IN (${placeholders})
`,
      )
      .bind(bucket, ...chunk)
      .all<FolderStatsRow>()

    affected.push(
      ...rows.results
        .filter(
          (row) => row.created_at === timestamp || row.modified_at === timestamp,
        )
        .map((row) => row.prefix),
    )
  }

  return affected
}

const applyFolderDelta = async (
  db: D1Database,
  bucket: BucketName,
  prefix: string,
  sizeDelta: number,
  countDelta: number,
  uploadedAt: number | null,
  now: number,
) => {
  await db
    .prepare(
      `
UPDATE folders
SET
  size = size + ?,
  total_file_count = total_file_count + ?,
  created_at = CASE
    WHEN created_at IS NULL THEN ?
    WHEN ? IS NULL THEN created_at
    ELSE MIN(created_at, ?)
  END,
  modified_at = CASE
    WHEN modified_at IS NULL THEN ?
    WHEN ? IS NULL THEN modified_at
    ELSE MAX(modified_at, ?)
  END,
  updated_at = ?
WHERE bucket = ? AND prefix = ?
`,
    )
    .bind(
      sizeDelta,
      countDelta,
      uploadedAt,
      uploadedAt,
      uploadedAt,
      uploadedAt,
      uploadedAt,
      uploadedAt,
      now,
      bucket,
      prefix,
    )
    .run()
}

export const applyCreateOrOverwriteFolderDeltas = async (
  env: IndexerEnv,
  bucket: BucketName,
  oldObject: IndexedObject | null,
  newObject: IndexedObject,
) => {
  const db = env.R2_INDEX_DB
  const now = Date.now()
  const prefixes = [
    ...new Set([
      ...getAncestorPrefixes(newObject.key),
      ...(oldObject ? getAncestorPrefixes(oldObject.key) : []),
    ]),
  ]

  for (const prefix of prefixes) {
    await ensureFolder(db, bucket, prefix, now)
    await applyFolderDelta(
      db,
      bucket,
      prefix,
      oldObject ? newObject.size - oldObject.size : newObject.size,
      oldObject ? 0 : 1,
      newObject.uploaded_at,
      now,
    )
  }

  return oldObject
    ? getBoundaryAffectedPrefixes(db, bucket, prefixes, oldObject.uploaded_at)
    : []
}

export const applyDeleteFolderDeltas = async (
  env: IndexerEnv,
  bucket: BucketName,
  oldObject: IndexedObject,
) => {
  const db = env.R2_INDEX_DB
  const now = Date.now()
  const prefixes = getAncestorPrefixes(oldObject.key)

  for (const prefix of prefixes) {
    await applyFolderDelta(db, bucket, prefix, -oldObject.size, -1, null, now)
  }

  return getBoundaryAffectedPrefixes(db, bucket, prefixes, oldObject.uploaded_at)
}

export const deleteObject = (db: D1Database, bucket: BucketName, key: string) =>
  db.prepare('DELETE FROM objects WHERE bucket = ? AND key = ?').bind(bucket, key).run()

export const markFoldersDirty = async (
  db: D1Database,
  bucket: BucketName,
  prefixes: string[],
) => {
  const now = Date.now()
  for (const prefix of new Set(prefixes)) {
    await db
      .prepare(
        `
UPDATE folders
SET needs_recompute = 1, updated_at = ?
WHERE bucket = ? AND prefix = ?
`,
      )
      .bind(now, bucket, prefix)
      .run()
  }
}

export const recomputeFolders = async (
  env: IndexerEnv,
  bucket: BucketName,
  prefixes: string[],
) => {
  const db = env.R2_INDEX_DB
  const now = Date.now()

  for (const prefix of new Set(prefixes)) {
    const upperBound = getPrefixUpperBound(prefix)
    const aggregate =
      prefix === '' || upperBound === null
        ? await db
            .prepare(
              `
SELECT COALESCE(SUM(size), 0) AS size,
       COUNT(*) AS total_file_count,
       MIN(uploaded_at) AS created_at,
       MAX(uploaded_at) AS modified_at
FROM objects
WHERE bucket = ?
`,
            )
            .bind(bucket)
            .first<{
              size: number
              total_file_count: number
              created_at: number | null
              modified_at: number | null
            }>()
        : await db
            .prepare(
              `
SELECT COALESCE(SUM(size), 0) AS size,
       COUNT(*) AS total_file_count,
       MIN(uploaded_at) AS created_at,
       MAX(uploaded_at) AS modified_at
FROM objects
WHERE bucket = ? AND key >= ? AND key < ?
`,
            )
            .bind(bucket, prefix, upperBound)
            .first<{
              size: number
              total_file_count: number
              created_at: number | null
              modified_at: number | null
            }>()

    await db
      .prepare(
        `
UPDATE folders
SET
  size = ?,
  total_file_count = ?,
  created_at = ?,
  modified_at = ?,
  needs_recompute = 0,
  updated_at = ?
WHERE bucket = ? AND prefix = ?
`,
      )
      .bind(
        aggregate?.size ?? 0,
        aggregate?.total_file_count ?? 0,
        aggregate?.created_at ?? null,
        aggregate?.modified_at ?? null,
        now,
        bucket,
        prefix,
      )
      .run()

    await deleteEmptyFolder(db, bucket, prefix)
  }
}

export const deleteEmptyFolder = (
  db: D1Database,
  bucket: BucketName,
  prefix: string,
) =>
  db
    .prepare(
      `
DELETE FROM folders
WHERE bucket = ?
  AND prefix = ?
  AND prefix != ''
  AND explicit_marker = 0
  AND total_file_count = 0
  AND NOT EXISTS (
    SELECT 1
    FROM folders child
    WHERE child.bucket = folders.bucket
      AND child.parent_prefix = folders.prefix
  )
`,
    )
    .bind(bucket, prefix)
    .run()
