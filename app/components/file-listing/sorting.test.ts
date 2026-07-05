import { describe, expect, it } from 'vitest'

import {
  compareOptionalNumbersAscending,
  defaultFileListingSorting,
} from './sorting'

describe('file listing sorting', () => {
  it('sorts by modified descending by default', () => {
    expect(defaultFileListingSorting).toEqual([{ id: 'modified', desc: true }])
  })

  it('orders numeric values ascending so TanStack descending shows newest created entries first', () => {
    const oldest = { key: 'oldest.txt', created: 1000 }
    const newest = { key: 'newest.txt', created: 3000 }

    const descending = [oldest, newest].sort(
      (listingA, listingB) =>
        -compareOptionalNumbersAscending(listingA.created, listingB.created),
    )

    expect(descending.map((listing) => listing.key)).toEqual([
      'newest.txt',
      'oldest.txt',
    ])
  })

  it('places missing numeric values after present values when sorting ascending', () => {
    expect(compareOptionalNumbersAscending(undefined, 1000)).toBeGreaterThan(0)
    expect(compareOptionalNumbersAscending(1000, undefined)).toBeLessThan(0)
  })
})
