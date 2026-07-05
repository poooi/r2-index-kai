import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import type { IndexerEnv } from '~/env'
import type { ScanJob } from '~/jobs'
import { handleFullScanPage } from '../../../workers/indexer/full-scan'

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
                oldestMessageTimestamp: new Date(0),
              },
            },
          }
        },
        sendBatch: async () => ({
          metadata: {
            metrics: {
              backlogCount: 0,
              backlogBytes: 0,
              oldestMessageTimestamp: new Date(0),
            },
          },
        }),
        metrics: async () => ({
          backlogCount: 0,
          backlogBytes: 0,
          oldestMessageTimestamp: new Date(0),
        }),
      } as Queue<ScanJob>,
      BUCKET_POI_DB: env.BUCKET_POI_DB,
      BUCKET_POI_NIGHTLIES: env.BUCKET_POI_NIGHTLIES,
    } satisfies IndexerEnv,
  }
}

describe('full scan pages', () => {
  it('upserts objects and marks ancestor folders dirty', async () => {
    await env.BUCKET_POI_DB.put('a/file.txt', 'hello')
    await env.R2_INDEX_DB.prepare(
      `
INSERT INTO index_runs (
  id, bucket, kind, generation, status, lease_expires_at, started_at, updated_at
) VALUES (?, ?, 'full-scan', ?, 'running', ?, ?, ?)
`,
    )
      .bind('run', 'poi-db', 123, Date.now() + 60_000, Date.now(), Date.now())
      .run()
    const testEnv = createTestEnv()

    await handleFullScanPage(testEnv.env, {
      kind: 'full-scan-page',
      bucket: 'poi-db',
      generation: 123,
    })

    const folders = await env.R2_INDEX_DB.prepare(
      'SELECT prefix, needs_recompute FROM folders WHERE bucket = ? ORDER BY prefix',
    )
      .bind('poi-db')
      .all<{ prefix: string; needs_recompute: number }>()

    expect(folders.results).toEqual([
      { prefix: '', needs_recompute: 1 },
      { prefix: 'a/', needs_recompute: 1 },
    ])
    expect(testEnv.sent.map((job) => job.kind)).toEqual(['finish-full-scan'])
  })
})
