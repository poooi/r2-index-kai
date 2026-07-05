import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import type { IndexerEnv } from '~/env'
import type { ScanJob } from '~/jobs'
import { startScheduledScans } from '../../../workers/indexer/full-scan'

const createQueue = () => {
  const sent: ScanJob[] = []
  return {
    sent,
    queue: {
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
  }
}

describe('scheduled scans', () => {
  it('marks both buckets as scanning and enqueues scan jobs', async () => {
    const { queue, sent } = createQueue()
    const testEnv = {
      R2_INDEX_DB: env.R2_INDEX_DB,
      R2_INDEX_SCAN_QUEUE: queue,
      BUCKET_POI_DB: env.BUCKET_POI_DB,
      BUCKET_POI_NIGHTLIES: env.BUCKET_POI_NIGHTLIES,
    } satisfies IndexerEnv

    await startScheduledScans(testEnv)

    const rows = await env.R2_INDEX_DB.prepare(
      'SELECT bucket, status FROM index_buckets ORDER BY bucket',
    ).all<{ bucket: string; status: string }>()

    expect(rows.results).toEqual([
      { bucket: 'poi-db', status: 'scanning' },
      { bucket: 'poi-nightlies', status: 'scanning' },
    ])
    expect(sent.map((job) => job.kind)).toEqual([
      'full-scan-page',
      'full-scan-page',
    ])
  })
})
