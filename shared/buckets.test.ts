import { describe, expect, it } from 'vitest'

import { bucketNames, isBucketName } from './buckets'

describe('bucket helpers', () => {
  it('recognizes configured buckets', () => {
    expect(bucketNames).toEqual(['poi-db', 'poi-nightlies'])
    expect(isBucketName('poi-db')).toBe(true)
    expect(isBucketName('poi-nightlies')).toBe(true)
  })

  it('rejects unknown buckets', () => {
    expect(isBucketName('unknown')).toBe(false)
  })
})
