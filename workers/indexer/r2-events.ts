import { isBucketName, type BucketName } from '../../shared/buckets'
import type { IndexerEnv } from '../../shared/env'
import { isFolderMarkerKey } from '../../shared/prefix'

import { enqueueRecomputeFolders } from './jobs'
import { getIndexerBucket } from './buckets'
import {
  applyCreateOrOverwriteFolderDeltas,
  applyDeleteFolderDeltas,
  deleteEmptyFolder,
  deleteObject,
  getIndexedObject,
  markFoldersDirty,
  setFolderMarker,
  upsertObject,
} from './folders'

export interface R2EventNotification {
  action:
    | 'PutObject'
    | 'CopyObject'
    | 'CompleteMultipartUpload'
    | 'DeleteObject'
    | 'LifecycleDeletion'
  bucket: BucketName
  object: {
    key: string
    size?: number
    eTag?: string
  }
  eventTime: string
}

const createActions = new Set([
  'PutObject',
  'CopyObject',
  'CompleteMultipartUpload',
])

const deleteActions = new Set(['DeleteObject', 'LifecycleDeletion'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const normalizeR2Event = (body: unknown): R2EventNotification => {
  if (!isRecord(body) || !isRecord(body.object)) {
    throw new Error('Invalid R2 event payload')
  }

  const { action, bucket, eventTime } = body
  const key = body.object.key

  if (typeof action !== 'string' || (!createActions.has(action) && !deleteActions.has(action))) {
    throw new Error(`Unsupported R2 event action: ${String(action)}`)
  }
  if (typeof bucket !== 'string' || !isBucketName(bucket)) {
    throw new Error(`Unsupported R2 event bucket: ${String(bucket)}`)
  }
  if (typeof key !== 'string' || key === '') {
    throw new Error('R2 event object key is required')
  }
  if (typeof eventTime !== 'string') {
    throw new Error('R2 event time is required')
  }

  return {
    action: action as R2EventNotification['action'],
    bucket,
    object: {
      key,
      size:
        typeof body.object.size === 'number' ? body.object.size : undefined,
      eTag:
        typeof body.object.eTag === 'string' ? body.object.eTag : undefined,
    },
    eventTime,
  }
}

const getActiveGeneration = async (env: IndexerEnv, bucket: BucketName) => {
  const row = await env.R2_INDEX_DB
    .prepare('SELECT status, generation FROM index_buckets WHERE bucket = ?')
    .bind(bucket)
    .first<{ status: string; generation: number }>()

  return row?.status === 'scanning' ? row.generation : 0
}

const updateLastEventAt = (env: IndexerEnv, bucket: BucketName) =>
  env.R2_INDEX_DB
    .prepare(
      `
INSERT INTO index_buckets (bucket, updated_at, last_event_at)
VALUES (?, ?, ?)
ON CONFLICT(bucket) DO UPDATE SET
  last_event_at = excluded.last_event_at,
  updated_at = excluded.updated_at
`,
    )
    .bind(bucket, Date.now(), Date.now())
    .run()

const handleCreate = async (env: IndexerEnv, event: R2EventNotification) => {
  const bucket = getIndexerBucket(env, event.bucket)
  const current = await bucket.head(event.object.key)

  if (current === null) {
    await handleDelete(env, event)
    return
  }

  const generation = await getActiveGeneration(env, event.bucket)

  if (isFolderMarkerKey(current.key)) {
    await setFolderMarker(
      env.R2_INDEX_DB,
      event.bucket,
      current.key,
      1,
      Date.now(),
      generation,
    )
    await updateLastEventAt(env, event.bucket)
    return
  }

  const oldObject = await getIndexedObject(
    env.R2_INDEX_DB,
    event.bucket,
    current.key,
  )

  await upsertObject(env.R2_INDEX_DB, event.bucket, current, generation, Date.now())
  const newObject = await getIndexedObject(
    env.R2_INDEX_DB,
    event.bucket,
    current.key,
  )

  if (newObject === null) {
    throw new Error(`Failed to upsert indexed object: ${current.key}`)
  }

  const dirtyPrefixes = await applyCreateOrOverwriteFolderDeltas(
    env,
    event.bucket,
    oldObject,
    newObject,
  )

  await markFoldersDirty(env.R2_INDEX_DB, event.bucket, dirtyPrefixes)
  await enqueueRecomputeFolders(env.R2_INDEX_SCAN_QUEUE, event.bucket, dirtyPrefixes)
  await updateLastEventAt(env, event.bucket)
}

const handleDelete = async (env: IndexerEnv, event: R2EventNotification) => {
  const bucket = getIndexerBucket(env, event.bucket)
  const current = await bucket.head(event.object.key)

  if (current !== null) {
    return
  }

  if (isFolderMarkerKey(event.object.key)) {
    await setFolderMarker(
      env.R2_INDEX_DB,
      event.bucket,
      event.object.key,
      0,
      Date.now(),
    )
    await updateLastEventAt(env, event.bucket)
    return
  }

  const oldObject = await getIndexedObject(
    env.R2_INDEX_DB,
    event.bucket,
    event.object.key,
  )

  if (oldObject === null) {
    return
  }

  const dirtyPrefixes = await applyDeleteFolderDeltas(env, event.bucket, oldObject)
  await deleteObject(env.R2_INDEX_DB, event.bucket, oldObject.key)
  await markFoldersDirty(env.R2_INDEX_DB, event.bucket, dirtyPrefixes)
  await enqueueRecomputeFolders(env.R2_INDEX_SCAN_QUEUE, event.bucket, dirtyPrefixes)
  await updateLastEventAt(env, event.bucket)

  for (const prefix of dirtyPrefixes) {
    await deleteEmptyFolder(env.R2_INDEX_DB, event.bucket, prefix)
  }
}

export const handleR2Event = async (
  env: IndexerEnv,
  event: R2EventNotification,
) => {
  if (createActions.has(event.action)) {
    await handleCreate(env, event)
    return
  }

  await handleDelete(env, event)
}
