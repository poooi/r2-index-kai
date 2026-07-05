import { describe, expect, it } from 'vitest'

import { enqueueFullScan, enqueueRecomputeFolders } from './jobs'

const createQueue = () => {
  const sent: unknown[] = []
  const metrics = { backlogCount: 0, backlogBytes: 0, oldestMessageTimestamp: new Date(0) }
  return {
    sent,
    queue: {
      send: async (body: unknown) => {
        sent.push(body)
        return { metadata: { metrics } }
      },
      sendBatch: async () => ({
        metadata: {
          metrics,
        },
      }),
      metrics: async () => metrics,
    } satisfies Queue,
  }
}

describe('indexer jobs', () => {
  it('serializes full scan page jobs', async () => {
    const { queue, sent } = createQueue()
    await enqueueFullScan(queue, 'poi-db', 123, 'cursor')
    expect(sent).toEqual([
      {
        kind: 'full-scan-page',
        bucket: 'poi-db',
        generation: 123,
        cursor: 'cursor',
      },
    ])
  })

  it('chunks recompute prefixes to at most 25 per message', async () => {
    const { queue, sent } = createQueue()
    await enqueueRecomputeFolders(
      queue,
      'poi-db',
      Array.from({ length: 26 }, (_, index) => `${index}/`),
    )
    expect(sent).toHaveLength(2)
    expect((sent[0] as { prefixes: string[] }).prefixes).toHaveLength(25)
    expect((sent[1] as { prefixes: string[] }).prefixes).toHaveLength(1)
  })
})
