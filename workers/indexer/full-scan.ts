import { bucketNames, type BucketName } from '../../shared/buckets'
import type { IndexerEnv } from '../../shared/env'
import type {
  CleanupStalePageJob,
  FinalizeFullScanJob,
  FullScanPageJob,
} from '../../shared/jobs'
import { getAncestorPrefixes, isFolderMarkerKey } from '../../shared/prefix'

import { getIndexerBucket } from './buckets'
import {
  enqueueCleanupStalePage,
  enqueueFinalizeFullScan,
  enqueueFinishFullScan,
  enqueueFullScan,
  enqueueRecomputeFolders,
} from './jobs'
import {
  deleteEmptyFolder,
  deleteObject,
  getIndexedObject,
  markFoldersDirty,
  setFolderMarker,
  upsertObject,
} from './folders'

const SCAN_PAGE_LIMIT = 10
const STALE_PAGE_LIMIT = 100

const getRunId = (bucket: BucketName, generation: number) =>
  `${bucket}:full-scan:${generation}`

export const startFullScan = async (env: IndexerEnv, bucket: BucketName) => {
  const now = Date.now()
  const activeRun = await env.R2_INDEX_DB
    .prepare(
      `
SELECT id
FROM index_runs
WHERE bucket = ? AND status = 'running' AND lease_expires_at > ?
LIMIT 1
`,
    )
    .bind(bucket, now)
    .first<{ id: string }>()

  if (activeRun) {
    return
  }

  const generation = now
  await env.R2_INDEX_DB.batch([
    env.R2_INDEX_DB
      .prepare(
        `
INSERT INTO index_buckets (
  bucket, status, generation, last_scan_started_at, updated_at
) VALUES (?, 'scanning', ?, ?, ?)
ON CONFLICT(bucket) DO UPDATE SET
  status = 'scanning',
  generation = excluded.generation,
  last_scan_started_at = excluded.last_scan_started_at,
  updated_at = excluded.updated_at
`,
      )
      .bind(bucket, generation, now, now),
    env.R2_INDEX_DB
      .prepare(
        `
INSERT INTO index_runs (
  id, bucket, kind, generation, status, lease_expires_at, started_at, updated_at
) VALUES (?, ?, 'full-scan', ?, 'running', ?, ?, ?)
`,
      )
      .bind(
        getRunId(bucket, generation),
        bucket,
        generation,
        now + 15 * 60_000,
        now,
        now,
      ),
  ])

  await enqueueFullScan(env.R2_INDEX_SCAN_QUEUE, bucket, generation)
}

const extendScanLease = async (
  env: IndexerEnv,
  bucket: BucketName,
  generation: number,
) => {
  const result = await env.R2_INDEX_DB
    .prepare(
      `
UPDATE index_runs
SET lease_expires_at = ?, updated_at = ?
WHERE bucket = ? AND generation = ? AND kind = 'full-scan' AND status = 'running'
`,
    )
    .bind(Date.now() + 15 * 60_000, Date.now(), bucket, generation)
    .run()
  if (result.meta.changes === 0) {
    throw new Error(`No active full-scan run for ${bucket}/${generation}`)
  }
}

export const handleFullScanPage = async (
  env: IndexerEnv,
  job: FullScanPageJob,
) => {
  const bucket = getIndexerBucket(env, job.bucket)
  const listed = await bucket.list({
    limit: SCAN_PAGE_LIMIT,
    cursor: job.cursor,
  })
  const dirtyPrefixes: string[] = []

  for (const listedObject of listed.objects) {
    const current = await bucket.head(listedObject.key)
    if (current === null) {
      continue
    }

    if (isFolderMarkerKey(current.key)) {
      await setFolderMarker(
        env.R2_INDEX_DB,
        job.bucket,
        current.key,
        1,
        Date.now(),
        job.generation,
      )
      continue
    }

    await upsertObject(
      env.R2_INDEX_DB,
      job.bucket,
      current,
      job.generation,
      Date.now(),
    )
    dirtyPrefixes.push(...getAncestorPrefixes(current.key))
  }

  if (dirtyPrefixes.length > 0) {
    await markFoldersDirty(env.R2_INDEX_DB, job.bucket, dirtyPrefixes)
  }

  await extendScanLease(env, job.bucket, job.generation)

  if (listed.truncated) {
    await enqueueFullScan(
      env.R2_INDEX_SCAN_QUEUE,
      job.bucket,
      job.generation,
      listed.cursor,
    )
  } else {
    await enqueueFinishFullScan(
      env.R2_INDEX_SCAN_QUEUE,
      job.bucket,
      job.generation,
    )
  }
}

export const finishFullScan = async (
  env: IndexerEnv,
  bucket: BucketName,
  generation: number,
) => {
  await enqueueCleanupStalePage(env.R2_INDEX_SCAN_QUEUE, bucket, generation)
}

