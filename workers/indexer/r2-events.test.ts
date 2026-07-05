import { describe, expect, it } from 'vitest'

import { normalizeR2Event } from './r2-events'

describe('normalizeR2Event', () => {
  for (const action of [
    'PutObject',
    'CopyObject',
    'CompleteMultipartUpload',
    'DeleteObject',
    'LifecycleDeletion',
  ] as const) {
    it(`accepts ${action}`, () => {
      expect(
        normalizeR2Event({
          action,
          bucket: 'poi-db',
          object: { key: 'a/file.zip' },
          eventTime: '2026-07-05T00:00:00.000Z',
        }),
      ).toMatchObject({
        action,
        bucket: 'poi-db',
        object: { key: 'a/file.zip' },
      })
    })
  }

  it('rejects malformed payloads', () => {
    expect(() => normalizeR2Event({})).toThrow('Invalid R2 event payload')
  })

  it('rejects unknown buckets', () => {
    expect(() =>
      normalizeR2Event({
        action: 'PutObject',
        bucket: 'unknown',
        object: { key: 'a/file.zip' },
        eventTime: '2026-07-05T00:00:00.000Z',
      }),
    ).toThrow('Unsupported R2 event bucket')
  })
})
