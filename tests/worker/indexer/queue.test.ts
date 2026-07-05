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
})