export const cleanupStalePage = async (
  env: IndexerEnv,
  job: CleanupStalePageJob,
) => {
  const bucketState = await env.R2_INDEX_DB
    .prepare(
      `
SELECT last_scan_started_at
FROM index_buckets
WHERE bucket = ? AND generation = ?
`,
    )
    .bind(job.bucket, job.generation)
    .first<{ last_scan_started_at: number }>()

  if (!bucketState) {
    return
  }

  const staleObjects = await env.R2_INDEX_DB
    .prepare(
      `
SELECT key
FROM objects
WHERE bucket = ?
  AND seen_generation < ?
  AND updated_at < ?
  AND key > COALESCE(?, '')
ORDER BY key
LIMIT ${STALE_PAGE_LIMIT}
`,
    )
    .bind(
      job.bucket,
      job.generation,
      bucketState.last_scan_started_at,
      job.afterKey ?? null,
    )
    .all<{ key: string }>()

  const dirtyPrefixes: string[] = []
  for (const row of staleObjects.results) {
    const oldObject = await getIndexedObject(env.R2_INDEX_DB, job.bucket, row.key)
    if (oldObject === null) {
      continue
    }
    dirtyPrefixes.push(...getAncestorPrefixes(oldObject.key))
    await deleteObject(env.R2_INDEX_DB, job.bucket, oldObject.key)
  }

  if (dirtyPrefixes.length > 0) {
    await markFoldersDirty(env.R2_INDEX_DB, job.bucket, dirtyPrefixes)
    await enqueueRecomputeFolders(env.R2_INDEX_SCAN_QUEUE, job.bucket, dirtyPrefixes)
  }

  if (staleObjects.results.length === STALE_PAGE_LIMIT) {
    await enqueueCleanupStalePage(
      env.R2_INDEX_SCAN_QUEUE,
      job.bucket,
      job.generation,
      staleObjects.results.at(-1)?.key,
    )
    return
  }

  await env.R2_INDEX_DB
    .prepare(
      `
UPDATE folders
SET explicit_marker = 0, marker_seen_generation = 0, updated_at = ?
WHERE bucket = ?
  AND explicit_marker = 1
  AND marker_seen_generation < ?
  AND updated_at < ?
`,
    )
    .bind(Date.now(), job.bucket, job.generation, bucketState.last_scan_started_at)
    .run()

  await enqueueFinalizeFullScan(
    env.R2_INDEX_SCAN_QUEUE,
    job.bucket,
    job.generation,
  )
}

export const finalizeFullScan = async (
  env: IndexerEnv,
  job: FinalizeFullScanJob,
) => {
  const dirtyFolder = await env.R2_INDEX_DB
    .prepare(
      `
SELECT prefix
FROM folders
WHERE bucket = ? AND needs_recompute = 1
LIMIT 1
`,
    )
    .bind(job.bucket)
    .first<{ prefix: string }>()

  if (dirtyFolder) {
    const dirtyFolders = await env.R2_INDEX_DB
      .prepare(
        `
SELECT prefix
FROM folders
WHERE bucket = ? AND needs_recompute = 1
ORDER BY prefix
LIMIT 250
`,
      )
      .bind(job.bucket)
      .all<{ prefix: string }>()

    await enqueueRecomputeFolders(
      env.R2_INDEX_SCAN_QUEUE,
      job.bucket,
      dirtyFolders.results.map((row) => row.prefix),
    )
    await enqueueFinalizeFullScan(
      env.R2_INDEX_SCAN_QUEUE,
      job.bucket,
      job.generation,
      60,
    )
    return
  }

  const emptyFolders = await env.R2_INDEX_DB
    .prepare(
      `
SELECT prefix
FROM folders
WHERE bucket = ?
  AND prefix != ''
  AND explicit_marker = 0
  AND total_file_count = 0
LIMIT 100
`,
    )
    .bind(job.bucket)
    .all<{ prefix: string }>()

  for (const row of emptyFolders.results) {
    await deleteEmptyFolder(env.R2_INDEX_DB, job.bucket, row.prefix)
  }

  if (emptyFolders.results.length === 100) {
    await enqueueFinalizeFullScan(
      env.R2_INDEX_SCAN_QUEUE,
      job.bucket,
      job.generation,
      60,
    )
    return
  }

  const now = Date.now()
  await env.R2_INDEX_DB.batch([
    env.R2_INDEX_DB
      .prepare(
        `
UPDATE index_buckets
SET status = 'ready', last_scan_finished_at = ?, updated_at = ?
WHERE bucket = ? AND generation = ?
`,
      )
      .bind(now, now, job.bucket, job.generation),
    env.R2_INDEX_DB
      .prepare(
        `
UPDATE index_runs
SET status = 'finished', finished_at = ?, updated_at = ?, lease_expires_at = NULL
WHERE bucket = ? AND generation = ? AND kind = 'full-scan'
`,
      )
      .bind(now, now, job.bucket, job.generation),
  ])
}

export const startScheduledScans = async (env: IndexerEnv) => {
  for (const bucket of bucketNames) {
    await startFullScan(env, bucket)
  }
}
