import { env } from 'cloudflare:workers'
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
} from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'

import type { IndexerEnv } from '~/env'
import type { ScanJob } from '~/jobs'
import worker from '../../../workers/indexer'

const createTestEnv = () => {
  const sent: ScanJob[] = []
  return {
    sent,
    env: {
      R2_INDEX_DB: env.R2_INDEX_DB,
      R2_INDEX_SCAN_QUEUE: {
        send: async (body: ScanJob) => {
          sent.push(body)
          return {
            metadata: {
              metrics: {
                backlogCount: 0,
                backlogBytes: 0,
                oldestMessageTimestamp: 0,
              },
            },
          }
        },
      } as Queue<ScanJob>,
      BUCKET_POI_DB: env.BUCKET_POI_DB,
      BUCKET_POI_NIGHTLIES: env.BUCKET_POI_NIGHTLIES,
    } satisfies IndexerEnv,
  }
}

describe('indexer queue handler', () => {
  it('acks a create event after indexing the object', async () => {
    await env.BUCKET_POI_DB.put('a/file.txt', 'hello')
    const testEnv = createTestEnv()

    const batch = createMessageBatch('r2-index-kai-events', [
      {
        id: 'message-1',
        timestamp: new Date(1000),
        attempts: 1,
        body: {
          action: 'PutObject',
          bucket: 'poi-db',
          object: { key: 'a/file.txt' },
          eventTime: new Date(1000).toISOString(),
        },
      },
    ])
    const ctx = createExecutionContext()

    await worker.queue(batch, testEnv.env, ctx)

    const queueResult = await getQueueResult(batch, ctx)
    expect(queueResult.explicitAcks).toEqual(['message-1'])

    const object = await env.R2_INDEX_DB.prepare(
      'SELECT key, size FROM objects WHERE bucket = ? AND key = ?',
    )
      .bind('poi-db', 'a/file.txt')
      .first<{ key: string; size: number }>()

    expect(object).toEqual({ key: 'a/file.txt', size: 5 })
    const folders = await env.R2_INDEX_DB.prepare(
      'SELECT prefix, size, total_file_count FROM folders WHERE bucket = ? ORDER BY prefix',
    )
      .bind('poi-db')
      .all<{ prefix: string; size: number; total_file_count: number }>()
    expect(folders.results).toEqual([
      { prefix: '', size: 5, total_file_count: 1 },
      { prefix: 'a/', size: 5, total_file_count: 1 },
    ])
  })

  it('retries malformed events', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const testEnv = createTestEnv()
    const batch = createMessageBatch('r2-index-kai-events', [
      {
        id: 'message-1',
        timestamp: new Date(1000),
        attempts: 1,
        body: {},
      },
    ])
    const ctx = createExecutionContext()

    await worker.queue(batch, testEnv.env, ctx)

    const queueResult = await getQueueResult(batch, ctx)
    expect(queueResult.explicitAcks).toEqual([])
    expect(queueResult.retryMessages).toHaveLength(1)
    consoleError.mockRestore()
  })

  it('does not enqueue root recompute for delete events', async () => {
    const uploadedAt = Date.now()
    await env.R2_INDEX_DB.batch([
      env.R2_INDEX_DB.prepare(
        `
INSERT INTO folders (
  bucket, prefix, parent_prefix, name, explicit_marker, marker_seen_generation, size, total_file_count, created_at, modified_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
      ).bind('poi-db', '', null, '', 0, 0, 5, 1, uploadedAt, uploadedAt, uploadedAt),
      env.R2_INDEX_DB.prepare(
        `
INSERT INTO folders (
  bucket, prefix, parent_prefix, name, explicit_marker, marker_seen_generation, size, total_file_count, created_at, modified_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
      ).bind('poi-db', 'a/', '', 'a', 0, 0, 5, 1, uploadedAt, uploadedAt, uploadedAt),
      env.R2_INDEX_DB.prepare(
        `
INSERT INTO objects (
  bucket, key, parent_prefix, name, size, uploaded_at, etag, seen_generation, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
      ).bind('poi-db', 'a/file.txt', 'a/', 'file.txt', 5, uploadedAt, 'etag', uploadedAt, uploadedAt),
    ])
    const testEnv = createTestEnv()
    const batch = createMessageBatch('r2-index-kai-events', [
      {
        id: 'message-1',
        timestamp: new Date(1000),
        attempts: 1,
        body: {
          action: 'DeleteObject',
          bucket: 'poi-db',
          object: { key: 'a/file.txt' },
          eventTime: new Date(1000).toISOString(),
        },
      },
    ])
    const ctx = createExecutionContext()

    await worker.queue(batch, testEnv.env, ctx)

    const queueResult = await getQueueResult(batch, ctx)
    expect(queueResult.explicitAcks).toEqual(['message-1'])
    expect(testEnv.sent).toEqual([
      {
        kind: 'recompute-folders',
        bucket: 'poi-db',
        prefixes: ['a/'],
      },
    ])
    const rootFolder = await env.R2_INDEX_DB.prepare(
      'SELECT needs_recompute FROM folders WHERE bucket = ? AND prefix = ?',
    )
      .bind('poi-db', '')
      .first<{ needs_recompute: number }>()
    expect(rootFolder?.needs_recompute).toBe(1)
  })

  it('prunes empty ancestor folders after deleting a folder marker', async () => {
    const now = Date.now()
    await env.R2_INDEX_DB.batch([
      env.R2_INDEX_DB.prepare(
        `
INSERT INTO folders (
  bucket, prefix, parent_prefix, name, explicit_marker, marker_seen_generation, size, total_file_count, created_at, modified_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
      ).bind('poi-db', 'a/', '', 'a', 0, 0, 0, 0, null, null, now),
      env.R2_INDEX_DB.prepare(
        `
INSERT INTO folders (
  bucket, prefix, parent_prefix, name, explicit_marker, marker_seen_generation, size, total_file_count, created_at, modified_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
      ).bind('poi-db', 'a/b/', 'a/', 'b', 1, now, 0, 0, null, null, now),
    ])
    const testEnv = createTestEnv()
    const batch = createMessageBatch('r2-index-kai-events', [
      {
        id: 'message-1',
        timestamp: new Date(1000),
        attempts: 1,
        body: {
          action: 'DeleteObject',
          bucket: 'poi-db',
          object: { key: 'a/b/' },
          eventTime: new Date(1000).toISOString(),
        },
      },
    ])
    const ctx = createExecutionContext()

    await worker.queue(batch, testEnv.env, ctx)

    const queueResult = await getQueueResult(batch, ctx)
    expect(queueResult.explicitAcks).toEqual(['message-1'])
    const folders = await env.R2_INDEX_DB.prepare(
      'SELECT prefix FROM folders WHERE bucket = ? ORDER BY prefix',
    )
      .bind('poi-db')
      .all<{ prefix: string }>()
    expect(folders.results).toEqual([{ prefix: '' }])
  })
})
