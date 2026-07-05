import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { indexedDirectoryExists } from '../../../app/lib/index-db'

describe('indexedDirectoryExists', () => {
  it('does not treat a missing non-root directory as existing', async () => {
    await expect(
      indexedDirectoryExists(env.R2_INDEX_DB, 'poi-db', 'missing/'),
    ).resolves.toBe(false)
  })

  it('treats root as existing', async () => {
    await expect(
      indexedDirectoryExists(env.R2_INDEX_DB, 'poi-db', ''),
    ).resolves.toBe(true)
  })
})
